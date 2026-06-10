---
title: "feat: dedicated, independently-revocable CRM API key (append-only)"
status: completed
date: 2026-06-10
type: feat
---

# feat: dedicated, independently-revocable CRM API key (append-only)

## Summary

The GEA CRM currently authenticates to everypropertyAI with a **shared** `epai_` key. Give it its own dedicated `epai_crm_…` key, appended to the server's `EVERYPROPERTY_API_KEYS` allowlist, so it can be **rotated or revoked independently** of the other consumers (CMA, recruitAI, vendor-report) without breaking them.

**Validation of the provisioning approach (confirmed against the code):** the auth model already supports this with **no code change**:
- `src/middleware.ts` gates the data routes (incl. `/api/address-suggest`) by reading **`EVERYPROPERTY_API_KEYS`** only — comma-split, trimmed, `keys.includes(provided)` (any one matching value authorises).
- The in-route self-auth routes (`src/app/api/search/route.ts`, `proposal/route.ts`, `agents/listings/route.ts`) accept **`EVERYPROPERTY_API_KEYS ∪ EVERYPROPERTY_API_TOKEN`**.

So appending one `epai_crm_…` value to **`EVERYPROPERTY_API_KEYS`** authorises the CRM on **every** endpoint its enrich flow touches (middleware-gated *and* in-route), and append-only changes never break the existing keys. This makes the task **operational + documentation**, not code.

---

## Problem Frame

A single shared key for all consumers means you cannot revoke or rotate one consumer's access without disrupting the others, and you cannot attribute traffic to a consumer. The fix is the standard per-consumer-key pattern, already partially in use here (`epai_cma_…` for GEA_ST_CMA, `epai_wcv_…` for the vendor report). The CRM is the one consumer still on the shared key — this plan provisions its dedicated key and records the convention so future consumers follow it.

**Scope note:** the everypropertyAI server (this repo + its Railway service) owns the allowlist. The CRM app (separate repo) consumes the resulting key via its `EVERYPROPERTY_API_TOKEN`. The allowlist edit + docs land here; setting the CRM's env var lands in the CRM repo (out of scope, noted).

---

## Requirements

- **R1** — A new, cryptographically-random `epai_crm_…` key exists and is a member of the server's `EVERYPROPERTY_API_KEYS` allowlist (local `.env.local` + the deployed Railway service).
- **R2** — The change is **append-only**: every pre-existing key in `EVERYPROPERTY_API_KEYS` remains, so no currently-working consumer breaks.
- **R3** — The new key authorises the CRM on the middleware-gated routes (e.g. `/api/address-suggest`) **and** the in-route self-auth routes; no/invalid keys are still rejected.
- **R4** — The dedicated key is independently **revocable/rotatable**: removing or replacing just that value disables/rotates only the CRM, leaving other consumers unaffected — and the procedure is documented.
- **R5** — No real key value is committed to the repo; committed files use placeholders only.
- **R6** — No code change to the auth model (it already supports a multi-key allowlist with any-match).

---

## Key Technical Decisions

- **Append to `EVERYPROPERTY_API_KEYS`, not `EVERYPROPERTY_API_TOKEN` (R3).** Only `EVERYPROPERTY_API_KEYS` is read by the middleware (`EVERYPROPERTY_API_TOKEN` is honoured solely by the three in-route routes). Putting the CRM key in `EVERYPROPERTY_API_KEYS` is the **single** location that covers all endpoints; `EVERYPROPERTY_API_TOKEN` would silently fail on `/api/address-suggest`.
- **Identifiable prefix `epai_crm_` + 32 hex of CSPRNG entropy.** Matches the existing per-consumer convention (`epai_cma_`, `epai_wcv_`); the prefix makes the key self-identifying in env/logs without revealing the secret body.
- **Append-only allowlist edits (R2, R4).** Adding a key never disturbs existing consumers; revocation = remove that one value; rotation = append the replacement, switch the CRM, then remove the old. This is the property that delivers "independent" revoke/rotate.
- **No code change (R6).** The allowlist parsing already does comma-split + trim + any-match in both the middleware and the in-route helpers. The only repo artifacts are documentation (the convention + runbook) and the `.env.local.example` annotation.

---

## Implementation Units

### U1. Document the per-consumer key model + provisioning/rotation runbook

**Goal:** Record the per-consumer-key convention, the append-only invariant, and the provision/rotate/revoke runbook so this and future keys are managed consistently.

**Requirements:** R4, R5, R6

**Dependencies:** none

**Files:**
- `INTEGRATIONS.md` (modify) — add an "API keys (per-consumer, append-only)" subsection near the consumer-config / env-var blocks: the convention (`epai_<consumer>_<random>`), that `EVERYPROPERTY_API_KEYS` is the comma-separated allowlist read by the middleware (and `∪ EVERYPROPERTY_API_TOKEN` by the three in-route routes), the append-only rule, and the provision / rotate / revoke steps. Cross-link the existing "Troubleshooting: enrich gets 401" section.
- `.env.local.example` (modify) — annotate `EVERYPROPERTY_API_KEYS=` to show the comma-separated multi-key format with placeholder per-consumer keys (e.g. `epai_cma_…,epai_wcv_…,epai_crm_…`), never real values.

**Approach:** Documentation only. State the invariant explicitly: a consumer's `EVERYPROPERTY_API_TOKEN` must equal one value in the server's `EVERYPROPERTY_API_KEYS`. Give the three procedures: **provision** (generate `epai_<consumer>_<32hex>`, append to `EVERYPROPERTY_API_KEYS` local + Railway, set as the consumer's token), **rotate** (append new, switch consumer, remove old), **revoke** (remove that one value, redeploy). Use placeholders throughout (R5).

**Test scenarios:** `Test expectation: none — documentation; correctness is verified by U2's live curl checks and by the placeholders-only review.`

**Verification:** `INTEGRATIONS.md` describes the per-consumer convention + append-only rule + the three procedures unambiguously; `.env.local.example` shows the multi-key format with no real secrets.

---

### U2. Provision and verify the dedicated CRM key

**Goal:** Generate the `epai_crm_…` key, append it to the allowlist (local + deployed), and verify the gate accepts it while still rejecting no/invalid keys.

**Requirements:** R1, R2, R3

**Dependencies:** U1 (follows the documented convention/runbook)

**Files:**
- `.env.local` (modify, local only — gitignored) — append the new key to `EVERYPROPERTY_API_KEYS` (comma-separated), preserving existing values.
- (operational, outside the repo) the `geaeverypropertyai-production` Railway service `EVERYPROPERTY_API_KEYS` variable — append the same value and redeploy.

**Approach:** Operational. Generate `epai_crm_` + 32 hex chars from a CSPRNG. Append to `EVERYPROPERTY_API_KEYS` in `.env.local` and in the Railway service variables (append-only — keep all existing keys, R2), then redeploy the service. Hand the value to the CRM operator to set as `EVERYPROPERTY_API_TOKEN` (that env edit happens in the CRM repo/host — out of scope here). Never write the real value into a committed file (R5).

**Execution note:** This unit performs an operational secret change; the agent can generate the key, edit local `.env.local`, and run the verification curls when given the value, but **setting the Railway variable + redeploy is an operator action** (requires deploy credentials). Treat the Railway step as a hand-off, not an agent edit.

**Test scenarios (live verification, not unit tests):**
- Gate rejects anonymous: `GET /api/address-suggest?q=…` with no `Authorization` → **401**.
- Gate accepts the new key: same request with `Authorization: Bearer <epai_crm key>` → **200**.
- Regression — existing key still works: a request with a pre-existing consumer key → **200** (append-only didn't drop it).
- Cross-endpoint: the new key also returns **200** on an in-route route the CRM may call (e.g. `/api/search?q=…`), confirming it works beyond the middleware-gated path.
- Invalid key still rejected: a bogus `Bearer not-a-key` → **401**.

**Verification:** Against `https://geaeverypropertyai-production.up.railway.app`, the new `epai_crm_…` key yields 200 on `/api/address-suggest` and `/api/search`, anonymous/invalid still yield 401, and at least one existing consumer key still yields 200. The CRM, once set to use the key, enriches "120 Moondarra Drive" successfully.

---

## Scope Boundaries

**In scope:** documenting the per-consumer-key convention + append-only invariant + provision/rotate/revoke runbook; annotating `.env.local.example`; generating the CRM key and appending it to the allowlist (local + Railway); live verification.

**Out of scope (true non-goals):**
- Code changes to the auth model — none needed; the allowlist already supports multi-key any-match.
- Setting `EVERYPROPERTY_API_TOKEN` in the CRM app — that lives in the CRM repo/host.
- Migrating the **other** consumers (CMA, recruitAI) off any shared key, or rotating the existing shared key — not requested; append-only adds the CRM key without touching them.

### Deferred to Follow-Up Work
- **Per-consumer key attribution/metrics** (which key made which call) — would need request logging keyed by the matched allowlist entry; useful for revocation decisions, but a separate observability change.
- **Move keys to a secrets manager** (vs comma-separated env) if the consumer count grows — deferred unless the env list becomes unwieldy.

---

## Risks & Dependencies

- **Accidentally overwriting the allowlist (breaks all consumers).** Mitigated by the explicit append-only invariant (R2) and the regression verification that a pre-existing key still returns 200 after the change.
- **Wrong env var (`EVERYPROPERTY_API_TOKEN` instead of `EVERYPROPERTY_API_KEYS`) on the server.** Mitigated by the KTD: the middleware reads only `EVERYPROPERTY_API_KEYS`, so the key must go there — verified by the `/api/address-suggest` 200 check (a key only in `EVERYPROPERTY_API_TOKEN` would still 401 there).
- **Secret leakage.** Mitigated by R5 (placeholders only in committed files) and treating `.env.local`/Railway as the only homes for the real value; never paste it into logs/PRs.
- **Auth-disabled deployment.** If `EVERYPROPERTY_API_KEYS` is unset, the middleware allows all requests (warn-and-pass). The append assumes the prod allowlist is set (it is — `EVERYPROPERTY_API_KEYS` ✅ per INTEGRATIONS.md). Confirm it's non-empty before relying on the gate.

---

## Sources & Research

Codebase grounding (no external research — internal auth, fully traced locally):
- `src/middleware.ts` — `apiKeyGate` reads **only** `EVERYPROPERTY_API_KEYS` (comma-split, trim, `includes`); same-origin exemption; unset ⇒ allow-and-warn.
- `src/app/api/search/route.ts`, `proposal/route.ts`, `agents/listings/route.ts` — in-route auth reads `EVERYPROPERTY_API_KEYS ∪ EVERYPROPERTY_API_TOKEN`.
- `.env.local.example` (`EVERYPROPERTY_API_KEYS=` / commented `EVERYPROPERTY_API_TOKEN=`), `INTEGRATIONS.md` consumer-config + the existing "enrich 401" troubleshooting section (plan 006).
- Existing per-consumer keys in use: `epai_cma_…` (GEA_ST_CMA), `epai_wcv_…` (vendor report) — the convention this CRM key follows.
