---
title: "fix: CRM enrich gets 401 from /api/address-suggest — diagnose key + harden client"
status: completed
date: 2026-06-10
type: fix
---

# fix: CRM enrich gets 401 from /api/address-suggest — diagnose key + harden client

## Summary

The CRM "Enrich from everypropertyAI" action fails with:

```
everypropertyai property 120 Moondarra Drive failed:
Error: /api/address-suggest returned 401 {"error":"Unauthorized — missing or invalid API key"}
```

**Root cause (diagnosed):** `/api/address-suggest` is gated by the API-key middleware (`src/middleware.ts`), which requires `Authorization: Bearer <key>` where `<key> ∈ EVERYPROPERTY_API_KEYS` (server env). The `services/everypropertyai` client only attaches that header **when it has a token** (`client.ts` — `if (this.token) headers["Authorization"] = …`, token defaults to `$EVERYPROPERTY_API_TOKEN`). The CRM's enrich path (`resolveAddress → suggestAddresses → /api/address-suggest`) is therefore either sending **no token** (env unset in the CRM) or a **stale token** absent from the server allowlist. The actual remediation is a CRM-side config alignment.

**Why a plan and not just a config tweak:** the failure surfaced as an opaque downstream 401 rather than a clear "no API token configured" signal, so the operator can't tell *which* cause they hit. This plan (a) provides a deterministic **diagnosis** procedure to distinguish "no key" vs "wrong key", (b) aligns the config, and (c) **hardens the client** so this class of failure is self-explaining next time.

**Scope note:** the CRM app is a **separate repo** (not this one). The config change lands there; the code hardening and the runbook land here. File paths below are repo-relative to this repo unless stated otherwise.

---

## Problem Frame

Traced locally:
- `src/middleware.ts` — `apiKeyGate` returns 401 unless `sec-fetch-site` is `same-origin`/`none` (the website's own browser calls) OR a valid bearer/`x-api-key` is supplied. Server-to-server callers (the CRM) get no same-origin exemption, so they **must** send a valid key. `/api/address-suggest` is in the middleware `matcher`.
- `services/everypropertyai/src/client.ts` — `request()` sets `Authorization: Bearer ${this.token}` only when `this.token` is truthy; `token = opts.token ?? process.env.EVERYPROPERTY_API_TOKEN`. On `!res.ok` it throws `PropertyIQError(\`${url.pathname} returned ${res.status}\`, status, body)` — correct, but it does not say whether a token was even sent or how to fix it.
- Contrast: `/api/search`, `/api/proposal`, `/api/agents/listings` self-authenticate in-route and are **excluded** from the middleware matcher; `/api/address-suggest` is **not** — so a consumer can "work" against one endpoint and still 401 here if its token is missing/stale.

Two indistinguishable-from-the-error causes:
1. **No token** — CRM env has no `EVERYPROPERTY_API_TOKEN` → no `Authorization` header → 401.
2. **Wrong token** — CRM sends a key not in the server's `EVERYPROPERTY_API_KEYS` → 401.

---

## Requirements

- **R1** — Provide a deterministic way to tell whether the CRM is sending **no** key or a **rejected** key (the two causes produce the same surface error today).
- **R2** — Align the config so the CRM's outbound token is a value present in the server's `EVERYPROPERTY_API_KEYS`; `/api/address-suggest` returns 200 for the CRM enrich flow.
- **R3** — Harden `services/everypropertyai`: a request that fails auth (401) throws an **actionable** error stating whether a token was attached and the exact remediation (which env var, which allowlist), instead of the opaque `returned 401`.
- **R4** — Hardening must **not** break deployments that intentionally run with auth disabled (`EVERYPROPERTY_API_KEYS` unset → middleware allows tokenless calls). No hard failure on a missing token at construction time.
- **R5** — No change to the middleware auth contract or to the other endpoints' behavior.

---

## Key Technical Decisions

- **Diagnose before changing config (R1).** The same 401 has two causes; a one-shot `curl` matrix (no header / with the CRM's token / with a known-good server key) pinpoints which, so the fix is targeted rather than guessed. This is the "not sure which" path the user is on.
- **Enrich the 401 at the client boundary, not hard-fail on missing token (R3, R4).** Throwing at construction when `token` is absent would break auth-disabled deployments (a legitimate mode the middleware supports). Instead, intercept `401` specifically in `request()` and rethrow a `PropertyIQError` whose message reports `tokenAttached: true|false` and the remediation. Tokenless-but-allowed deployments never reach this branch (they get 200).
- **Keep the response body in the error (already done) and add the cause hint.** The body (`{"error":"Unauthorized …"}`) is already carried; the new message adds *why from the client's side* — whether it even sent credentials.
- **Config alignment lives in the CRM repo; the runbook lives here (scope).** This repo owns the API + client + docs; it cannot set the CRM's env. The runbook records the exact var name and the must-match-server-allowlist invariant so the CRM operator can act.

---

## Implementation Units

### U1. Harden the everypropertyai client's auth-failure error

**Goal:** Turn an opaque `/api/address-suggest returned 401` into an actionable error that states whether the client sent a token and how to fix it.

**Requirements:** R3, R4, R5

**Dependencies:** none

**Files:**
- `services/everypropertyai/src/client.ts` (modify) — in `request()`, branch on `res.status === 401`: throw a `PropertyIQError` whose message includes whether an `Authorization` header was attached (derive from `this.token`) and the remediation ("set `EVERYPROPERTY_API_TOKEN` to a key present in the server's `EVERYPROPERTY_API_KEYS`"). Preserve `status` and response `body`. Non-401 errors keep the current message.
- `services/everypropertyai/src/__tests__/client.test.ts` (new) — unit tests with a stubbed `fetch`.

**Approach:** Keep the existing `if (this.token)` header logic. Add a focused 401 branch in the `!res.ok` path: compose a message like `everypropertyai: <path> returned 401 (no API token was attached — set EVERYPROPERTY_API_TOKEN). The token must be one of the server's EVERYPROPERTY_API_KEYS.` vs `… (a token was attached but rejected — it is not in the server's EVERYPROPERTY_API_KEYS).` Carry `status` + `body` on the error as today. Do not add construction-time validation (R4).

**Execution note:** Start with a failing test asserting the no-token 401 message differs from the token-attached 401 message.

**Patterns to follow:** the existing `PropertyIQError` construction in `services/everypropertyai/src/client.ts` (`request()` error paths); the message style of the existing connection-failure error ("Is the PropertyIQ app running at …?").

**Test scenarios:**
- No-token 401: client constructed with no token, stubbed `fetch` → 401 → thrown error message states **no token was attached** and names `EVERYPROPERTY_API_TOKEN`; `status === 401`; body preserved.
- Token-attached 401: client with a token, stubbed 401 → message states **a token was attached but rejected** and references the server `EVERYPROPERTY_API_KEYS` allowlist.
- Header attachment: with a token, the stubbed `fetch` receives `Authorization: Bearer <token>`; without a token, no `Authorization` header is sent.
- Non-401 error unchanged: a stubbed 500 still throws the existing `returned 500` message (no regression).
- Success unaffected: a 200 returns parsed JSON (the 401 branch doesn't intercept healthy calls).

**Verification:** Triggering the CRM enrich against a server with auth enabled yields an error that names the missing/invalid token and the env var, not a bare `returned 401`. Auth-disabled deployments still succeed tokenless.

---

### U2. Diagnosis runbook + CRM config alignment

**Goal:** Give the operator a deterministic way to identify which 401 cause they hit and the exact config change to resolve it (R1, R2).

**Requirements:** R1, R2

**Dependencies:** U1 (the hardened error message is referenced by the runbook), though the diagnosis curls do not strictly depend on it.

**Files:**
- `INTEGRATIONS.md` (modify) — add a short "Enrich 401 troubleshooting" subsection near the consumer-config block: the diagnosis curl matrix, the `EVERYPROPERTY_API_TOKEN` (CRM) ↔ `EVERYPROPERTY_API_KEYS` (server) must-match invariant, and that `/api/address-suggest` is middleware-gated (unlike the self-authenticating `/api/search`/`/api/proposal`).
- `services/everypropertyai/CRM_INTEGRATION_PROMPT.md` (modify) — note the required `EVERYPROPERTY_API_TOKEN` env var and the allowlist invariant for the CRM consumer specifically.

**Approach:** Documentation/runbook (no app-code change). The diagnosis matrix against the prod base URL:
1. `/api/address-suggest?q=…` with **no** `Authorization` header → expect 401 (confirms the gate).
2. …with the **CRM's** token → 200 ⇒ token is fine (cause was unset env / not threaded); 401 ⇒ token is wrong/stale.
3. …with a **known-good** server key → 200 ⇒ confirms the server allowlist; the CRM value just needs to match.
Then state the fix: set `EVERYPROPERTY_API_TOKEN` in the CRM app to a key listed in the server's `EVERYPROPERTY_API_KEYS` (or add the CRM's key to that allowlist and redeploy). The actual env edit happens in the **CRM repo/host**, out of this repo's scope.

**Test scenarios:** `Test expectation: none — documentation/runbook; correctness is verified by the curl matrix and U1's unit tests.`

**Verification:** Following the runbook, an operator can state within minutes whether the CRM sends no key or a rejected key, apply the matching fix, and see the CRM enrich for "120 Moondarra Drive" return populated data.

---

## Scope Boundaries

**In scope:** client-side 401 error hardening; a diagnosis runbook; documenting the `EVERYPROPERTY_API_TOKEN ↔ EVERYPROPERTY_API_KEYS` invariant.

**Out of scope (true non-goals):**
- Setting env vars in the CRM app — that change lives in the CRM repo/host, not here.
- Changing the middleware auth model or making `/api/address-suggest` self-authenticate / public (the user flagged "rethink auth" as a separate option, not chosen).
- Any change to `/api/search`, `/api/proposal`, `/api/agents/listings` auth.

### Deferred to Follow-Up Work
- **Make `/api/address-suggest` consistent with the self-authenticating endpoints** (in-route auth) if the middleware-vs-in-route split proves confusing for consumers — a deliberate auth-model change, deferred unless requested.
- **A client-side preflight/health helper** (e.g. `client.checkAuth()`) the CRM could call once at startup to fail fast with the hardened message.

---

## Risks & Dependencies

- **Wrong cause assumed.** Mitigated by U2's diagnosis matrix — the fix is chosen from observed `curl` results, not guessed (the user is on the "not sure which" path).
- **Hardening breaks auth-disabled deployments.** Mitigated by R4: no construction-time failure; the new message only fires on an actual 401, which an auth-disabled server never returns.
- **Test-runner wiring (implementation-time unknown).** `services/everypropertyai` has no existing tests and uses NodeNext `.js` import specifiers; confirm the root `vitest` run resolves the new test (or add a package-local vitest config). Resolve during U1.
- **Leaking key values in the runbook.** The runbook must use placeholders (`<crm-token>`, `<server-key>`), never real `epai_…` values.

---

## Sources & Research

Codebase grounding (no external research — internal auth, fully traced locally):
- `src/middleware.ts` — `apiKeyGate`, the same-origin exemption, the `/api/...` matcher, and the auth-disabled-when-unset behavior.
- `services/everypropertyai/src/client.ts` — `request()` header attachment (`if (this.token)`), `PropertyIQError` construction, `suggestAddresses`/`resolveAddress` calling `/api/address-suggest`.
- Memory: the everypropertyAI consumer-config convention (`EVERYPROPERTY_API_URL` + `EVERYPROPERTY_API_TOKEN` sent as `Authorization: Bearer`), and that `/api/search`/`/api/proposal`/`/api/agents/listings` self-authenticate in-route.
