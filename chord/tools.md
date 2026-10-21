# Chord custom tools: what to enter

Three tools, all calling the deployed API at https://brightfield-fees-agent.vercel.app. Replace `YOUR_TOOL_API_KEY` with the `TOOL_API_KEY` set in Vercel (kept out of this repo on purpose).

I haven't seen Chord's tool form, so the field names below are generic. Map them onto whatever Chord asks for. Anything in Chord that doesn't map cleanly is a field note.

Every tool sends the header:

```
x-api-key: YOUR_TOOL_API_KEY
```

If Chord can't send custom headers, try `Authorization: Bearer YOUR_TOOL_API_KEY`. If neither works, set `ALLOW_KEY_IN_QUERY=true` in Vercel and add `?key=YOUR_TOOL_API_KEY` to each URL. That's a weaker setup and worth a field note.

The descriptions are written for the AI, not for humans. Paste them as they are: they're how the agent decides when to call each tool.

---

## 1. get_fee_balance

- **Method / URL:** `GET https://brightfield-fees-agent.vercel.app/api/balance`
- **Description:**
  > Look up a Brightfield Academy student's school-fee account for the current term: total fees, amount paid, remaining balance, minimum installment, due date and fee breakdown. Call this whenever a parent asks what they owe or what they've paid, and before creating a payment link. Requires the student ID (format BFA-0142).
- **Parameters:**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| student_id | string | yes | The child's student ID, e.g. BFA-0142 |
| parent_phone | string | no** | The parent's WhatsApp number (the sender of this chat), e.g. +2348035550142 |

- **Sends as:** query string (`?student_id=BFA-0142`). POST with a JSON body also works.

---

## 2. create_payment_link

- **Method / URL:** `POST https://brightfield-fees-agent.vercel.app/api/payment-link`
- **Description:**
  > Create a secure Paystack payment link for a Brightfield Academy student's school fees. Use it after the parent says how much they want to pay. The amount must be at least the minimum installment (₦100,000) unless it equals the full remaining balance, and it can't exceed the balance. Returns payment_url (send it to the parent exactly as given) and reference (keep it for verify_payment).
- **Parameters (JSON body):**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| student_id | string | yes | The child's student ID, e.g. BFA-0142 |
| amount | number | yes | Amount in naira (not kobo), e.g. 150000 |
| parent_phone | string | no** | The parent's WhatsApp number (the sender of this chat), e.g. +2348035550142 |

---

## 3. verify_payment

- **Method / URL:** `POST https://brightfield-fees-agent.vercel.app/api/verify`
- **Description:**
  > Check with Paystack whether a school-fee payment really went through, and get the student's new balance. Call this when the parent says they have paid. Pass the reference from create_payment_link; if you don't have it, pass student_id to check that student's most recent payment. payment_status is one of success, failed, not_completed, reversed. Only confirm a payment to the parent when it is success. On success it also returns receipt_url (the parent's receipt page, with a Download button): send it to the parent exactly as given. receipt_image_url is the PNG itself, for sending as an image.
- **Parameters (JSON body):**

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| reference | string | no* | The reference returned by create_payment_link |
| student_id | string | no* | Use when the reference is not available |
| parent_phone | string | no** | The parent's WhatsApp number (the sender of this chat), e.g. +2348035550142 |

\* Send at least one of the two.

---

## parent_phone: who may see a child's fees

\*\* Student IDs are sequential, so knowing an ID must not be enough to see a child's fees. Each student record has the parent's WhatsApp number on file. If Chord can put the **sender's WhatsApp number** into tool calls (a variable such as `{{contact.phone}}` in a query parameter or body field), map it to `parent_phone` on all three tools. The API then only answers for that parent's own children (`PARENT_NOT_VERIFIED` otherwise).

Once that works, set `REQUIRE_PARENT_PHONE=true` in Vercel so calls without a number are refused too. Add your own test number with `DEMO_PARENT_PHONES=+234...` so you can test with every student.

If Chord can't pass the sender's number, leave `REQUIRE_PARENT_PHONE` off. It's a known gap: see the README.

---

## Response format (all three tools)

Success:

```json
{ "ok": true, "...": "tool-specific fields", "agent_hint": "what to tell the parent next" }
```

Error:

```json
{ "ok": false, "error": { "code": "AMOUNT_TOO_LOW", "message": "...", "agent_hint": "..." } }
```

Errors use proper HTTP status codes (400, 404, 409, 422, 502). If Chord treats any non-200 as "tool failed" and the agent can't see the error message, set `ERRORS_AS_200=true` in Vercel. That's also a field note.

If Chord can import an OpenAPI spec, use `chord/openapi.yaml` instead of typing these in by hand.
