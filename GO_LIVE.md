# Go-live note

*Brightfield Academy fees assistant on WhatsApp. For the school owner.*

## What it does

Parents message the school's WhatsApp number with their child's student ID. The assistant tells them the balance, sends a Paystack link for the full amount or an installment of at least ₦100,000, confirms the payment once Paystack has it, and sends a receipt. Anything else (disputes, refunds, discounts, upset parents) goes to the bursar with a case ID.

## What it does not do

It never agrees to discounts, lower installments or deadline changes. It cannot message parents first, so there are no payment reminders. It deals with one child at a time: a parent with two children gives each child's ID in turn.

## Before real parents use it

1. **Only a child's own parent should see their fees.** Today anyone who knows a student ID can see that child's balance. The fix is built on our side, but it needs Chord to tell us which WhatsApp number is messaging. This is the one blocker.
1. **Real records.** Fees, bursary payments and parents' phone numbers come from the school's records, not the demo list, and someone is responsible for keeping them up to date.
1. **Live payments.** The school's own Paystack account (verified, with a settlement bank) and a decision on who pays Paystack's fees.
1. **A WhatsApp Business number** connected to Chord.

## When something goes wrong

A failed or declined payment is never confirmed: the parent is told no money was taken and is offered a new link. If Paystack is down, the assistant says the payment system is temporarily unavailable, asks the parent to try again shortly, and never guesses whether a payment went through. A parent who has already paid is offered a handover to the bursar. Every handover is logged and can be posted to Slack. Before launch, the school picks one place the bursar checks, because parents are told to expect a reply within school hours (Mon–Fri, 8am–4pm). Error alerts to a named technical contact are not set up yet and are needed before launch.

## Rollout

One class for half a term, with the bursar reading every handover. Widen it once a full pilot has had no wrong confirmations.

Technical detail: [docs/go-live-details.md](docs/go-live-details.md).
