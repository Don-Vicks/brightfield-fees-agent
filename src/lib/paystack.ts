// Payments provider: real Paystack (test mode) or an in-memory mock.
// Both implement the same interface, so the endpoints don't care which is running.
//
// Real mode docs:
//   Initialize: POST https://api.paystack.co/transaction/initialize
//   Verify:     GET  https://api.paystack.co/transaction/verify/:reference
//   List:       GET  https://api.paystack.co/transaction

export type TxnStatus =
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'ongoing'
  | 'pending'
  | 'processing'
  | 'queued'
  | 'reversed'
  | string;

export interface Txn {
  reference: string;
  status: TxnStatus;
  amountKobo: number;
  studentId: string | null;
  createdAt: string;
  paidAt: string | null;
  gatewayResponse: string | null;
}

export interface InitializeInput {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface PaymentsProvider {
  mode: 'paystack-test' | 'mock';
  initialize(input: InitializeInput, checkoutBase: string): Promise<{ authorizationUrl: string }>;
  /** Returns null when Paystack has no transaction with that reference. */
  verify(reference: string): Promise<Txn | null>;
  /** All transactions for a student this term, newest first. */
  listForStudent(studentId: string): Promise<Txn[]>;
}

/** Thrown when Paystack is unreachable, slow, or answers with an unexpected error. */
export class UpstreamError extends Error {
  constructor(
    public kind: 'timeout' | 'network' | 'http' | 'config',
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8_000;

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

// ---------------------------------------------------------------- real Paystack

class PaystackProvider implements PaymentsProvider {
  mode = 'paystack-test' as const;
  constructor(private secretKey: string) {}

  private async call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response;
    try {
      res = await fetch(`https://api.paystack.co${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new UpstreamError('timeout', `Paystack did not answer within ${TIMEOUT_MS / 1000}s (${path})`);
      }
      throw new UpstreamError('network', `Could not reach Paystack: ${err?.message ?? err} (${path})`);
    }
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new UpstreamError('http', `Paystack returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    return { status: res.status, body };
  }

  private toTxn(d: any): Txn {
    const meta = parseMetadata(d?.metadata);
    return {
      reference: String(d.reference),
      status: String(d.status),
      amountKobo: Number(d.amount) || 0,
      studentId: typeof meta.student_id === 'string' ? meta.student_id : null,
      createdAt: d.created_at ?? d.createdAt ?? new Date(0).toISOString(),
      paidAt: d.paid_at ?? d.paidAt ?? null,
      gatewayResponse: d.gateway_response ?? null,
    };
  }

  async initialize(input: InitializeInput) {
    const { status, body } = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        reference: input.reference,
        callback_url: input.callbackUrl,
        currency: 'NGN',
        metadata: input.metadata,
      }),
    });
    if (status !== 200 || !body?.status || !body?.data?.authorization_url) {
      throw new UpstreamError('http', `Paystack initialize failed (HTTP ${status}): ${body?.message ?? 'no message'}`, status);
    }
    return { authorizationUrl: body.data.authorization_url as string };
  }

  async verify(reference: string) {
    const { status, body } = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`);
    // Paystack answers an unknown reference with HTTP 400 "Transaction reference not found"
    if (status === 400 || status === 404) {
      if (/not found/i.test(body?.message ?? '')) return null;
    }
    if (status !== 200 || !body?.status || !body?.data) {
      throw new UpstreamError('http', `Paystack verify failed (HTTP ${status}): ${body?.message ?? 'no message'}`, status);
    }
    return this.toTxn(body.data);
  }

  async listForStudent(studentId: string) {
    const from = process.env.TERM_START || '2026-09-01';
    const found: Txn[] = [];
    // Paystack can't filter by metadata, so we page through this term's
    // transactions and filter ourselves. Fine for a demo; see README "Limits".
    for (let page = 1; page <= 5; page++) {
      const { status, body } = await this.call(`/transaction?perPage=100&page=${page}&from=${from}`);
      if (status !== 200 || !body?.status || !Array.isArray(body?.data)) {
        throw new UpstreamError('http', `Paystack list transactions failed (HTTP ${status}): ${body?.message ?? 'no message'}`, status);
      }
      for (const d of body.data) {
        const t = this.toTxn(d);
        if (t.studentId === studentId) found.push(t);
      }
      const pageCount = Number(body?.meta?.pageCount ?? 1);
      if (page >= pageCount) break;
    }
    return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

// ---------------------------------------------------------------- mock

// In-memory store. Survives only while the process is running, so mock mode is
// for local testing. On Vercel, separate function instances don't share memory.
const mockStore: Map<string, Txn> = ((globalThis as any).__bfaMockStore ??= new Map<string, Txn>());

class MockProvider implements PaymentsProvider {
  mode = 'mock' as const;

  async initialize(input: InitializeInput, checkoutBase: string) {
    const meta = parseMetadata(input.metadata);
    mockStore.set(input.reference, {
      reference: input.reference,
      status: 'abandoned', // Paystack shows "abandoned" until the customer completes checkout
      amountKobo: input.amountKobo,
      studentId: typeof meta.student_id === 'string' ? meta.student_id : null,
      createdAt: new Date().toISOString(),
      paidAt: null,
      gatewayResponse: null,
    });
    return {
      authorizationUrl: `${checkoutBase}/api/mock-checkout?reference=${encodeURIComponent(input.reference)}`,
    };
  }

  async verify(reference: string) {
    return mockStore.get(reference) ?? null;
  }

  async listForStudent(studentId: string) {
    return [...mockStore.values()]
      .filter((t) => t.studentId === studentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Mock checkout actions (used by /api/mock-checkout only). */
export function mockSettle(reference: string, outcome: 'success' | 'failed'): Txn | null {
  const t = mockStore.get(reference);
  if (!t) return null;
  t.status = outcome;
  t.paidAt = outcome === 'success' ? new Date().toISOString() : null;
  t.gatewayResponse = outcome === 'success' ? 'Approved' : 'Declined';
  return t;
}

// ---------------------------------------------------------------- factory

export function getProvider(): PaymentsProvider {
  const key = (process.env.PAYSTACK_SECRET_KEY ?? '').trim();
  if (process.env.MOCK_PAYSTACK === 'true' || !key) return new MockProvider();
  if (key.startsWith('sk_live_')) {
    throw new UpstreamError('config', 'A LIVE Paystack key is configured. This project only runs with test keys (sk_test_...).');
  }
  if (!key.startsWith('sk_test_')) {
    throw new UpstreamError('config', 'PAYSTACK_SECRET_KEY does not look like a Paystack test secret key (should start with sk_test_).');
  }
  return new PaystackProvider(key);
}
