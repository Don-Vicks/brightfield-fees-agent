# Deployment field notes

Brightfield Academy fees agent on Chord. These are the three problems that cost me the most time, most important first. For each one: what happened, how I found the cause, how I worked around it, and what I would change in Chord.

## Problem 1: Tools are not told who is messaging

**In short:** Chord sends my tools only the parameters the model fills in. It never sends the sender's WhatsApp number, so my API cannot check that the person asking is the child's parent.

### What happened

Student IDs are sequential (BFA-0142, BFA-0143 and so on), so knowing or guessing an ID should not be enough to see a child's fees. I built a check for this: every student record holds the parent's phone number, and the API only answers when the caller's number matches. That only works if Chord passes the sender's number with each tool call, and it does not.

### How I found the cause

I added logging to the API that records which headers and fields arrive with each tool call (names only, with any phone-like value masked). Then I sent a message in the simulator and read the Vercel logs. This is what arrived on 22 October at 08:01 UTC:

```
POST /verify   headers=[x-api-key, user-agent, content-type, accept, x-invocation-id]
               body=[student_id]   phone_like=[none]
GET  /balance  headers=[x-api-key, content-type, user-agent, accept, x-invocation-id]
               query=[student_id]  phone_like=[none]
```

Only my API key, standard HTTP headers and the parameters I defined. Nothing identifies the sender or the conversation.

### Workaround

The phone check is built but switched off (`REQUIRE_PARENT_PHONE=false`). Asking the model to pass the number is not a fix, because a parent could type any number. Until Chord sends it, this is the blocker in my go-live note.

### What I would change in Chord

Give tools trusted context that the model cannot edit, for example a `{{contact.phone}}` variable for headers or parameters, or a signed `X-Chord-Sender` header on every call. A conversation ID next to the existing `x-invocation-id` would also help with support and audit logs.

*Not checked yet: whether a real WhatsApp channel passes the number when the simulator does not.*

## Problem 2: OpenAPI import drops the details the model needs

**In short:** Importing my OpenAPI spec created the tools, but lost the field descriptions and examples, and the test panel then sent empty requests.

### What happened

Import created every tool with the right method, URL and `x-api-key` auth, but two things were missing:

- The body schemas kept only the field types. The descriptions were gone, such as "amount in naira, not kobo", which tell the model how to fill each field. The timeout field was blank.
- Clicking Test on `create_payment_link` returned `400 MISSING_STUDENT_ID`. The test panel had sent an empty body, even though the spec has the schema and examples.

### How I found the cause

The test panel shows the response body for errors, so I could read my API's own error: `{"ok":false,"error":{"code":"MISSING_STUDENT_ID"}}`. Then I opened Edit API connection on `verify_payment` and compared its schema with my spec file.

### Workaround

I pasted the schemas with descriptions into each tool by hand, set the timeout to 20,000 ms (Paystack and a serverless cold start can be slow), and typed test bodies by hand, for example `{"student_id":"BFA-0142","amount":150000}`.

### What I would change in Chord

Keep `description`, `required` and `example` from the spec on import, show the default timeout instead of a blank field, and pre-fill the test panel from the schema so the first test after an import works in one click.

## Problem 3: Setting up a teammate means hunting through admin pages

**In short:** After I created the teammate, nothing pointed me to where its tools and skill are added.

### What happened

Tools live under Admin → Channels & Tools → Tools → Custom tools (API). The skill is set up somewhere else, and the teammate page links to neither.

### How I found the cause

I clicked through the admin pages until I found both.

### Workaround

I set up the tools first, then went back to the teammate to add the skill.

### What I would change in Chord

A short guided setup (name, then skill, then tools with Import OpenAPI, then channel, then test), or at least a checklist on the teammate page such as "No tools connected yet: Add tools".

## What worked well

- Import OpenAPI created every tool in one step, with header auth.
- The agent called `verify_payment` and `get_fee_balance` in parallel (about 430 ms each). When its memory disagreed with the tools after I reset the balances, it trusted the tools and corrected itself.
- My structured errors (code, message and a hint for the agent) were readable in the test panel, so I did not need a workaround for error bodies.

## Test log

- **21 Oct:** API deployed on Vercel with Paystack in test mode. First full chat with BFA-0142 was correct from balance to verified payment.
- **22 Oct, 08:01 UTC:** Found that tool calls carry no sender information (Problem 1).
- **22 Oct, 08:38 UTC:** The bursar handover worked (case HO-MVJAGPDK-0d8d), but the agent handed over instead of sending a ₦280,000 link, and used double asterisks for bold, which WhatsApp shows as raw symbols. I fixed the skill and retested.
- **22 Oct, 11:19 UTC:** Fresh chat with BFA-0151. Balance and the ₦50,000 refusal came in one reply, then a ₦100,000 link, paid with a Paystack test card. "paid" was confirmed with the new balance (₦180,000) and a signed receipt. The agent asked an unneeded "shall I create the link?", so I changed the skill to create the link straight away.
