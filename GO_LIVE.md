# Go-live note for Brightfield Academy

**What it does.** Parents message the school's WhatsApp number with their child's student ID. The assistant tells them the balance, sends a Paystack link for the full amount or an installment of at least ₦100,000, confirms the payment once Paystack has it, and sends a receipt. Anything else (disputes, refunds, discounts, upset parents) goes to the bursar with a case ID.

**What it doesn't do.** It never agrees to discounts, lower installments or deadline changes. It can't message parents first, so no payment reminders. It handles one child per conversation.

**Before real parents use it:**
1. **Only a child's own parent should see their fees.** Right now anyone who knows a student ID can see that child's balance. The fix is built on our side; it needs Chord to tell us which WhatsApp number is messaging. This is the one blocker.
2. **Real records.** Fees, bursary payments and parents' phone numbers come from the school's records, not the demo list, and someone owns keeping them up to date.
3. **Live payments.** The school's own Paystack account (verified, with a settlement bank) and a decision on who pays Paystack's fees.
4. **A WhatsApp Business number** connected to Chord.

**When something goes wrong.** A failed or declined payment is never confirmed: the parent is told no money was taken and offered a new link. If Paystack is down, the assistant says so and passes the case to the bursar. Every handover is logged and can be posted to Slack; before launch the school picks one place the bursar checks, because parents are told to expect a reply within school hours (Mon–Fri, 8am–4pm). Error alerts to a named technical contact are not set up yet and are needed before launch.

**Rollout.** One class for half a term, with the bursar reading every handover. Widen it once a full pilot has had no wrong confirmations.

Technical detail: [docs/go-live-details.md](docs/go-live-details.md).
