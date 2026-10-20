// Shared HTTP helpers: error type, input parsing, formatting.
//
// Every error the agent can receive has the same shape:
//   { ok: false, error: { code, message, agent_hint } }
// `message` is what went wrong (for logs and humans).
// `agent_hint` tells the agent what to say or do next, so it never has to guess.
//
// Routes `throw fail(...)`; the error middleware (src/middleware/errors.ts) turns it into JSON.

import type { Request } from 'express';

export class ToolError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public agent_hint: string,
  ) {
    super(message);
  }

  toJSON() {
    return { ok: false, error: { code: this.code, message: this.message, agent_hint: this.agent_hint } };
  }
}

export const fail = (status: number, code: string, message: string, agent_hint: string) =>
  new ToolError(status, code, message, agent_hint);

/**
 * Merges query string and JSON body (body wins).
 * Tool platforms differ on where they put parameters, so we accept both.
 * Also accepts camelCase keys (studentId) as well as snake_case (student_id).
 */
export function readInput(req: Request): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'key' && typeof v === 'string') input[k] = v;
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) Object.assign(input, req.body);

  // camelCase -> snake_case aliases
  const aliases: Record<string, string> = { studentId: 'student_id', parentEmail: 'parent_email' };
  for (const [from, to] of Object.entries(aliases)) {
    if (input[from] !== undefined && input[to] === undefined) input[to] = input[from];
  }
  return input;
}

/**
 * Parses a naira amount the way people type it:
 * 150000, "150000", "150,000", "₦150,000", "NGN 150000", "150k", "1.2m".
 * Returns null if it can't be read as a positive whole-naira amount.
 */
export function parseNaira(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/₦|ngn|naira|,|\s/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return n > 0 ? Math.round(n) : null;
}

export const naira = (n: number) => `₦${n.toLocaleString('en-NG')}`;

/** Public base URL of this API, for building callback/checkout links. */
export function baseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${proto}://${host}`;
}
