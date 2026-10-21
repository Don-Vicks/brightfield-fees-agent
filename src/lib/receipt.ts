// Payment receipt image (PNG) for a verified Paystack payment.
//
// verify_payment returns a receipt_url (page) and receipt_image_url (PNG) only when payment_status is "success".
// The URL is public, so the agent can send it on WhatsApp. It carries an HMAC
// signature of the reference, which stops anyone from guessing receipt URLs.
// The receipt route re-verifies with Paystack before drawing anything, so a
// receipt can never be shown for a payment that didn't go through.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { SCHOOL, Student } from './data';
import { Txn } from './paystack';

// Signs with TOOL_API_KEY so there's no extra secret to configure.
// Without a key (local dev, auth disabled) receipts are unsigned.
const secret = () => process.env.TOOL_API_KEY ?? '';

export function signReference(reference: string): string {
  return createHmac('sha256', secret()).update(reference).digest('hex').slice(0, 32);
}

export function validSignature(reference: string, sig: unknown): boolean {
  if (!secret()) return true;
  if (typeof sig !== 'string') return false;
  const expected = Buffer.from(signReference(reference));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Receipt page: shows the image with a Download button, and gives WhatsApp an image link preview. */
export function receiptUrl(base: string, reference: string): string {
  return `${base}/api/receipt/${encodeURIComponent(reference)}?sig=${signReference(reference)}`;
}

/** The PNG itself. Add &download=1 to make browsers save it instead of showing it. */
export function receiptImageUrl(base: string, reference: string): string {
  return `${base}/api/receipt/${encodeURIComponent(reference)}.png?sig=${signReference(reference)}`;
}

export interface ReceiptData {
  student: Student;
  txn: Txn;
  balanceAfter: number;
}

// Minimal element builder: @vercel/og takes React-style element objects, so no JSX/React needed.
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

const C = { bg: '#f6f5f2', card: '#ffffff', ink: '#1a1a1a', muted: '#6b6b6b', line: '#e3e0d9', accent: '#0b6b3a', tint: '#e7f3ec' };

// Inter has no ₦ glyph, so the receipt spells out the currency.
const ngn = (n: number) => `NGN ${n.toLocaleString('en-NG')}`;

const row = (label: string, value: string) =>
  h(
    'div',
    { justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${C.line}`, fontSize: 26 },
    h('div', { color: C.muted }, label),
    h('div', { color: C.ink, fontWeight: 700 }, value),
  );

function formatDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
}

export async function renderReceipt({ student, txn, balanceAfter }: ReceiptData): Promise<Buffer> {
  const amount = Math.round(txn.amountKobo / 100);

  const tree = h(
    'div',
    { width: WIDTH, height: HEIGHT, background: C.bg, padding: PAD, alignItems: 'flex-start', fontFamily: 'Inter' },
    h(
      'div',
      { flexDirection: 'column', width: WIDTH - PAD * 2 - 2 * 48 - 2, background: C.card, borderRadius: 24, padding: 48, // satori widths exclude padding + border
        border: `1px solid ${C.line}` },
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center' },
        h(
          'div',
          { flexDirection: 'column' },
          h('div', { fontSize: 34, fontWeight: 700, color: C.ink }, SCHOOL.name),
          h('div', { fontSize: 22, color: C.muted, marginTop: 4 }, `${SCHOOL.location} · School fees receipt`),
        ),
        h('div', { background: C.tint, color: C.accent, fontSize: 22, fontWeight: 700, padding: '10px 20px', borderRadius: 999 }, 'PAID'),
      ),
      h(
        'div',
        { flexDirection: 'column', alignItems: 'center', margin: '44px 0 32px' },
        h('div', { fontSize: 24, color: C.muted }, 'Amount received'),
        h('div', { fontSize: 76, fontWeight: 700, color: C.accent, marginTop: 4 }, ngn(amount)),
      ),
      h(
        'div',
        { flexDirection: 'column' },
        row('Student', `${student.name} (${student.id})`),
        row('Class', student.className),
        row('Term', SCHOOL.term),
        row('Date paid', formatDate(txn.paidAt)),
        row('Reference', txn.reference),
        row('Balance remaining', balanceAfter === 0 ? 'Fully paid' : ngn(balanceAfter)),
      ),
      h(
        'div',
        { fontSize: 20, color: C.muted, marginTop: 32 },
        `Paid online via Paystack (test mode). Questions? Contact ${SCHOOL.bursar}.`,
      ),
    ),
  );

  // satori lays the tree out as SVG, resvg rasterises it to PNG.
  const svg = await satori(tree as never, { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}

const WIDTH = 1000;
const HEIGHT = 890;
const PAD = 48;

// Inter, latin + latin-ext. Loaded once per cold start.
type Font = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' };
let fonts: Font[] | undefined;
function loadFonts(): Font[] {
  if (!fonts) {
    const dir = join(__dirname, '..', 'assets', 'fonts');
    fonts = (['latin', 'latin-ext'] as const).flatMap((subset) =>
      ([400, 700] as const).map((weight) => ({
        name: 'Inter',
        data: readFileSync(join(dir, `inter-${subset}-${weight}-normal.woff`)),
        weight,
        style: 'normal' as const,
      })),
    );
  }
  return fonts;
}
