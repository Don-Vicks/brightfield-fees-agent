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

### What worked well

- **Import OpenAPI** created all three tools from `chord/openapi.yaml` in one step, with the right method and URL for each and the `x-api-key` header auth.
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
