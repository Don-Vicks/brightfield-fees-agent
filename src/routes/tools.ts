// The three tools the Chord agent calls. All require the API key.
//
//   GET|POST /api/balance        { student_id }           get_fee_balance
//   POST|GET /api/payment-link   { student_id, amount }   create_payment_link
//   POST|GET /api/verify         { reference | student_id } verify_payment
//
// Errors are thrown as ToolError (or UpstreamError from Paystack) and formatted by the error middleware.

import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { SCHOOL, STUDENTS, Student, findStudent, normalizeStudentId } from '../lib/data';
import { getAccount, missingStudentId, studentNotFound } from '../lib/fees';
import { baseUrl, fail, naira, parseNaira, readInput } from '../lib/http';
import { Txn, getProvider } from '../lib/paystack';
import { receiptUrl } from '../lib/receipt';
import { asyncHandler } from '../middleware/async';
import { requireApiKey } from '../middleware/auth';

export const tools = Router();
tools.use(requireApiKey);

function requireStudent(raw: unknown): Student {
  if (!raw) throw missingStudentId();
  const student = findStudent(raw);
  if (!student) throw studentNotFound(raw);
  return student;
}

// ---------------------------------------------------------------------------
// TOOL 1: get_fee_balance
// What the student owes this term, worked out live from school records + Paystack.

const getBalance = asyncHandler(async (req, res) => {
  const student = requireStudent(readInput(req).student_id);
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
  const student = requireStudent(input.student_id);
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
        `Reference ${reference} belongs to ${txn.studentId ?? 'no student'}, not ${requestedStudent.id}.`,
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
      summary: `${naira(amount)} received for ${student.name}. New balance: ${naira(account.balance)}.`,
      agent_hint:
        (account.overpaid > 0
          ? 'Confirm the payment and tell the parent the fees are fully paid. Say there is an overpayment and the bursar will contact them about it.'
          : account.balance === 0
            ? 'Confirm the payment and congratulate the parent: fees are now fully paid.'
            : `Confirm the payment and tell the parent the new balance (${naira(account.balance)}).`) +
        ' Send the receipt_url exactly as given (it is a PNG receipt image they can save).',
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
