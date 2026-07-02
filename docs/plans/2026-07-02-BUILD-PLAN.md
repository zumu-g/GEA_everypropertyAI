---
title: "everypropertyAI — Build Plan (2026-07-02)"
type: roadmap
status: active
date: 2026-07-02
---

# everypropertyAI Build Plan

Current state as of 2026-07-02. Captures what is shipped, what is in-flight, and what is next — ordered by impact and unblocking sequence.

---

## Recently shipped (no action needed)

| What | Commit/PR | Notes |
|---|---|---|
| Steel accent restyle | Merge 9a08524 | Gold retired; #2E5470 accent; Instrument Sans; DESIGN.md is authority |
| Email + password auth | ba9349b | Magic-link retired; invite-only; cookie fix deployed 4eba651 |
| Admin team invites | e4c1dea | /settings Team page; magic-link invite → set-password |
| Homely supplemental feed | 4bdc204 | Committed; needs one GH secret to activate healthcheck ping |
| WU concurrency fix | scripts/lib/pool.mjs | Domain WU runs 4-wide now; 45-min cap no longer cancels it |
| Feed-health clobber fix | 5e3c6af | Homely writes own 'on-market-homely' category |
| Daily digest + healthchecks | PR #13/14 | Telegram digest; Healthchecks.io UUIDs wired |

---

## In-flight (work started, not fully complete)

### 🔴 P0 — Security: RLS fix (plan `2026-07-02-001-fix-rls-public-tables-plan.md`)

**Status:** Migration `011_enable_rls_public_tables.sql` authored; pre-migration baseline probe run and confirms exposure. Awaiting DB apply.

**What remains:**
1. Apply `src/lib/db/migrations/011_enable_rls_public_tables.sql` in Supabase SQL editor (project `xulylioakpkvfywskmpk`)
2. Run `node --env-file=.env.local scripts/verify-rls.mjs` — all 6 tables must pass
3. Confirm Supabase advisor `rls_disabled_in_public` clears

**Why it's P0:** `addresses` has RLS off → anon key can write it. `crawl_queue`, `property_sales`, `property_cache` expose real rows to any anon-key holder. App's anon client is auth-only so locking is zero-risk.

---

### 🟡 P1 — Infrastructure: Railway cron deploy (Stage 2, U5/U6/U7)

**Status:** Config-as-code files committed (`railway.feeds-*.json`); Railway services not yet created.

**What remains:**
1. **U5 (deploy):** Create 3 Railway services in the `gea_everypropertyai` project (prod env) — each pointed at its `railway.feeds-{domain-sold,domain-onmarket,rea-onmarket}.json`. Set env (reuse shared Supabase/BrightData/Apify vars + per-service `HEALTHCHECK_UUID`). No networking/domain/port needed.
2. **U6 (verify):** Run each service once; confirm feed_health rows land + healthchecks.io pings.
3. **U7 (cutover):** Remove `schedule:` blocks from both GitHub workflows (keep `workflow_dispatch`). Delete dead `vercel.json` crons. Raise PR.

**Why P1:** GitHub Actions cron fires 45–100 min late most mornings (best-effort). Railway cron is exact. This is the reliability gap that made feeds appear broken.

---

### 🟡 P1 — Homely healthcheck: add GH secret

**Status:** Homely feed is live in prod (committed). First prod write happens on next scheduled run. The healthcheck ping no-ops without the secret.

**What remains:**
1. Create a Healthchecks.io check (Simple, 1 day, 2h grace) for the Homely feed
2. Add `HEALTHCHECK_HOMELY_UUID` to GitHub repo secrets
3. Confirm next morning's 7:51am run pings it

**Why P1:** Without the UUID the feed can silently fail (no alert). Takes ~5 min.

---

## Next up (not started)

### 🟢 P2 — Stealth scraper: proxy credentials

**Status:** Stealth scraper backend deployed to Railway (all 3 engines live). Proxy creds still needed.

**What:** Set `BRIGHTDATA_PROXY_HOST`, `BRIGHTDATA_PROXY_PORT`, `BRIGHTDATA_PROXY_USER`, `BRIGHTDATA_PROXY_PASS` on the Railway scraper service (or pass via `STEALTH_SCRAPER_*` env in the main app). This unlocks the stealth fallback when Apify is at spend cap.

---

### 🟢 P2 — Feed reliability: (category, source) PK on feed_health

**Status:** `feed_health.category` is the PK, but Domain WU and REA Apify both write `'on-market'` — last writer wins, can't distinguish which feed is actually blocked.

**What:** Migration `012_feed_health_source_pk.sql` — add `source` column, make PK `(category, source)`. Update the two ingest scripts to pass their source name. Lets the digest report per-source health.

**Why P2:** Not urgent while feeds are healthy, but masks partial outages.

---

### 🟢 P2 — Data: GEA_crmAI RLS fix (separate project)

Supabase advisor also flagged `anynmamtmklygngcxzus` (crmAI) with `rls_disabled_in_public`. Needs its own plan + credentials. Out of scope for everypropertyAI but tracked here to avoid it being forgotten.

---

### 🔵 P3 — Product: address ingest + G-NAF

The `addresses` table is empty (created, RLS now being fixed). G-NAF is the stored-address source per Mapbox memory. Populating it enables `/api/street-details` to return results without a live crawl.

**What:** Decide on G-NAF ingest trigger (cron? on-demand?), author the ingest script using `insertAddresses` in `src/lib/db/queries.ts`.

---

### 🔵 P3 — Product: cachedOnly / fresh flag on /api/property

CMA packs currently always trigger the ~120s live crawl on an uncached address. A `?fresh=0` flag would let CMA packs use cached data instantly and only fall back to a live crawl if the cache is stale.

**What:** Add `cachedOnly` boolean to `/api/property` route; if true and cache hit, return immediately; if cache miss, return 404 (CMA caller decides to fallback).

---

### 🔵 P3 — Actions/checkout v4 → v5 deprecation bump

GitHub Actions workflows use deprecated `actions/checkout@v4` + `setup-node@v4` on Node 20. Low effort, avoids noisy deprecation warnings in CI.

---

## Deferred / parked

- **Valuer-General data** — free quarterly median data from `data.vic.gov.au`; useful for time-series suburb indices but no immediate consumer
- **NBN/childcare enrichment** — type system + schema layer ready; no scraper built yet
- **Photo gallery + skeleton loading** — UX polish; not blocking any integration
- **Broader RLS audit as CI check** — `verify-rls.mjs` could run in CI; worth wiring once crmAI is done

---

## Execution order

```
Now:     P0 RLS fix (apply migration → verify)
Today:   P1 Homely healthcheck secret (5 min)
Week:    P1 Railway cron deploy (U5 → U6 → U7)
Week:    P2 Stealth proxy creds
Later:   P2 feed_health PK fix, crmAI RLS
Backlog: P3 items above
```
