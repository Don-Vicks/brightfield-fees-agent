// The tools the Chord agent calls. All require the API key.
//
//   GET|POST /api/balance        { student_id }             get_fee_balance
//   POST|GET /api/payment-link   { student_id, amount }     create_payment_link
//   POST|GET /api/verify         { reference | student_id } verify_payment
//   GET|POST /api/payments       { student_id }             get_payment_history
//   POST     /api/handover       { summary, reason, ... }   hand_over_to_bursar
//
// All accept parent_phone (see lib/access.ts).
//
// Errors are thrown as ToolError (or UpstreamError from Paystack) and formatted by the error middleware.

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { SCHOOL, STUDENTS, Student, findStudent, normalizeStudentId } from '../lib/data';
import { getAccount, missingStudentId, studentNotFound } from '../lib/fees';
import { baseUrl, fail, naira, parseNaira, readInput } from '../lib/http';
import { Txn, getProvider } from '../lib/paystack';
import { receiptImageUrl, receiptUrl } from '../lib/receipt';
import { assertParent } from '../lib/access';
import { asyncHandler } from '../middleware/async';
import { requireApiKey } from '../middleware/auth';

export const tools = Router();
tools.use(requireApiKey);

/** Finds the student and checks the sender is that child's parent (see lib/access.ts). */
function requireStudent(input: Record<string, unknown>): Student {
  if (!input.student_id) throw missingStudentId();
  const student = findStudent(input.student_id);
  if (!student) throw studentNotFound(input.student_id);
  assertParent(student, input.parent_phone);
  return student;
}

// ---------------------------------------------------------------------------
// TOOL 1: get_fee_balance
// What the student owes this term, worked out live from school records + Paystack.

const getBalance = asyncHandler(async (req, res) => {
  const student = requireStudent(readInput(req));
  const account = await getAccount(student, getProvider());

  res.json({
    ok: true,
    ...account,
    agent_hint:
      account.balance === 0
        ? 'Tell the parent the fees are fully paid. If there is an overpayment, say the bursar will contact them about it. Do not offer a payment link.'
        : 'Tell the parent the balance in one or two short sentences. Offer to send a payment link for the full balance or an installment of at least min_installment.',
  });
});

tools.get('/balance', getBalance);
tools.post('/balance', getBalance);

// ---------------------------------------------------------------------------
// TOOL 2: create_payment_link
// Validates the amount against the installment rules, then creates a Paystack
// (test mode) checkout link tagged with the student's ID.

function makeReference(studentId: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // yyyyMMddHHmmss
  return `${studentId.replace('-', '')}-${stamp}-${randomBytes(2).toString('hex')}`;
}

const createPaymentLink = asyncHandler(async (req, res) => {
  const input = readInput(req);
  const student = requireStudent(input);
  const provider = getProvider();
  const account = await getAccount(student, provider);

  if (account.balance === 0) {
    throw fail(
      409,
      'ALREADY_PAID',
      `${student.name}'s fees are already fully paid.`,
      'Tell the parent the fees are fully paid and no payment is needed. Do not create a link.',
    );
  }

  if (input.amount === undefined || input.amount === null || input.amount === '') {
    throw fail(
      400,
      'MISSING_AMOUNT',
      'amount is required (in naira).',
      `Ask the parent how much they want to pay now. Balance is ${naira(account.balance)}; minimum is ${naira(account.min_installment)}.`,
    );
  }

  const amount = parseNaira(input.amount);
  if (amount === null) {
    throw fail(
      400,
      'INVALID_AMOUNT',
      `Could not read "${String(input.amount)}" as a naira amount.`,
      `Ask the parent to confirm the amount as a number, e.g. 150000. Balance is ${naira(account.balance)}.`,
    );
  }

  if (amount > account.balance) {
    throw fail(
      422,
      'AMOUNT_ABOVE_BALANCE',
      `${naira(amount)} is more than the balance of ${naira(account.balance)}.`,
      `Tell the parent the balance is only ${naira(account.balance)} and offer a link for that amount instead.`,
    );
  }

  if (amount < account.min_installment && amount !== account.balance) {
    throw fail(
      422,
      'AMOUNT_TOO_LOW',
      `${naira(amount)} is below the minimum installment of ${naira(account.min_installment)}.`,
      account.balance <= SCHOOL.minInstallment
        ? `The remaining balance is ${naira(account.balance)} and must be paid in full. Offer a link for exactly that amount. If they need a different arrangement, offer to pass it to the bursar.`
        : `Explain the minimum installment is ${naira(account.min_installment)}. Offer a link for at least that amount. If they cannot pay that much, offer to pass it to the bursar; do not agree to a lower amount yourself.`,
    );
  }

  const reference = makeReference(student.id);
  const base = baseUrl(req);
  const { authorizationUrl } = await provider.initialize(
    {
      email: student.parentEmail,
      amountKobo: amount * 100,
      reference,
      callbackUrl: `${base}/api/payment-complete`,
      metadata: {
        student_id: student.id,
        student_name: student.name,
        school: SCHOOL.name,
        term: SCHOOL.term,
        custom_fields: [
          { display_name: 'Student', variable_name: 'student', value: `${student.name} (${student.id})` },
          { display_name: 'Term', variable_name: 'term', value: SCHOOL.term },
        ],
      },
    },
    base,
  );

  res.json({
    ok: true,
    reference,
    payment_url: authorizationUrl,
    amount,
    student_id: student.id,
    student_name: student.name,
    balance_before: account.balance,
    balance_after_payment: account.balance - amount,
    mode: provider.mode,
    agent_hint:
      'Send the parent the payment_url exactly as given (do not shorten or change it) and the amount. Ask them to reply "paid" once they finish. Remember the reference: pass it to verify_payment when they say they have paid.',
  });
});

tools.post('/payment-link', createPaymentLink);
tools.get('/payment-link', createPaymentLink);

// ---------------------------------------------------------------------------
// TOOL 3: verify_payment
// Asks Paystack whether the payment really went through, then returns the new balance.
// With only student_id, it checks that student's most recent payment attempt
// (useful when the agent has lost the reference).
//
// A payment that failed or wasn't finished is NOT an error: the check itself worked.
// Those come back as ok:true with payment_status "failed" / "not_completed".

const NOT_COMPLETED = new Set(['abandoned', 'ongoing', 'pending', 'processing', 'queued']);

async function findTxn(reference: string, requestedStudent: Student | undefined): Promise<Txn> {
  const provider = getProvider();

  if (reference) {
    const txn = await provider.verify(reference);
    if (!txn) {
      throw fail(
        404,
        'REFERENCE_NOT_FOUND',
        `Paystack has no payment with reference "${reference}".`,
        'The reference may be mistyped. If you know the student ID, call verify_payment again with student_id only. Otherwise ask the parent for it.',
      );
    }
    if (requestedStudent && txn.studentId !== requestedStudent.id) {
      throw fail(
        409,
        'REFERENCE_STUDENT_MISMATCH',
        `Reference ${reference} is not for ${requestedStudent.id}.`,
        'Do not confirm anything. Ask the parent to confirm which child the payment was for, then check again.',
      );
    }
    return txn;
  }

  const latest = (await provider.listForStudent(requestedStudent!.id))[0];
  if (!latest) {
    throw fail(
      404,
      'NO_PAYMENT_FOUND',
      `No online payment attempts found for ${requestedStudent!.id} this term.`,
      'Tell the parent you cannot see an online payment for this child yet. If they paid by bank transfer or at the bursary, offer to pass it to the bursar to confirm. Otherwise offer to send a payment link.',
    );
  }
  // Re-verify for the freshest status; the list endpoint can lag.
  return (await provider.verify(latest.reference)) ?? latest;
}

const verifyPayment = asyncHandler(async (req, res) => {
  const input = readInput(req);
  const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
  const requestedStudent = input.student_id ? findStudent(input.student_id) : undefined;
  if (input.student_id && !requestedStudent) throw studentNotFound(input.student_id);
  if (requestedStudent) assertParent(requestedStudent, input.parent_phone);

  if (!reference && !requestedStudent) {
    throw fail(
      400,
      'MISSING_REFERENCE',
      'Send reference (preferred) or student_id.',
      "Ask the parent for their child's student ID so you can check the most recent payment.",
    );
  }

  const provider = getProvider();
  const txn = await findTxn(reference, requestedStudent);

  const student = STUDENTS.find((s) => s.id === normalizeStudentId(txn.studentId ?? ''));
  if (!student) {
    throw fail(
      409,
      'PAYMENT_NOT_FOR_THIS_SCHOOL',
      `Payment ${txn.reference} is not tagged with a known student.`,
      'Do not confirm anything. Offer to pass it to the bursar to check.',
    );
  }
  // Verifying by reference alone: the payment's student must be this parent's child too.
  assertParent(student, input.parent_phone);

  const amount = Math.round(txn.amountKobo / 100);
  const base = { ok: true, reference: txn.reference, student_id: student.id, student_name: student.name, amount };

  if (txn.status === 'success') {
    // Make sure this payment is counted even if the list endpoint hasn't caught up yet.
    const listed = await provider.listForStudent(student.id);
    const merged = listed.some((t) => t.reference === txn.reference) ? listed : [txn, ...listed];
    const account = await getAccount(student, provider, merged);
    return res.json({
      ...base,
      payment_status: 'success',
      paid_at: txn.paidAt,
      new_balance: account.balance,
      overpaid: account.overpaid,
      receipt_url: receiptUrl(baseUrl(req), txn.reference),
      receipt_image_url: receiptImageUrl(baseUrl(req), txn.reference),
      summary: `${naira(amount)} received for ${student.name}. New balance: ${naira(account.balance)}.`,
      agent_hint:
        (account.overpaid > 0
          ? 'Confirm the payment and tell the parent the fees are fully paid. Say there is an overpayment and the bursar will contact them about it.'
          : account.balance === 0
            ? 'Confirm the payment and congratulate the parent: fees are now fully paid.'
            : `Confirm the payment and tell the parent the new balance (${naira(account.balance)}).`) +
        ' Send the receipt_url exactly as given: it opens their receipt with a Download button. If you can send images, you can also send receipt_image_url (the PNG itself).',
    });
  }

  if (txn.status === 'failed') {
    return res.json({
      ...base,
      payment_status: 'failed',
      gateway_response: txn.gatewayResponse,
      agent_hint: `The payment failed${txn.gatewayResponse ? ` (bank said: ${txn.gatewayResponse})` : ''}. Tell the parent no money was taken for this attempt, and offer a new payment link so they can try again, perhaps with a different card or bank.`,
    });
  }

  if (NOT_COMPLETED.has(txn.status)) {
    return res.json({
      ...base,
      payment_status: 'not_completed',
      paystack_status: txn.status,
      agent_hint:
        'The payment has not gone through yet. Ask the parent whether they finished on the Paystack page. If they did, ask them to wait a minute and you will check again. If they closed the page, offer a new link.',
    });
  }

  if (txn.status === 'reversed') {
    return res.json({
      ...base,
      payment_status: 'reversed',
      agent_hint: 'This payment was reversed. Do not count it. Tell the parent you are passing this to the bursar to sort out.',
    });
  }

  res.json({
    ...base,
    payment_status: 'unknown',
    paystack_status: txn.status,
    agent_hint: 'The payment status is unclear. Do not confirm it. Tell the parent you are passing it to the bursar to check.',
  });
});

tools.post('/verify', verifyPayment);
tools.get('/verify', verifyPayment);

// ---------------------------------------------------------------------------
// TOOL 4: get_payment_history
// Everything paid this term: bursary payments (one total from school records) and every
// online payment with its receipt link. For "what have I paid?" and "I lost my receipt".
// Unfinished or failed attempts are listed separately so the agent can explain them if asked.

const getPaymentHistory = asyncHandler(async (req, res) => {
  const student = requireStudent(readInput(req));
  const provider = getProvider();
  const txns = await provider.listForStudent(student.id);
  const account = await getAccount(student, provider, txns);
  const base = baseUrl(req);

  const statusOf = (status: string) => (NOT_COMPLETED.has(status) ? 'not_completed' : status);
  const payments = txns
    .filter((t) => t.status === 'success')
    .map((t) => ({
      reference: t.reference,
      amount: Math.round(t.amountKobo / 100),
      paid_at: t.paidAt,
      receipt_url: receiptUrl(base, t.reference),
    }));
  const otherAttempts = txns
    .filter((t) => t.status !== 'success')
    .map((t) => ({ reference: t.reference, amount: Math.round(t.amountKobo / 100), status: statusOf(t.status), created_at: t.createdAt }));

  res.json({
    ok: true,
    student_id: student.id,
    student_name: student.name,
    term: SCHOOL.term,
    total_fees: account.total_fees,
    paid_at_bursary: account.paid_offline,
    paid_online: account.paid_online,
    balance: account.balance,
    payments,
    other_attempts: otherAttempts,
    agent_hint:
      payments.length === 0
        ? `There are no online payments this term${account.paid_offline ? `; ${naira(account.paid_offline)} was paid at the bursary, and the bursar issues receipts for that` : ''}. Tell the parent briefly. If they believe they paid online, offer to check with verify_payment or pass it to the bursar.`
        : 'List the online payments briefly (date and amount, newest first) and the bursary total if any. If the parent wants a receipt, send the receipt_url for that payment exactly as given. Bursary payments have no online receipt: the bursar issues those. Only mention other_attempts if the parent asks about a payment that is not in the list.',
  });
});

tools.get('/payments', getPaymentHistory);
tools.post('/payments', getPaymentHistory);

// ---------------------------------------------------------------------------
// TOOL 5: hand_over_to_bursar
// Records a case the agent can't handle (disputes, refunds, discounts, upset parents,
// non-fee questions) and notifies the bursar. Without this, "I'll pass it to the bursar"
// would go nowhere.
//
// Delivery: always logged as a [handover] line (Vercel logs). If BURSAR_WEBHOOK_URL is set,
// also POSTed there: Slack incoming webhooks show the `text`, anything else gets the JSON.
// Works without a parent check on purpose: a parent whose number changed must still reach a human.

const HANDOVER_REASONS = new Set(['dispute', 'refund', 'discount', 'deadline', 'missing_payment', 'reversed_payment', 'sensitive', 'not_fees', 'system_down', 'other']);

const handOver = asyncHandler(async (req, res) => {
  const input = readInput(req);
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (!summary) {
    throw fail(
      400,
      'MISSING_SUMMARY',
      'summary is required.',
      'Call hand_over_to_bursar again with a one or two sentence summary of what the parent needs.',
    );
  }

  const reason = typeof input.reason === 'string' && HANDOVER_REASONS.has(input.reason) ? input.reason : 'other';
  const student = input.student_id ? findStudent(input.student_id) : undefined;
  const handover = {
    handover_id: `HO-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex')}`,
    reason,
    student_id: student?.id ?? (input.student_id ? String(input.student_id) : null),
    parent_phone: input.parent_phone ? String(input.parent_phone) : null,
    reference: input.reference ? String(input.reference) : null,
    summary: summary.slice(0, 1000),
    created_at: new Date().toISOString(),
  };
  console.log(`[handover] ${JSON.stringify(handover)}`);

  let delivered = 'log';
  const webhook = process.env.BURSAR_WEBHOOK_URL;
  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text:
            `New fees handover ${handover.handover_id} (${reason})\n` +
            `Student: ${handover.student_id ?? 'not given'}${student ? ` (${student.name})` : ''}\n` +
            `Parent: ${handover.parent_phone ?? 'unknown number'}\n` +
            (handover.reference ? `Payment ref: ${handover.reference}\n` : '') +
            `Summary: ${handover.summary}`,
          ...handover,
        }),
        signal: AbortSignal.timeout(5000),
      });
      delivered = r.ok ? 'webhook' : 'log';
      if (!r.ok) console.error(`[handover] webhook returned HTTP ${r.status}`);
    } catch (err) {
      console.error('[handover] webhook failed', err);
    }
  }

  res.json({
    ok: true,
    handover_id: handover.handover_id,
    delivered,
    agent_hint: `Tell the parent you've passed this to ${SCHOOL.bursar}, who will reach out during school hours (Mon–Fri, 8am–4pm). Give them the handover ID ${handover.handover_id} in case they need to follow up. Do not promise any outcome.`,
  });
});

tools.post('/handover', handOver);
