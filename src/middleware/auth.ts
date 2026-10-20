// Checks the shared API key Chord sends with every tool call.
// Accepts x-api-key, Authorization: Bearer, or ?key= (only when ALLOW_KEY_IN_QUERY=true).

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { fail } from '../lib/http';

export function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.TOOL_API_KEY;
  if (!expected) return next(); // auth disabled (shown as a warning on /api/health)

  const header = req.get('x-api-key') ?? '';
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const query = process.env.ALLOW_KEY_IN_QUERY === 'true' && typeof req.query.key === 'string' ? req.query.key : '';

  if ([header, bearer, query].some((v) => v && safeEqual(v, expected))) return next();

  next(
    fail(
      401,
      'UNAUTHORIZED',
      'Missing or wrong API key. Send it as the x-api-key header (or Authorization: Bearer <key>).',
      "This is a setup problem, not the parent's fault. Apologise, say the payment system is unavailable right now, and offer to pass the request to the bursar.",
    ),
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
