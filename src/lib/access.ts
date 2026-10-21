// Who may ask about which child.
//
// Student IDs are sequential (BFA-0142, BFA-0143, ...), so knowing or guessing an ID
// must not be enough to see a child's fees. Each student record has the parent's
// WhatsApp number; when the platform passes the sender's number as parent_phone,
// the API only answers for that parent's own children.
//
//   parent_phone sent, matches         -> allowed
//   parent_phone sent, doesn't match   -> PARENT_NOT_VERIFIED (always)
//   parent_phone missing               -> allowed, unless REQUIRE_PARENT_PHONE=true
//
// DEMO_PARENT_PHONES (comma-separated) adds numbers that count as the parent of
// every student, so testers can use their own WhatsApp number.

import { Student, normalizePhone } from './data';
import { fail } from './http';

export const parentCheckRequired = () => process.env.REQUIRE_PARENT_PHONE === 'true';

const demoPhones = () =>
  (process.env.DEMO_PARENT_PHONES ?? '')
    .split(',')
    .map(normalizePhone)
    .filter((p): p is string => p !== null);

export function assertParent(student: Student, rawPhone: unknown): void {
  const given = rawPhone === undefined || rawPhone === null || rawPhone === '' ? null : rawPhone;

  if (given === null) {
    if (!parentCheckRequired()) return;
    throw fail(
      400,
      'PARENT_PHONE_REQUIRED',
      "parent_phone (the sender's WhatsApp number) is required.",
      'This is a setup problem, not the parent\'s fault. Do not share any fee details. Apologise and offer to pass the request to the bursar.',
    );
  }

  const phone = normalizePhone(given);
  if (phone && (phone === normalizePhone(student.parentPhone) || demoPhones().includes(phone))) return;

  throw fail(
    403,
    'PARENT_NOT_VERIFIED',
    `This phone number is not on file as a parent of ${student.id}.`,
    "Do not share any details about this student, and do not say whether the ID exists. Tell the parent you can only discuss a child from the phone number the school has on file for them, and offer to pass it to the bursar to update their number.",
  );
}
