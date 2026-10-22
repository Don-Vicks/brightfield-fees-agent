// Logs the SHAPE of each tool call: which headers, query and body fields the platform sent.
// Used to find out what Chord passes besides our declared parameters, in particular
// whether the sender's WhatsApp number is available (needed for the parent check).
//
// Values are never logged, except phone-like values, which are masked (+234*****0142).
// Turn off with LOG_TOOL_REQUESTS=false.

import type { NextFunction, Request, Response } from 'express';

const PHONE_LIKE = /^\+?[\d\s\-().]{10,18}$/;
// Standard proxy/infra headers, not interesting for this purpose.
const IGNORED = /^(x-vercel-|x-forwarded-|x-real-ip$|forwarded$|via$|connection$|accept-encoding$|content-length$|host$)/;

const mask = (v: string) => {
  const d = v.replace(/\D/g, '');
  return d.length < 8 ? '***' : `+${d.slice(0, 3)}*****${d.slice(-4)}`;
};

function phoneLike(source: string, obj: Record<string, unknown>, out: string[]) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && PHONE_LIKE.test(v.trim()) && v.replace(/\D/g, '').length >= 10) out.push(`${source}.${k}=${mask(v)}`);
    else if (v && typeof v === 'object' && !Array.isArray(v)) phoneLike(`${source}.${k}`, v as Record<string, unknown>, out);
  }
}

export function inspectToolCall(req: Request, _res: Response, next: NextFunction) {
  if (process.env.LOG_TOOL_REQUESTS === 'false') return next();

  const headers = Object.keys(req.headers).filter((h) => !IGNORED.test(h));
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const phones: string[] = [];
  phoneLike('header', Object.fromEntries(headers.map((h) => [h, String(req.headers[h])])), phones);
  phoneLike('query', req.query as Record<string, unknown>, phones);
  phoneLike('body', body, phones);

  console.log(
    `[tool-call] ${req.method} ${req.path} headers=[${headers.join(',')}] query=[${Object.keys(req.query).join(',')}] body=[${Object.keys(body).join(',')}] phone_like=[${phones.join(',') || 'none'}]`,
  );
  next();
}
