// Turns anything a route throws into the standard error shape:
//   { ok: false, error: { code, message, agent_hint } }
// ERRORS_AS_200=true sends errors with HTTP 200, for tool platforms that hide non-2xx bodies.

import type { NextFunction, Request, Response } from 'express';
import { upstreamFailure } from '../lib/fees';
import { ToolError, fail } from '../lib/http';
import { UpstreamError } from '../lib/paystack';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(fail(404, 'NOT_FOUND', `No route ${req.method} ${req.path}`, 'This is a setup problem. Apologise and offer to pass the request to the bursar.'));
}

// Express recognises error middleware by its 4 arguments, so `_next` must stay.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const toolError = toToolError(err);
  const status = process.env.ERRORS_AS_200 === 'true' ? 200 : toolError.status;
  res.status(status).json(toolError);
}

function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof UpstreamError) return upstreamFailure(err);

  // express.json() parse failure
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    const body = String((err as { body?: unknown }).body ?? '');
    return fail(
      400,
      'INVALID_JSON',
      `Request body is not valid JSON: ${body.slice(0, 120)}`,
      'This is a setup problem. Apologise and offer to pass the request to the bursar.',
    );
  }

  console.error('[unhandled]', err);
  return fail(
    500,
    'INTERNAL_ERROR',
    err instanceof Error ? err.message : String(err),
    'Something broke on our side. Apologise, say the payment system is having a problem, and offer to pass the request to the bursar. Do not tell the parent a payment succeeded or failed.',
  );
}
