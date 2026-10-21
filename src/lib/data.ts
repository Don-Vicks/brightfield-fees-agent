// Made-up school and students. No real people, no real data.
// This file is the "school records" the bursar keeps. Payments made OUTSIDE
// this system (bank transfer at the bursary, cash) are in `paidOffline`.
// Payments made through the agent are NOT stored here: they live in Paystack,
// and the balance is worked out from Paystack every time (see lib/fees.ts).

export interface FeeItem {
  item: string;
  amount: number; // naira
}

export interface Student {
  id: string; // e.g. BFA-0142
  name: string;
  className: string;
  parentName: string;
  parentEmail: string; // made-up, used only as the Paystack customer email
  parentPhone: string; // made-up WhatsApp number on file; only this number may ask about the child
  fees: FeeItem[];
  paidOffline: number; // naira already paid before / outside the agent
}

export const SCHOOL = {
  name: 'Brightfield Academy',
  location: 'Lekki, Lagos',
  term: 'First Term 2026/2027',
  dueDate: '2026-11-27',
  minInstallment: 100_000, // naira
  bursar: 'Mrs. Ngozi Okonkwo (Bursar)',
};

const standard = (tuition: number): FeeItem[] => [
  { item: 'Tuition', amount: tuition },
  { item: 'Development levy', amount: 40_000 },
  { item: 'Books and materials', amount: 35_000 },
  { item: 'ICT and lab', amount: 25_000 },
];

export const STUDENTS: Student[] = [
  {
    id: 'BFA-0142',
    name: 'Tobi Adeyemi',
    className: 'JSS 2',
    parentName: 'Mrs. Funke Adeyemi',
    parentEmail: 'parent.bfa0142@example.com',
    parentPhone: '+2348035550142',
    fees: standard(350_000), // 450,000
    paidOffline: 200_000,
  },
  {
    id: 'BFA-0217',
    name: 'Amara Okafor',
    className: 'SS 1',
    parentName: 'Mr. Emeka Okafor',
    parentEmail: 'parent.bfa0217@example.com',
    parentPhone: '+2348035550217',
    fees: standard(420_000), // 520,000
    paidOffline: 0,
  },
  {
    id: 'BFA-0088',
    name: 'Daniel Bello',
    className: 'Primary 5',
    parentName: 'Mrs. Hauwa Bello',
    parentEmail: 'parent.bfa0088@example.com',
    parentPhone: '+2348035550088',
    fees: standard(280_000), // 380,000
    paidOffline: 380_000, // fully paid
  },
  {
    id: 'BFA-0305',
    name: 'Zainab Musa',
    className: 'JSS 1',
    parentName: 'Alhaji Ibrahim Musa',
    parentEmail: 'parent.bfa0305@example.com',
    parentPhone: '+2348035550305',
    fees: standard(350_000), // 450,000
    paidOffline: 390_000, // balance 60,000: below the minimum installment
  },
  {
    id: 'BFA-0151',
    name: 'Chidi Eze',
    className: 'SS 3',
    parentName: 'Mrs. Adaeze Eze',
    parentEmail: 'parent.bfa0151@example.com',
    parentPhone: '+2348035550151',
    fees: standard(460_000), // 560,000
    paidOffline: 280_000,
  },
];

export const totalFees = (s: Student) => s.fees.reduce((sum, f) => sum + f.amount, 0);

/** Accepts "BFA-0142", "bfa 0142", "BFA0142", "0142", "142". */
export function normalizeStudentId(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().toUpperCase();
  const m = s.match(/^(?:BFA)?[\s\-_/]*0*(\d{1,4})$/);
  if (!m) return null;
  return `BFA-${m[1].padStart(4, '0')}`;
}

export function findStudent(raw: unknown): Student | undefined {
  const id = normalizeStudentId(raw);
  return id ? STUDENTS.find((s) => s.id === id) : undefined;
}

/**
 * Normalises a Nigerian phone number to 234XXXXXXXXXX.
 * Accepts "+234 803 555 0142", "2348035550142", "08035550142", "whatsapp:+234...".
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`;
  return /^234\d{10}$/.test(d) ? d : null;
}
