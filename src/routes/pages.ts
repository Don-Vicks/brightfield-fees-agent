// Public pages a parent opens in their browser. No API key.
//
//   GET /api/health             is the API up and configured? (also wakes it before a demo)
//   GET /api/payment-complete   where Paystack sends the parent after checkout (callback_url)
//   GET /api/mock-checkout      fake checkout page, MOCK MODE ONLY

import { Router } from 'express';
import { SCHOOL, STUDENTS, findStudent } from '../lib/data';
import { naira } from '../lib/http';
import { esc, page } from '../lib/page';
import { getProvider, mockSettle } from '../lib/paystack';
import { asyncHandler } from '../middleware/async';

export const pages = Router();

pages.get('/health', (_req, res) => {
  const warnings: string[] = [];
  let mode = 'unknown';
  try {
    mode = getProvider().mode;
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
  }
  if (!process.env.TOOL_API_KEY) warnings.push('TOOL_API_KEY is not set: tool endpoints are open to anyone.');
  if (mode === 'mock') warnings.push('Running in MOCK mode (no PAYSTACK_SECRET_KEY). Payments are fake and reset on restart.');
  if (process.env.ERRORS_AS_200 === 'true') warnings.push('ERRORS_AS_200 is on: errors return HTTP 200 with ok:false.');

  res.json({
    ok: mode !== 'unknown', // false = Paystack key is misconfigured
    service: 'brightfield-fees-agent',
    school: SCHOOL.name,
    term: SCHOOL.term,
    payments_mode: mode,
    auth: process.env.TOOL_API_KEY ? 'required' : 'disabled',
    students_loaded: STUDENTS.length,
    warnings,
    time: new Date().toISOString(),
  });
});

// Tells the parent to go back to WhatsApp and reply "paid". Paystack adds ?trxref= as well.
pages.get(
  '/payment-complete',
  asyncHandler(async (req, res) => {
    const reference = String(req.query.reference ?? req.query.trxref ?? '');

    let heading = 'Thank you';
    let detail = 'Go back to WhatsApp and reply <b>paid</b> so we can confirm your payment.';
    let cls = '';
    let amountLine = '';

    if (reference) {
      try {
        const txn = await getProvider().verify(reference);
        if (txn) {
          const student = findStudent(txn.studentId ?? '');
          amountLine = `<div class="amt">${naira(Math.round(txn.amountKobo / 100))}</div>`;
          if (txn.status === 'success') {
            heading = 'Payment received';
            cls = 'ok';
            detail = `For ${esc(student?.name.split(' ')[0] ?? 'your child')}. Go back to WhatsApp and reply <b>paid</b> to get your updated balance.`;
          } else if (txn.status === 'failed') {
            heading = 'Payment did not go through';
            cls = 'bad';
            detail = 'No money was taken. Go back to WhatsApp and ask for a new payment link to try again.';
          } else {
            heading = 'Payment not finished';
            detail = 'This payment has not completed yet. Go back to WhatsApp if you need a new link.';
          }
        }
      } catch {
        // Paystack unreachable: fall back to the generic message.
      }
    }

    res.type('html').send(
      page(
        'Brightfield Academy fees',
        `<p>Brightfield Academy · School fees</p><h1 class="${cls}">${heading}</h1>${amountLine}<p>${detail}</p>` +
          (reference ? `<small>Reference: ${esc(reference)}</small>` : ''),
      ),
    );
  }),
);

// ?reference=...               -> checkout page
// ?reference=...&action=pay     -> marks it paid, redirects to the return page
// ?reference=...&action=decline -> marks it failed
pages.get(
  '/mock-checkout',
  asyncHandler(async (req, res) => {
    let mode: string;
    try {
      mode = getProvider().mode;
    } catch {
      mode = 'error';
    }
    if (mode !== 'mock') {
      res.status(404).type('html').send(page('Not available', '<h1>Not available</h1><p>The mock checkout only runs when no Paystack key is set.</p>'));
      return;
    }

    const reference = String(req.query.reference ?? '');
    const action = req.query.action;
    const txn = await getProvider().verify(reference);
    if (!txn) {
      res
        .status(404)
        .type('html')
        .send(page('Unknown payment', '<h1>Unknown payment</h1><p>This link is not valid (the mock store resets when the server restarts).</p>'));
      return;
    }

    if (action === 'pay' || action === 'decline') {
      mockSettle(reference, action === 'pay' ? 'success' : 'failed');
      res.redirect(302, `/api/payment-complete?reference=${encodeURIComponent(reference)}`);
      return;
    }

    const student = findStudent(txn.studentId ?? '');
    const q = (a: string) => `?reference=${encodeURIComponent(reference)}&action=${a}`;
    res.type('html').send(
      page(
        'Mock checkout',
        `<p>MOCK CHECKOUT · stands in for Paystack</p><h1>Brightfield Academy</h1>
         <p>School fees for ${esc(student?.name ?? 'student')}</p>
         <div class="amt">${naira(Math.round(txn.amountKobo / 100))}</div>
         <div class="btns"><a class="btn primary" href="${q('pay')}">Pay (approve)</a><a class="btn" href="${q('decline')}">Decline card</a></div>
         <small>Closing this page without choosing leaves the payment "abandoned", like a real Paystack checkout.</small>`,
      ),
    );
  }),
);
