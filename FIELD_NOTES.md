# Deployment field notes

The three problems that cost me the most time, most important first.

### Problem 1: Tool calls don't say who the sender is, so anyone with a student ID can see that child's fees

**What happened:** Student IDs are sequential (BFA-0142, BFA-0143, …), so the API needs to know *who* is asking before it shows a child's fees. I built a parent check (`parent_phone` must match the number on file) but needed Chord to pass the sender's WhatsApp number. To see what Chord actually sends, I logged the shape of every tool call. From the test chat on 2026-10-22, 08:01 UTC:

```
[tool-call] POST /verify  headers=[x-api-key,user-agent,content-type,accept,x-invocation-id] body=[student_id]  phone_like=[none]
[tool-call] GET /balance  headers=[x-api-key,content-type,user-agent,accept,x-invocation-id] query=[student_id] phone_like=[none]
```

Only our API key and standard HTTP headers, plus the parameters we defined. Nothing identifies the sender or the conversation. The test chat itself asks only for a name, not a phone number.

**How I found the cause:** Added request-shape logging to the API (`src/middleware/inspect.ts`: field names only, phone-like values masked), sent a message in the test chat, and read the Vercel logs.

**Fix / workaround:** The API side is built and off by default (`REQUIRE_PARENT_PHONE`). Without a sender number from Chord it can't be switched on, so it's the blocker in `GO_LIVE.md`. Asking the model to pass the number doesn't work as a fix: a parent could type any number.

**What Chord should change:** Let tools receive trusted conversation context that the model can't change. For example, a template variable like `{{contact.phone}}` usable in headers or parameters, or a signed header such as `X-Chord-Sender` on every tool call. `x-invocation-id` is already sent; a conversation ID alongside it would also help with support and audit logs.

*Not yet checked: the same test over a real WhatsApp channel, in case the sender's number is only available there.*

---

### Problem 2: OpenAPI import loses what the model and the test panel need

**What happened:** Import OpenAPI created the tools from `chord/openapi.yaml` with the right methods, URLs and `x-api-key` auth. But:
- The body schemas kept only the types (`{"reference":{"type":"string"},...}`). The parameter descriptions, which tell the AI what each field means (e.g. "amount in naira, not kobo"), were gone, and the timeout field was empty.
- Clicking Test on `create_payment_link` returned `400 MISSING_STUDENT_ID`: the test panel sent an empty body, even though the spec has the schema and examples.

**How I found the cause:** The test panel shows the response body for non-2xx statuses, so the structured error was visible: `{"ok":false,"error":{"code":"MISSING_STUDENT_ID",...}}`. Then I opened Edit API connection on `verify_payment` and compared its body schema with the spec.

**Fix / workaround:** Pasted body schemas with descriptions into each tool by hand, set the timeout to 20000 ms (Paystack plus a cold-starting serverless API can be slow), and typed test bodies by hand (`{"student_id":"BFA-0142","amount":150000}`).

**What Chord should change:** Keep `description`, `required` and `example` from the spec on import, show the default timeout instead of a blank field, and pre-fill the test panel from the schema so the first test after import works in one click.

---

### Problem 3: Setting up a teammate is spread across separate admin pages

**What happened:** After creating the teammate, there was no next step to give it tools or a skill. Tools live under Admin → Channels & Tools, the skill somewhere else, and nothing on the teammate page pointed to either.

**How I found the cause:** Clicked through the admin pages until I found Channels & Tools → Tools → Custom tools (API).

**Fix / workaround:** Set up the tools first, then went back to the teammate to add the skill.

**What Chord should change:** A short guided flow (name → skill → tools with Import OpenAPI → channel → test), or a checklist on the teammate page ("No tools connected yet → Add tools").

---

### What worked well

- **Import OpenAPI** created every tool in one step, with header auth.
- The agent called `verify_payment` and `get_fee_balance` in parallel (~430 ms each). When its memory disagreed with the tools after a balance reset, it trusted the tools and corrected itself.
- Structured errors (`code`, `message`, `agent_hint`) were readable in the test panel, so I didn't need the `ERRORS_AS_200` workaround.

---

## Timeline

| Time | What happened | Evidence | Outcome |
| --- | --- | --- | --- |
| 2026-10-21 | Deployed API to Vercel; `/api/health` OK, `payments_mode: paystack-test` | — | Done |
| 2026-10-21 | Teammate creation doesn't lead into tools/skill setup | — | Problem 3 |
| 2026-10-21 | Imported `chord/openapi.yaml`; 3 tools created | — | Done |
| 2026-10-21 | Test `create_payment_link` with empty body → 400 | `MISSING_STUDENT_ID` (screenshot) | Problem 2 |
| 2026-10-21 | Import lost parameter descriptions and timeout; fixed by hand | — | Problem 2 |
| 2026-10-21 | First full test chat (BFA-0142): balance, link, pay, verify all correct | screenshot | Done |
| 2026-10-22 08:01 UTC | Tool calls carry no sender info; parent check can't be enforced | `phone_like=[none]` (Vercel logs) | Problem 1, go-live blocker |
| 2026-10-22 08:01 UTC | Old chat after balance reset: agent trusted the tools over its memory | screenshot | Good behaviour; use fresh chats |
| 2026-10-22 08:38 UTC | `hand_over_to_bursar` worked (`HO-MVJAGPDK-0d8d`), but the agent handed over *instead of* sending a ₦280,000 link, and used `**bold**`, which WhatsApp shows raw | screenshot + `[handover]` log | Skill fixed and retested |
| 2026-10-22 11:19 UTC | Fresh simulator chat, BFA-0151: balance ₦280,000 and ₦50k refused in one reply → ₦100,000 link → paid with test card → "paid" confirmed, balance ₦180,000, signed receipt opens. Agent added an unrequested "shall I create the link?" step | chat transcript + `BFA0151-20261022111958-1b18` | Works end to end; skill now creates the link straight away |
