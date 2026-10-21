// End-to-end test of every scenario the agent can hit.
//
//   npm run dev            (in one terminal)
//   npm run smoke          (in another)
//
// Against a deployed API:
//   BASE_URL=https://your-app.vercel.app TOOL_API_KEY=... npm run smoke
//
// MOCK mode: fully automatic (the script "pays" through the mock checkout).
// PAYSTACK test mode: the script prints each payment link and waits for you to
// pay (or decline) it in the browser with a Paystack test card, then press Enter.
// Paystack test cards: https://paystack.com/docs/payments/test-payments
// Note: in Paystack mode payments are real test transactions, so balances
// carry over between runs. Run it on a fresh test account, or read the numbers.

import { createInterface } from 'node:readline/promises';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const KEY = process.env.TOOL_API_KEY ?? '';

let passed = 0;
let failed = 0;

async function call(method: 'GET' | 'POST', path: string, body?: unknown, opts: { auth?: boolean; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (KEY && opts.auth !== false) headers['x-api-key'] = KEY;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html pages */
  }
  return { status: res.status, json, text };
}

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log('        ', JSON.stringify(detail).slice(0, 400));
  }
}

const errCode = (r: { json: any }) => r.json?.error?.code;

async function pay(url: string, action: 'pay' | 'decline', mode: string) {
  if (mode === 'mock') {
    const r = await fetch(`${url}&action=${action}`, { redirect: 'manual' });
    return r.status === 302;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(
    `\n  >>> Open this link and ${action === 'pay' ? 'PAY with a successful test card' : 'use a DECLINED test card'}:\n  ${url}\n  Press Enter when done... `,
  );
  rl.close();
  return true;
}

async function main() {
  console.log(`Testing ${BASE}\n`);

  // ---------------------------------------------------------------- setup
  console.log('Health and auth');
  const health = await call('GET', '/api/health');
  check('health responds', health.status === 200 && health.json?.service === 'brightfield-fees-agent', health.json);
  const mode: string = health.json?.payments_mode;
  console.log(`        mode: ${mode}, auth: ${health.json?.auth}`);
  if (health.json?.warnings?.length) console.log(`        warnings: ${health.json.warnings.join(' | ')}`);

  if (health.json?.auth === 'required') {
    const noKey = await call('GET', '/api/balance?student_id=BFA-0142', undefined, { auth: false });
    check('request without API key is rejected (401)', noKey.status === 401 && errCode(noKey) === 'UNAUTHORIZED', noKey.json);
  }

  // ---------------------------------------------------------------- balance
  console.log('\nBalance lookup');
  const bal = await call('GET', '/api/balance?student_id=BFA-0142');
  const startBalance: number = bal.json?.balance;
  check('BFA-0142 balance returned', bal.status === 200 && typeof startBalance === 'number', bal.json);
  if (mode === 'mock') check('BFA-0142 starts at 250,000', startBalance === 250000, bal.json);

  const loose = await call('POST', '/api/balance', { studentId: 'bfa 142' });
  check('messy ID "bfa 142" (camelCase key, POST) resolves to BFA-0142', loose.json?.student_id === 'BFA-0142', loose.json);

  const unknown = await call('GET', '/api/balance?student_id=BFA-9999');
  check('unknown student -> STUDENT_NOT_FOUND (404)', unknown.status === 404 && errCode(unknown) === 'STUDENT_NOT_FOUND', unknown.json);
  check('error carries an agent_hint', typeof unknown.json?.error?.agent_hint === 'string');

  const missing = await call('GET', '/api/balance');
  check('missing student_id -> MISSING_STUDENT_ID', errCode(missing) === 'MISSING_STUDENT_ID', missing.json);

  const paidUp = await call('GET', '/api/balance?student_id=BFA-0088');
  check('fully paid student shows balance 0', paidUp.json?.balance === 0, paidUp.json);

  const badJson = await call('POST', '/api/balance', undefined, { raw: '{not json' });
  check('broken JSON body -> INVALID_JSON', errCode(badJson) === 'INVALID_JSON', badJson.json);

  // ---------------------------------------------------------------- parent phone check
  console.log('\nParent phone check');
  const ownParent = await call('POST', '/api/balance', { student_id: 'BFA-0142', parent_phone: '0803 555 0142' });
  check("parent's own number (local format) -> allowed", ownParent.status === 200, ownParent.json);
  const otherParent = await call('POST', '/api/balance', { student_id: 'BFA-0142', parent_phone: '+2348035550217' });
  check("another parent's number -> PARENT_NOT_VERIFIED (403)", otherParent.status === 403 && errCode(otherParent) === 'PARENT_NOT_VERIFIED', otherParent.json);
  check('refusal leaks no fee details', otherParent.json?.balance === undefined && !JSON.stringify(otherParent.json).includes('Tobi'));
  const otherLink = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: 100000, parent_phone: '+2348035550217' });
  check("another parent can't create a payment link", errCode(otherLink) === 'PARENT_NOT_VERIFIED', otherLink.json);

  // ---------------------------------------------------------------- payment link validation
  console.log('\nPayment link rules');
  const low = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: 50000 });
  check('below minimum installment -> AMOUNT_TOO_LOW (422)', low.status === 422 && errCode(low) === 'AMOUNT_TOO_LOW', low.json);

  const high = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: startBalance + 1000 });
  check('above balance -> AMOUNT_ABOVE_BALANCE', errCode(high) === 'AMOUNT_ABOVE_BALANCE', high.json);

  const junk = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: 'a lot' });
  check('unreadable amount -> INVALID_AMOUNT', errCode(junk) === 'INVALID_AMOUNT', junk.json);

  const noAmt = await call('POST', '/api/payment-link', { student_id: 'BFA-0142' });
  check('missing amount -> MISSING_AMOUNT (hint states balance)', errCode(noAmt) === 'MISSING_AMOUNT' && /balance/i.test(noAmt.json?.error?.agent_hint), noAmt.json);

  const done = await call('POST', '/api/payment-link', { student_id: 'BFA-0088', amount: 100000 });
  check('fully paid student -> ALREADY_PAID (409)', done.status === 409 && errCode(done) === 'ALREADY_PAID', done.json);

  if (mode === 'mock') {
    const small = await call('POST', '/api/payment-link', { student_id: 'BFA-0305', amount: 50000 });
    check('small remaining balance must be paid in full (hint says so)', errCode(small) === 'AMOUNT_TOO_LOW' && /in full/i.test(small.json?.error?.agent_hint), small.json);
    const exact = await call('POST', '/api/payment-link', { student_id: 'BFA-0305', amount: 60000 });
    check('paying the exact small remainder (60,000) is allowed', exact.status === 200 && !!exact.json?.payment_url, exact.json);
  }

  // ---------------------------------------------------------------- happy path
  console.log('\nHappy path: link -> pay -> verify');
  const link = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: '₦150k' });
  check('"₦150k" accepted as 150,000 and link created', link.status === 200 && link.json?.amount === 150000 && !!link.json?.payment_url, link.json);
  const ref: string = link.json?.reference;

  const early = await call('POST', '/api/verify', { reference: ref });
  check('verify before paying -> payment_status not_completed', early.json?.payment_status === 'not_completed', early.json);

  await pay(link.json?.payment_url, 'pay', mode);
  const verified = await call('POST', '/api/verify', { reference: ref });
  check('verify after paying -> success', verified.json?.payment_status === 'success', verified.json);
  check('new balance = start - 150,000', verified.json?.new_balance === startBalance - 150000, verified.json);

  const receiptPage = await fetch(verified.json?.receipt_url ?? `${BASE}/api/receipt/missing`);
  const pageHtml = await receiptPage.text();
  check('receipt_url opens a page with the image and og:image preview', receiptPage.status === 200 && pageHtml.includes('og:image') && pageHtml.includes('Download receipt'), receiptPage.status);
  const receipt = await fetch(verified.json?.receipt_image_url ?? `${BASE}/api/receipt/missing.png`);
  check('receipt_image_url returns a PNG image', receipt.status === 200 && receipt.headers.get('content-type') === 'image/png', receipt.status);
  const forged = await fetch(`${BASE}/api/receipt/${encodeURIComponent(ref)}.png?sig=forged`);
  check('receipt with a bad signature -> 404', forged.status === 404 || !KEY, forged.status);

  const again = await call('POST', '/api/verify', { reference: ref });
  check('verifying the same payment twice does not double-count', again.json?.new_balance === startBalance - 150000, again.json);

  const balAfter = await call('GET', '/api/balance?student_id=BFA-0142');
  check('balance endpoint agrees with verify', balAfter.json?.balance === startBalance - 150000, balAfter.json);

  if (mode === 'mock') {
    const page = await call('GET', `/api/payment-complete?reference=${encodeURIComponent(ref)}`);
    check('return page shows "Payment received"', /Payment received/.test(page.text));
  }

  // ---------------------------------------------------------------- failure paths
  console.log('\nFailures');
  const link2 = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: 100000 });
  await pay(link2.json?.payment_url, 'decline', mode);
  const declined = await call('POST', '/api/verify', { reference: link2.json?.reference });
  check('declined card -> payment_status failed, balance unchanged', declined.json?.payment_status === 'failed', declined.json);

  const byStudent = await call('POST', '/api/verify', { student_id: 'BFA-0142' });
  check('verify with only student_id checks the latest attempt', byStudent.json?.reference === link2.json?.reference, byStudent.json);

  const badRef = await call('POST', '/api/verify', { reference: 'BFA0142-does-not-exist' });
  check('unknown reference -> REFERENCE_NOT_FOUND', errCode(badRef) === 'REFERENCE_NOT_FOUND', badRef.json);

  const mismatch = await call('POST', '/api/verify', { reference: ref, student_id: 'BFA-0217' });
  check('reference for a different child -> REFERENCE_STUDENT_MISMATCH', errCode(mismatch) === 'REFERENCE_STUDENT_MISMATCH', mismatch.json);

  const nothing = await call('POST', '/api/verify', {});
  check('verify with nothing -> MISSING_REFERENCE', errCode(nothing) === 'MISSING_REFERENCE', nothing.json);

  if (mode === 'mock') {
    const none = await call('POST', '/api/verify', { student_id: 'BFA-0151' });
    check('student with no online payments -> NO_PAYMENT_FOUND', errCode(none) === 'NO_PAYMENT_FOUND', none.json);
  }

  // ---------------------------------------------------------------- pay off
  console.log('\nPaying off the balance');
  const rest = startBalance - 150000;
  const link3 = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: rest });
  await pay(link3.json?.payment_url, 'pay', mode);
  const final = await call('POST', '/api/verify', { reference: link3.json?.reference });
  check('final payment clears the balance to 0', final.json?.payment_status === 'success' && final.json?.new_balance === 0, final.json);
  const after = await call('POST', '/api/payment-link', { student_id: 'BFA-0142', amount: 100000 });
  check('no more links once fully paid -> ALREADY_PAID', errCode(after) === 'ALREADY_PAID', after.json);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
