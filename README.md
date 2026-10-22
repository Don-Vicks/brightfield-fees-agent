# Brightfield Academy fees agent

A WhatsApp agent, built on Chord, that lets parents at a (made-up) Lagos private school check their child's fee balance, pay all or part of it through Paystack, and get instant confirmation. No bursar is needed for routine fee questions.

| | |
| --- | --- |
| **Live API** | https://brightfield-fees-agent.vercel.app/api/health |
| **Demo recording** | _link to be added_ |
| **Test plan** | [TESTING.md](TESTING.md) |
| **Go-live note** | [GO_LIVE.md](GO_LIVE.md) |
| **Field notes** | [FIELD_NOTES.md](FIELD_NOTES.md) |

This repo holds the agent's **skill** and the **tool API** it calls. The agent itself lives on Chord.

```
                       ┌──────────────────────────── Chord ───┐
Parent ── WhatsApp ──► │ teammate: skill (rules, tone)        │
                       │   └─ calls 5 tools (x-api-key) ──────┼──► this API (Express on Vercel)
                       └──────────────────────────────────────┘      │
                                                                     ├─► Paystack (test mode): links, verify, ledger
                                                                     ├─► school records (src/lib/data.ts)
                                                                     └─► bursar (handover log / webhook)
Parent's browser ──► Paystack checkout ──► /api/payment-complete      receipts: /api/receipt/:ref
```

## The five tools

| Tool | Endpoint | What it does |
| --- | --- | --- |
| `get_fee_balance` | `GET /api/balance?student_id=` | Total fees, paid, balance, minimum installment, breakdown |
| `create_payment_link` | `POST /api/payment-link` `{student_id, amount}` | Checks installment rules, creates a Paystack checkout link |
| `verify_payment` | `POST /api/verify` `{reference}` or `{student_id}` | Asks Paystack if the payment went through, returns the new balance and, on success, a receipt (page with Download button + PNG) |
| `get_payment_history` | `GET /api/payments?student_id=` | Bursary total plus every online payment with its receipt link (for "what have I paid?" and lost receipts) |
| `hand_over_to_bursar` | `POST /api/handover` `{summary, reason, ...}` | Records a case for the bursar and notifies them (log, or a webhook such as Slack) |

All five accept `parent_phone`, so the API only answers for a parent's own children (see Design decisions).

Every response includes `agent_hint`: one line telling the agent what the result means and what to say next. Errors share one shape, `{ ok:false, error:{ code, message, agent_hint } }`.

## Run it locally (2 minutes, no keys needed)

```bash
npm install
npm run dev        # http://localhost:3000/api/health
npm run smoke      # in a second terminal: runs 44 checks end to end
```

With no Paystack key it runs in **mock mode**. Payment links open a fake checkout page where you click Pay or Decline. Copy `.env.example` to `.env` to configure it.

## Deploy (Vercel)

1. Push this repo to GitHub and import it at vercel.com/new. No build settings needed: Vercel detects the Express app in `src/app.ts` (its default export).
2. In Project → Settings → Environment Variables, add:
   - `PAYSTACK_SECRET_KEY`: your **test** secret key (`sk_test_…`). Live keys are refused on purpose.
   - `TOOL_API_KEY`: any long random string (`openssl rand -hex 24`). Chord sends this with every call.
3. Redeploy, then open `https://YOUR-APP.vercel.app/api/health`. Expect `"payments_mode": "paystack-test"` and no warnings.
4. Test against Paystack:
   ```bash
   BASE_URL=https://YOUR-APP.vercel.app TOOL_API_KEY=... npm run smoke
   ```
   The script pauses at each payment link so you can pay with a [Paystack test card](https://paystack.com/docs/payments/test-payments).

## Connect to Chord

- **Skill:** paste `chord/skill-brightfield-fees.md` into a new skill on the agent.
- **Tools:** add the five tools as described in `chord/tools.md`, or import `chord/openapi.yaml` if Chord supports it.
- Test in the WhatsApp simulator with student ID **BFA-0142** (balance ₦250,000).

Test students: `BFA-0142` (₦250k owing), `BFA-0217` (₦520k owing, nothing paid), `BFA-0088` (fully paid), `BFA-0305` (₦60k left, below the minimum installment, so it must be paid in full), `BFA-0151` (₦280k owing).

## Design decisions

- **Paystack is the ledger.** Balance = fees − offline payments − successful Paystack payments tagged with the student's ID, recomputed on every call. There's no database to keep in sync, a payment verified twice can't be counted twice, and a parent who pays but never says "paid" still gets credit next time.
- **Pull, not push.** The agent verifies when the parent says "paid". A Paystack webhook can tell our server about a payment, but it can't start a WhatsApp message through Chord, so the conversation has to ask.
- **A failed payment is a result, not an error.** `verify_payment` returns `ok:true` with `payment_status: failed | not_completed`. Real errors (unknown student, Paystack down) return `ok:false`.
- **Only a child's own parent sees their fees.** Student IDs are sequential, so an ID alone isn't proof. Each record has the parent's WhatsApp number, and when a tool call includes `parent_phone` the API answers only for that parent's children. `REQUIRE_PARENT_PHONE=true` makes it mandatory. It's off until Chord is confirmed to pass the sender's number (see `chord/tools.md`).
- **Forgiving input.** The API accepts `bfa 142`, `₦150k` and `studentId`, because LLMs and parents don't type consistently.
- **The tool enforces business rules, not just the prompt.** Minimum installment and no overpayment are checked server-side, so a confused agent can't create a bad link.

## Limits (deliberate, for a demo)

- Student records are hard-coded in `src/lib/data.ts`. A real school would connect its records system.
- Balance lookup pages through this term's Paystack transactions (up to 500). That's fine for a demo; at school scale you'd store payments via webhook.
- Mock mode keeps payments in memory. Use it locally only, not on Vercel.
- **Until Chord passes the sender's WhatsApp number to tools, anyone who knows a student ID can see that child's fees.** The API side of the fix is built (`src/lib/access.ts`); this is a blocker before going live.
- No refunds, multiple children per chat, or fee negotiation. Those go to the bursar.

## Configuration

See `.env.example`. Notable switches:

- `ERRORS_AS_200=true`: return errors as HTTP 200 if a tool platform hides non-2xx bodies from the agent.
- `ALLOW_KEY_IN_QUERY=true`: accept `?key=` when the platform can't send headers.
- `REQUIRE_PARENT_PHONE=true`: refuse tool calls without the sender's number. `DEMO_PARENT_PHONES` adds tester numbers that count as every student's parent.
- `BURSAR_WEBHOOK_URL`: where handovers are posted (a Slack incoming webhook works as-is).
- `LOG_TOOL_REQUESTS=false`: stop logging the shape of tool calls (field names and masked phone numbers).
- `TERM_START`: only Paystack payments from this date/time count. Set it to the current time to reset all test balances.

## Project layout

```
src/app.ts      Express app (also the Vercel entry): JSON parsing, logging, routers, error handler
src/server.ts   local server (npm run dev)
src/routes/     tools.ts (3 agent tools, API key required), pages.ts (health + browser pages)
src/middleware/ API key auth, error formatting, async wrapper
src/assets/     fonts for the receipt image
src/lib/        data, receipt image, Paystack client + mock, fee logic, HTTP helpers
chord/          skill file, tool definitions, OpenAPI spec
scripts/        end-to-end smoke test
FIELD_NOTES.md  problems hit while building and deploying
```

## How I used AI tools

<!-- Write this yourself, honestly. Example:
I used Claude to scaffold the tool API, the smoke test and a first draft of the skill.
I reviewed every file, deployed and tested it against Paystack test mode myself,
rewrote X, and set up the agent in Chord by hand. Field notes are from my own build. -->
