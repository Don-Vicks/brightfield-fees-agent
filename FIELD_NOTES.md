# Deployment field notes

Log problems the moment they happen: paste the exact error, take a screenshot, note the time. Keep the best 2–3 for the submission.

### Problem 1: Setting up a teammate is spread across separate admin pages

**What happened:** After creating the teammate (agent), there was no next step to give it tools or a skill. Tools live under Admin → Channels & Tools, the skill lives somewhere else, and nothing on the teammate page pointed to either. I had to look around to find where each piece goes.

**How I found the cause:** Clicked through the admin pages until I found Channels & Tools → Tools → Custom tools (API).

**Fix / workaround:** Set up the tools first on Channels & Tools, then went back to the teammate to add the skill.

**What Chord should change:** Make teammate creation a short guided flow: name → skill/instructions → tools (with Import OpenAPI right there) → channel → test. Or at least show a checklist on the teammate page ("No tools connected yet → Add tools") that links to each step.

---

### Problem 2: The tool test panel starts with an empty request body

**What happened:** After importing the OpenAPI spec, I clicked Test on `create_payment_link` and got `400 MISSING_STUDENT_ID`. The test panel had sent an empty body, even though the spec defines the body schema (`student_id`, `amount`) with examples.

**How I found the cause:** The response body was shown in the panel: `{"ok":false,"error":{"code":"MISSING_STUDENT_ID",...}}`. Typing `{"student_id":"BFA-0142","amount":150000}` into the Body box by hand made it pass.

**Fix / workaround:** Typed the JSON body (POST tools) and query parameters (GET tool) by hand for each test.

**What Chord should change:** Pre-fill the test panel from the OpenAPI schema: one input per parameter, with the spec's examples filled in. Then a first test after import works in one click.

---

### Problem 3: OpenAPI import drops parameter descriptions and leaves the timeout empty

**What happened:** The imported tools had body schemas with only the types (`{"reference":{"type":"string"},...}`). The parameter descriptions from the spec, which tell the AI what each field means (e.g. "amount in naira, not kobo"), were missing. The timeout field was empty too.

**How I found the cause:** Opened Edit API connection on `verify_payment` and compared the body schema with `chord/openapi.yaml`.

**Fix / workaround:** Pasted body schemas with descriptions into each tool by hand and set the timeout to 20000 ms (Paystack and a cold-starting serverless API can be slow).

**What Chord should change:** Keep `description`, `required` and `example` from the OpenAPI spec when importing, and show the default timeout in the field instead of leaving it blank.

---

### Problem 4: Tool calls don't say who the sender is, so anyone with a student ID can see that child's fees

**What happened:** Student IDs are sequential (BFA-0142, BFA-0143, …), so the API needs to know *who* is asking before it shows a child's fees. I built a parent check (`parent_phone` must match the number on file) but needed Chord to pass the sender's WhatsApp number. To see what Chord actually sends, I logged the shape of every tool call. From the test chat on 2026-10-22, 08:01 UTC:

```
[tool-call] POST /verify  headers=[x-api-key,user-agent,content-type,accept,x-invocation-id] body=[student_id]  phone_like=[none]
[tool-call] GET /balance  headers=[x-api-key,content-type,user-agent,accept,x-invocation-id] query=[student_id] phone_like=[none]
```

Only our API key and standard HTTP headers, plus the parameters we defined. Nothing identifies the sender or the conversation. The test chat itself asks only for a name, not a phone number.

**How I found the cause:** Added request-shape logging to the API (`src/middleware/inspect.ts`: field names only, phone-like values masked), sent a message in the test chat, and read the Vercel logs.

**Fix / workaround:** The API side is built and off by default (`REQUIRE_PARENT_PHONE`). Without a sender number from Chord it can't be switched on, so it's a blocker in `GO_LIVE.md`. Asking the model to pass the number doesn't work as a fix: a parent could type any number.

**What Chord should change:** Let tools receive trusted conversation context that the model can't change. For example, a template variable like `{{contact.phone}}` usable in headers or parameters, or a signed header such as `X-Chord-Sender` on every tool call.

*Still to check: the same test over a real WhatsApp channel, in case the sender's number is only available there.*

---

### What worked well

- **Import OpenAPI** created all three tools from `chord/openapi.yaml` in one step, with the right method and URL for each and the `x-api-key` header auth.
- The agent called `verify_payment` and `get_fee_balance` in parallel (~430 ms each) and, when its memory disagreed with the tools after a balance reset, it trusted the tools and corrected itself.
- The test panel shows the response body for non-2xx statuses, so the structured errors (`code`, `message`, `agent_hint`) are visible. I didn't need the `ERRORS_AS_200` workaround (still to confirm that the agent also sees error bodies in conversation).

---

## Raw log (messy is fine, clean up at the end)

| Time | What happened | Error text / screenshot | Status |
| --- | --- | --- | --- |
| 2026-10-21 | Deployed API to Vercel; `/api/health` OK, `payments_mode: paystack-test` | — | Done |
| 2026-10-21 | Teammate creation doesn't lead into tools/skill setup; had to hunt through Admin | — | Noted (Problem 1) |
| 2026-10-21 | Imported `chord/openapi.yaml` via Custom tools (API) → Import OpenAPI; 3 tools created | — | Done |
| 2026-10-21 | Test `create_payment_link` with empty body → 400 | `MISSING_STUDENT_ID` (screenshot) | Workaround (Problem 2) |
| 2026-10-21 | All three tools pass with hand-typed bodies/params | 200s | Done |
| 2026-10-21 | First full test chat (BFA-0142): balance, link, pay, verify all correct | screenshot | Done |
| 2026-10-21 | Reset balances with `TERM_START` timestamp; updated skill + verify_payment for receipts | — | Done |
| 2026-10-21 | Import lost parameter descriptions and timeout; fixed by hand | — | Workaround (Problem 3) |
| 2026-10-22 08:01 UTC | Test chat tool calls carry no sender info; parent check can't be enforced | `phone_like=[none]` (Vercel logs) | Blocker (Problem 4) |
| 2026-10-22 08:01 UTC | Old chat after balance reset: agent trusted the tools over its memory and apologised for the mismatch | screenshot | Good behaviour; use fresh chats |
