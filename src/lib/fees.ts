// Fee account logic.
//
// Design choice: Paystack IS the ledger for online payments.
//   amount paid = paidOffline (school records) + every successful Paystack
//                 payment tagged with this student_id
//   balance     = total fees - amount paid
// We never store "balance" anywhere, we recompute it. That means:
//   - verifying the same payment twice can't double-count it
//   - a parent who pays but never says "paid" still gets credit next time
//   - no database to keep in sync on a serverless host

import { SCHOOL, Student, totalFees } from './data';
import { PaymentsProvider, Txn, UpstreamError } from './paystack';
import { ToolError, fail, naira } from './http';

export interface Account {
  student_id: string;
  student_name: string;
  class: string;
  term: string;
  total_fees: number;
  paid_offline: number;
  paid_online: number;
  amount_paid: number;
  balance: number;
  overpaid: number;
  min_installment: number;
  due_date: string;
  fee_breakdown: { item: string; amount: number }[];
  online_payments: { reference: string; amount: number; paid_at: string | null }[];
  summary: string;
}

export async function getAccount(student: Student, provider: PaymentsProvider, txns?: Txn[]): Promise<Account> {
  const all = txns ?? (await provider.listForStudent(student.id));
  const successful = all.filter((t) => t.status === 'success');
  const paidOnline = successful.reduce((sum, t) => sum + Math.round(t.amountKobo / 100), 0);
  const total = totalFees(student);
  const paid = student.paidOffline + paidOnline;
  const balance = Math.max(0, total - paid);
  const overpaid = Math.max(0, paid - total);
  // If what's left is below the minimum installment, the parent can only pay the remainder.
  const minInstallment = Math.min(SCHOOL.minInstallment, balance);

  const summary =
    balance === 0
      ? `${student.name}'s ${SCHOOL.term} fees are fully paid (${naira(total)}).` +
        (overpaid ? ` There is an overpayment of ${naira(overpaid)}.` : '')
      : `${student.name} (${student.className}): total ${naira(total)}, paid ${naira(paid)}, balance ${naira(balance)}. ` +
        (balance <= SCHOOL.minInstallment
          ? `Since the balance is ${naira(balance)}, it must be paid in full.`
          : `Minimum installment is ${naira(SCHOOL.minInstallment)}.`) +
        ` Due by ${SCHOOL.dueDate}.`;

  return {
    student_id: student.id,
    student_name: student.name,
    class: student.className,
    term: SCHOOL.term,
    total_fees: total,
    paid_offline: student.paidOffline,
    paid_online: paidOnline,
    amount_paid: paid,
    balance,
    overpaid,
    min_installment: minInstallment,
    due_date: SCHOOL.dueDate,
    fee_breakdown: student.fees,
    online_payments: successful.map((t) => ({
      reference: t.reference,
      amount: Math.round(t.amountKobo / 100),
      paid_at: t.paidAt,
    })),
    summary,
  };
}

export const studentNotFound = (raw: unknown) =>
  fail(
    404,
    'STUDENT_NOT_FOUND',
    `No student with ID "${String(raw ?? '')}".`,
    'Tell the parent you could not find that student ID and ask them to check it. IDs look like BFA-0142 and are on the school ID card and the fee invoice. Never guess a student or a balance.',
  );

export const missingStudentId = () =>
  fail(
    400,
    'MISSING_STUDENT_ID',
    'student_id is required.',
    "Ask the parent for their child's student ID (looks like BFA-0142, on the ID card or fee invoice).",
  );

/** Converts a provider failure into the standard tool error. Rethrows anything else. */
export function upstreamFailure(err: unknown): ToolError {
  if (err instanceof UpstreamError) {
    console.error(`[paystack:${err.kind}]`, err.message);
    if (err.kind === 'config') {
      return fail(
        500,
        'CONFIG_ERROR',
        err.message,
        'The payment system is not set up correctly. Apologise, say online payment is unavailable right now, and offer to pass the request to the bursar.',
      );
    }
    return fail(
      502,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      err.message,
      'Paystack is not responding right now. Tell the parent the payment system is temporarily unavailable and ask them to try again in a few minutes. Do NOT say a payment succeeded or failed. If they already paid, reassure them it will be checked and offer to pass it to the bursar.',
    );
  }
  throw err;
}
