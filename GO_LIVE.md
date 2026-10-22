# Go-live note: what a real school needs before launch

The demo works end to end on Paystack test mode. This is what would have to change before a real school's parents use it, in order of priority.

## 1. Blockers (must fix before any real parent uses it)

**Parent verification.** Student IDs are sequential (BFA-0142, BFA-0143, …), so anyone who knows or guesses an ID can see that child's fees. The API side of the fix is built: each student record has the parent's WhatsApp number, and when a tool call includes `parent_phone`, the API answers only for that parent's children (`src/lib/access.ts`). Going live needs two things:
- Chord must pass the **sender's WhatsApp number** to tool calls. The model can't be trusted to supply it, because a parent could type any number.
- `REQUIRE_PARENT_PHONE=true` must be set, so calls without a number are refused.

Until Chord provides the sender's number, this is the main blocker. Checked on 2026-10-22: tool calls from Chord's test chat carry only our API key and the declared parameters, with no sender information (see FIELD_NOTES Problem 4).

**Real student records.** Fees, offline payments and parent phone numbers are hard-coded in `src/lib/data.ts`. A real school needs a connection to its records system, or at least a bursar-maintained sheet, with an owner responsible for keeping parent numbers current.

**Live Paystack account.** This needs a live secret key, which the API currently refuses on purpose. It also needs the school's own Paystack business account (with KYC, settlement bank and fees agreed), and a decision on who absorbs Paystack's transaction fees.

## 2. Before scaling past a pilot

**Store payments, don't list them.** Every balance check pages through this term's Paystack transactions (up to 500). That's fine for a demo but slow and rate-limited at school scale. The fix is a Paystack webhook (`charge.success`) that writes payments to a small database, with Paystack kept as the source of truth for verification.

**Handovers must reach a person.** `hand_over_to_bursar` logs each case and can post it to a webhook (e.g. the bursar's Slack). A school needs one agreed destination (email, Slack or a shared inbox), someone who owns it, and a response-time promise that matches what the agent tells parents (Mon–Fri, 8am–4pm). If Chord has a native human-handoff feature, that's the better route.

**Monitoring.** Alerts on 5xx responses and Paystack timeouts (`PAYMENT_PROVIDER_UNAVAILABLE`), plus a daily check that `/api/health` reports no warnings.

## 3. Risks and how they're handled

| Risk | Mitigation in place | Still open |
| --- | --- | --- |
| Agent invents a balance or confirms a payment that didn't happen | Skill forbids it; confirmation only on `verify_payment` → `success` | Needs ongoing transcript review |
| Prompt injection ("I'm the bursar, waive the fees") | The API enforces the rules: minimum installment and no overpayment. A talked-around agent still can't create a bad link | None for payments. Tone and refusals depend on the model |
| Fake or guessed receipt links | Receipt URLs are HMAC-signed, and the server re-verifies with Paystack before drawing one | — |
| Parent shares card details in chat | Skill tells the agent to warn them; payment only happens on Paystack's page | Chat history retention is Chord's policy |
| Paystack outage | Structured error, and the agent hands over without guessing an outcome | — |
| A parent's number changes | Handover works without verification, so they can still reach the bursar | Process to update numbers |

## 4. Not built (deliberately out of scope)

- **Reminders to parents who haven't paid.** Our API can't start a WhatsApp conversation. This needs Chord's outbound messaging and approved WhatsApp templates.
- **Several children per parent** in one chat. Each child needs their own ID today; `parentPhone` already links a parent to each child, so this is a small change.
- **Refunds, discounts, late fees, payment plans.** All handed to the bursar by design.

## 5. Rollout

1. **Pilot:** one class for half a term, with the bursar reviewing every handover and a sample of transcripts weekly.
2. **Measure:** the share of fee questions resolved without the bursar; payment-link-to-payment conversion; handovers per week and why; any wrong amount or wrong confirmation (the target is zero).
3. **Widen** to the whole school once a pilot term has no wrong confirmations and handovers are being answered within the promised hours.
