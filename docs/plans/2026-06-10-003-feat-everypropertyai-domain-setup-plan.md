---
title: "feat: Point everypropertyai.com at the Railway prod service (split app + api)"
status: active
date: 2026-06-10
type: feat
---

# feat: Point everypropertyai.com at the Railway prod service (split app + api)

## Summary

The everypropertyai.com domain was registered (2026-06-06) to front the Railway production service (`geaeverypropertyai-production.up.railway.app`), which is a single Next.js app serving **both** the UI (`/screen`, `/property`, …) and the API (`/api/*`). This plan wires the domain to that service in a **split layout**: `everypropertyai.com` + `www` for the app, `api.everypropertyai.com` for the API. Both custom domains attach to the **same** service (Railway supports multiple domains per service), so the split is logical only — no request routing or code change is required.

The codebase is essentially decoupled from its URL: the only Railway-URL references are in `INTEGRATIONS.md` (docs), and **CORS is already wildcard `*`** on every API route, so a new origin needs no code change. The work is therefore mostly **operational** (Railway dashboard + registrar DNS + SSL verification), with small doc/config updates so consumers (recruitAI, CMA, vendor-report) adopt the new API host while the old `*.up.railway.app` URL keeps working as a fallback.

**Operator note:** the Railway-dashboard and registrar-DNS steps require account access this environment does not have — those units are runbooks for the operator to execute; the agent owns the verification tooling and the doc/config updates.

---

## Problem Frame

- The prod service is reachable only at `*.up.railway.app` — an opaque, non-brandable host that consumers hard-code in env vars.
- The domain is registered but not yet pointed anywhere.
- Goal: serve the app on `everypropertyai.com` and the API on `api.everypropertyai.com` over HTTPS, without disrupting the working `*.up.railway.app` URL that recruitAI/CMA/vendor-report currently call.

**Non-disruption constraint:** Railway keeps the generated `*.up.railway.app` domain active alongside custom domains, so existing consumers continue working throughout — the cutover to the branded host is a config change consumers make on their own schedule, not a hard switch.

---

## Requirements

- **R1** — `api.everypropertyai.com` resolves over HTTPS to the prod service and serves `/api/*` identically to the current Railway URL (same auth, same responses).
- **R2** — `everypropertyai.com` and `www.everypropertyai.com` resolve over HTTPS to the same service and serve the app UI; `www` and apex behave consistently (one canonical, the other redirecting, per Railway's redirect setting).
- **R3** — A valid TLS certificate is provisioned and auto-renewing for all three hostnames.
- **R4** — The existing `*.up.railway.app` URL continues to work unchanged (no consumer breakage).
- **R5** — Integration docs and consumer configs (recruitAI `EVERYPROPERTY_API_URL`, CMA, vendor-report) are updated to the new API host, with the old URL noted as fallback.
- **R6** — No change to API logic, auth, response shapes, or CORS behavior.

---

## Key Technical Decisions

- **Both custom domains on one service (R1, R2).** apex/www and `api.` all attach to the existing `geaeverypropertyai-production` service. The app already answers UI and API on any Host header, so there is nothing to route. The split is for branding/consumer clarity, not request separation.
- **DNS record types follow Railway's per-host guidance (R1, R2).** Subdomains (`www`, `api`) take a **CNAME** to the Railway-provided target. The **apex** (`everypropertyai.com`) cannot take a CNAME under standard DNS — use the registrar's **ALIAS/ANAME/flattened-CNAME** feature, or Railway's apex guidance (an A record to Railway's edge if they provide one). Exact target is read from the Railway dashboard at setup time.
- **Keep `*.up.railway.app` as fallback (R4, R5).** Consumers migrate to `api.everypropertyai.com` at their own pace; the old host stays live. Docs record both.
- **No CORS change (R6).** Routes already send `Access-Control-Allow-Origin: *`; a new origin is already permitted. (If a future hardening pass narrows CORS to an allowlist, the new domains must be added — noted as deferred, not done here.)

---

## High-Level Technical Design

```
   registrar DNS                         Railway (one service:
   ───────────────                        geaeverypropertyai-production)
   everypropertyai.com   ─ALIAS/A──┐
   www.everypropertyai.com ─CNAME──┼──►  custom domains attached
   api.everypropertyai.com ─CNAME──┘       │
                                           ├─ serves app UI  (/screen, /property, …)
   *.up.railway.app  (kept) ───────────────┤
                                           └─ serves API     (/api/*)  [CORS: *]

   consumers (recruitAI / CMA / vendor-report)
     old:  https://geaeverypropertyai-production.up.railway.app   (fallback, still works)
     new:  https://api.everypropertyai.com                        (branded)
```

---

## Implementation Units

### U1. Attach custom domains in Railway and capture DNS targets (operator)

**Goal:** Register `everypropertyai.com`, `www.everypropertyai.com`, and `api.everypropertyai.com` as custom domains on the prod service and record the DNS targets Railway returns.

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:** none (Railway dashboard).

**Approach (click-path):** Railway → project → the `geaeverypropertyai-production` service → **Settings → Networking → Public Networking → Custom Domain**. Add each of the three hostnames. For each, Railway shows the required DNS record (CNAME target for `www`/`api`; apex guidance for the bare domain). **Copy each target verbatim** — they feed U2. Confirm the service's HTTP server already binds `0.0.0.0:$PORT` (it does — the public Railway URL works today), so no bind change is needed.

**Test scenarios:** `Test expectation: none — dashboard configuration.` Verification is the dashboard showing all three domains in "pending DNS" state with their targets displayed.

**Verification:** Three custom domains listed on the service, each showing its DNS target and an "awaiting DNS / certificate" status.

---

### U2. Create registrar DNS records (operator)

**Goal:** Point the domain's DNS at the Railway targets from U1 so the hostnames resolve to the service.

**Requirements:** R1, R2, R3

**Dependencies:** U1 (needs the exact targets)

**Files:** none (domain registrar / DNS provider).

**Approach (runbook):**
- `www.everypropertyai.com` → **CNAME** → Railway target from U1.
- `api.everypropertyai.com` → **CNAME** → Railway target from U1.
- `everypropertyai.com` (apex) → **ALIAS/ANAME** (or flattened CNAME) → Railway target; if the registrar supports neither, use the **A record to Railway's apex IP** per Railway's displayed guidance.
- Leave any other existing records (e.g. email MX) untouched.
- Allow for DNS propagation and Railway's automatic Let's Encrypt cert issuance (minutes to a few hours).

**Test scenarios:** `Test expectation: none — DNS configuration; validated by U4.`

**Verification:** `dig`/`nslookup` shows each hostname resolving to the Railway target; Railway dashboard flips the domains to "active / certificate issued".

---

### U3. Update integration docs and consumer configs

**Goal:** Record the new branded hosts and migrate consumer configuration, keeping the old URL documented as fallback.

**Requirements:** R5

**Dependencies:** none (can be prepared in parallel; values are known)

**Files:**
- `INTEGRATIONS.md` (modify) — replace/augment the public base URL with `https://everypropertyai.com` (app) and `https://api.everypropertyai.com` (API); note `*.up.railway.app` as fallback
- `.env.local.example` (modify, if it carries an API URL var) — show `EVERYPROPERTY_API_URL=https://api.everypropertyai.com`
- Consumer-side env (operator, other repos/services): recruitAI `EVERYPROPERTY_API_URL`, GEA_ST_CMA, vendor-report — point at `https://api.everypropertyai.com` (their API keys `epai_*` are unchanged)

**Approach:** Documentation + env-value changes only; no logic. Consumers can cut over after U4 confirms the API host is live. The agent owns the in-repo doc edits; the operator owns env changes in the other services.

**Test scenarios:**
- Doc check: `INTEGRATIONS.md` shows both the app and API branded hosts plus the fallback URL; no stale instruction implies the old URL is the only one.
- `Test expectation: none for the doc edits beyond review` — these are documentation/config, not behavior-bearing code.

**Verification:** Docs reflect the split hosts + fallback; a reader can configure a new consumer against `api.everypropertyai.com` without guessing.

---

### U4. Verify HTTPS, parity, and auth on the new hosts

**Goal:** Confirm the branded hosts serve correctly over HTTPS with identical API behavior and working TLS, before consumers cut over.

**Requirements:** R1, R2, R3, R4, R6

**Dependencies:** U1, U2 (domains live)

**Files:** none (verification commands; optionally a short note appended to `INTEGRATIONS.md`).

**Approach:** Once Railway shows the certs issued, verify from the public internet:
- API parity: a known-good authenticated request to `https://api.everypropertyai.com/api/agents/listings?...` with a valid `Bearer epai_*` returns **200** and the same JSON shape as the `*.up.railway.app` host.
- Auth still enforced: the same request **without** a token returns **401**.
- App host: `https://everypropertyai.com` returns the app (200 after any apex→www or www→apex redirect).
- TLS: certificate is valid (not self-signed/expired) for all three hostnames.
- Fallback intact: the original `*.up.railway.app` URL still returns 200 for the same authed request (R4).

**Test scenarios:**
- Happy path: authed `GET` on `api.everypropertyai.com` → 200, body matches the Railway-URL response for the same query.
- Auth: no-token request → 401.
- App: `everypropertyai.com` → 200 (post-redirect); `www` and apex resolve consistently.
- TLS: cert chain valid for all three hosts.
- Regression: `*.up.railway.app` authed request still 200 (no consumer breakage).

**Verification:** All five checks pass; the branded API host is byte-compatible with the old one and auth/TLS are correct.

---

## Scope Boundaries

**In scope:** attaching the three custom domains to the existing service; registrar DNS; SSL verification; doc + consumer-config updates; parity/auth/TLS verification.

**Out of scope (true non-goals):**
- API logic, auth scheme, response shapes, CORS behavior — unchanged.
- A separate marketing site on the apex (the apex serves the existing app for now).
- Email/MX or other DNS records unrelated to web routing.

### Deferred to Follow-Up Work
- **CORS hardening:** if wildcard `*` is later narrowed to an allowlist, add the new origins. Not done here (would change behavior).
- **Apex → marketing site split:** if a dedicated marketing site is later built, repoint the apex and keep `api.`/app hosts as-is.
- **Forcing consumers off the `*.up.railway.app` fallback:** optional later cleanup once all consumers have migrated.

---

## Risks & Dependencies

- **Apex DNS limitation.** The bare domain can't take a plain CNAME; requires registrar ALIAS/ANAME or an A record per Railway guidance. Mitigation: U2 explicitly handles the apex case; if the registrar lacks ALIAS support, fall back to Railway's apex A-record instructions.
- **Propagation / cert delay.** DNS + Let's Encrypt issuance can take minutes to hours; U4 must wait for "certificate issued" before verifying. Not a failure, just latency.
- **Consumer cutover timing.** Updating a consumer's `EVERYPROPERTY_API_URL` before the host is verified live would break it. Mitigation: U3 doc/prep first, consumer env cutover only after U4 passes; fallback URL stays live throughout (R4).
- **Operator-gated steps.** U1 (Railway) and U2 (registrar) need account access outside this environment. The agent provides exact click-paths/records and owns U4 verification + U3 in-repo docs.

---

## Sources & Research

Codebase grounding (no external research needed — strong local signal):
- URL coupling: only `INTEGRATIONS.md` references `geaeverypropertyai-production.up.railway.app` (lines 7, 36); no hardcoded base URLs in `src/`.
- CORS: `Access-Control-Allow-Origin: *` across API routes (`src/app/api/*/route.ts`, `src/middleware.ts`) — new origins already permitted.
- Prod service confirmed serving UI (`/screen`) and API (`/api/agents/listings`, returns 200 authed / 401 unauthed) on the current Railway host this session.
