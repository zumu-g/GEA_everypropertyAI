---
title: "feat: Add rentals to the daily Domain Web Unlocker feed"
type: feat
status: completed
created_at: 2026-07-04
---

# feat: Add rentals to the daily Domain Web Unlocker feed

## Summary

Extend the proven morning Domain feed (`scripts/ingest-domain-webunlocker.mjs`, run daily by `.github/workflows/daily-domain-scrape.yml` for `sold` and `on-market`) with a third category, `rent`. The same Casey/Cardinia suburb list is scraped from Domain's rental search pages via Bright Data Web Unlocker and upserted into the existing (currently empty) `property_rentals` table. Rent gets the same feed-health reporting as the other categories and is treated as a must-be-fresh feed in the morning Telegram digest from day one.

No new scraper backends, no schema changes, no changes to the rental read paths — `getRentalsForSuburb`, `/api/rental-listings`, the vendor report, and the everypropertyai CLI are already built and waiting for data.

---

## Problem Frame

`property_rentals` was created in migration 001 (June 2026) but never populated: the planned Apify rent run was blocked by the account spend cap and the feed was subsequently rebuilt on Bright Data Web Unlocker for sold and on-market only. Every rental-facing feature (rental comps, rent filters from migration 006, the CLI `rentals` command) currently returns empty results. The Web Unlocker feed has been the reliable morning source since June — rentals should ride the same rails rather than resurrect the dead Apify path.

## Requirements

- R1. Each morning run scrapes Domain rental listings for the existing 29 Casey/Cardinia suburb slugs and upserts in-area rows into `property_rentals` (dedup on `raw_address,source`, `source='domain-web-unlocker'`).
- R2. The rent run writes a `feed_health` row (`category='rent'`) with the same blocked/ok/empty status derivation as sold and on-market.
- R3. The morning feed digest treats `rent` as an expected category: a stale or missing rent feed flags in the digest.
- R4. Sold and on-market behaviour is unchanged — same script, same workflow, no regression.
- R5. Rent rows re-seen on later runs refresh `last_seen_at`, and rows no longer seen on a full (non-blocked) run are expired (`active=false`), so the `active=true` read filter used by `getRentalsForSuburb`, `/api/rental-listings`, and the vendor report reflects what is actually still on the market rather than accumulating leased/withdrawn rows forever.

---

## Key Technical Decisions

- **Extend the existing script, not a new one.** `ingest-domain-webunlocker.mjs` is already category-driven via its `CATEGORY` map; rent is one more entry (`path: 'rent'`, `table: 'property_rentals'`, `conflict: 'raw_address,source'`). Fetch, retry, body-validation, concurrency pool, blocked-detection, and feed-health plumbing are all reused untouched. `scripts/lib/feed-health.mjs` already types `category` as `'sold'|'on-market'|'rent'`.
- **Rent row shape mirrors the rent branch of `mapItem` in `src/lib/ingest/domain-mapper.ts`.** `display_price` verbatim, `weekly_rent` = lowest dollar amount in the display string (the `parseWeeklyRent` convention: "$520 - $560 pw" → 520), `status` from the tag text. Rows with no parseable rent are still kept (`weekly_rent` null) — unlike sold, where a missing price makes the row useless.
- **Refresh `last_seen_at` (and `active: true`) on rent rows at upsert, then expire unseen rows after a full run.** The merge-duplicates upsert otherwise leaves `last_seen_at` at first-insert time forever, so rent rows re-seen on later runs must set `last_seen_at: now, active: true`. Refresh alone isn't enough — a leased/withdrawn property that stops appearing on Domain never gets `active=false`, so it would sit in `property_rentals` as a live comp indefinitely. Mirror the expiry semantics of `expireNotSeen()` in `src/lib/db/queries.ts` (PATCH `property_rentals` set `active=false` where suburb in-scope, `state='VIC'`, `active=true`, `last_seen_at < runStartIso`) via a direct Supabase REST PATCH from the `.mjs` script — the ingest scripts don't import the TS query layer, they talk to PostgREST directly, same as `upsert()` in this file. Only run expiry after a full (non-blocked, non-`SLUGS`-restricted) suburb run, so a partial or blocked scrape never wrongly expires rentals in suburbs it didn't touch. Applied in the rent branch only — `property_sales` has no such column, and retrofitting on-market's own version of this same gap is deferred (see Scope Boundaries).
- **Digest: rent expected from day one** (user decision). The `EXPECTED_CATEGORIES` default in `scripts/notify-feed-digest.mjs` changes from `'sold,on-market'` to `'sold,on-market,rent'`.
- **Healthchecks.io dead-man's-switch for rent: deferred** (user decision). The workflow passes an empty `HEALTHCHECK_UUID` for the rent matrix leg; the script already no-ops pings when unset. The digest expectation (R3) covers alerting in the meantime.
- **Assumed: Domain's `/rent/{slug}/` pages embed the same `__NEXT_DATA__` → `listingsMap` structure as `/sale/` and `/sold-listings/`.** High confidence (same Next.js app; the June Apify plan used the same actor across all three modes), but verified at implementation with a single-suburb live run before enabling the schedule. If the shape differs, `extractListings` needs a rent-specific path — surface and re-plan rather than hack around it.

---

## Implementation Units

### U1. Add the `rent` category to the Web Unlocker ingest script

- **Goal:** `node scripts/ingest-domain-webunlocker.mjs rent` scrapes Domain rentals for all 29 suburbs, upserts into `property_rentals`, and expires rentals no longer seen.
- **Requirements:** R1, R2, R5
- **Dependencies:** none
- **Files:** `scripts/ingest-domain-webunlocker.mjs`, `scripts/ingest-domain-webunlocker.test.mjs`
- **Approach:**
  - Add `rent: { path: 'rent', table: 'property_rentals', conflict: 'raw_address,source' }` to the `CATEGORY` map; update the usage/error strings from `sold|on-market` to `sold|on-market|rent`.
  - In `mapListing`, add a rent branch returning `{ ...common, display_price, weekly_rent, status: tag, last_seen_at: now, active: true }`. `weekly_rent` = lowest dollar amount from the existing `dollarAmts` helper (mirrors `parseWeeklyRent`), null when the display string has no dollar figure ("Contact agent").
  - Export `mapListing` so the test file can exercise it directly (currently module-private; `extractListings`/`looksLikeData` are already exported for the same reason).
  - Feed-health write needs no change — `category` flows through from argv.
  - After the upsert, when `category === 'rent'` and the run was not blocked and used the full suburb set (no `SLUGS` env override, `maxSuburbs` unset), PATCH `property_rentals` via the Supabase REST endpoint: set `active=false` where `suburb` is in the scraped suburb set, `state='VIC'`, `active=true`, `last_seen_at < startedAtIso` (the run's own start timestamp, captured before fetching). Log the count of rows expired.
- **Patterns to follow:** the existing `sold` vs on-market branching in `mapListing`; `parseWeeklyRent` in `src/lib/ingest/domain-mapper.ts`; the `expireNotSeen()` query shape in `src/lib/db/queries.ts` (same predicate, translated to a direct PostgREST PATCH since this script doesn't import the TS query layer); `last_seen_at`/`active` refresh in `scripts/ingest-legacy-backfill.mjs`.
- **Test scenarios** (in `scripts/ingest-domain-webunlocker.test.mjs`, vitest, using the existing `NEXT_DATA` fixture helper):
  - Happy path: a rent listing node with address, features, and price "$550 per week" maps to a row with `weekly_rent` 550, `display_price` preserved, `source: 'domain-web-unlocker'`, `active: true`, and a `last_seen_at` timestamp.
  - Range price: "$520 - $560 pw" → `weekly_rent` 520 (lowest amount).
  - No parseable rent: "Contact agent" → row kept with `weekly_rent` null (contrast: sold with no price returns null and is skipped — assert both to pin the asymmetry).
  - Missing street or suburb → null (skip), same as other categories.
  - Out-of-area suburb rows are filtered by the existing `inArea` gate (exercise via `mapListing` + the filter, or assert suburb passes through for the gate).
  - Unknown category string passed to the CLI exits non-zero (existing behaviour extended — can be covered by asserting `CATEGORY` has exactly the three keys if the exit path isn't directly testable).
  - Expiry gate: a blocked run (fetchedOk === 0) and a `SLUGS`-restricted run must NOT trigger the expiry PATCH — assert the expiry function is skipped/not called in both cases, and IS called on a full, non-blocked run.
- **Verification:** `npx vitest run scripts/ingest-domain-webunlocker.test.mjs` green; then one live smoke run `node scripts/ingest-domain-webunlocker.mjs rent 1` (single suburb) confirms the `/rent/` page shape assumption, prints a non-zero in-area count for a busy suburb (e.g. berwick), and rows appear in `property_rentals` with sensible `weekly_rent` values. Note the single-suburb smoke run itself must not trigger expiry (it's a `maxSuburbs`-restricted run) — confirm no unrelated suburbs' rentals are expired by it.

### U2. Add rent to the daily GitHub Actions matrix

- **Goal:** The morning workflow runs rent alongside sold and on-market as a third parallel job.
- **Requirements:** R1, R4
- **Dependencies:** U1
- **Files:** `.github/workflows/daily-domain-scrape.yml`
- **Approach:** Add `rent` to `matrix.category`. The current `HEALTHCHECK_UUID` ternary only distinguishes sold vs on-market; restructure to a `matrix.include` mapping (category → healthcheck secret name) so each leg is explicit, with rent's entry empty for now (script no-ops the ping). Keep `fail-fast: false` and the 45-minute per-job timeout — rent is the same 29-suburb fetch profile as on-market, well inside budget at 4-wide concurrency.
- **Test scenarios:** Test expectation: none — CI config; verified by a live `workflow_dispatch` run.
- **Verification:** Manual `workflow_dispatch` shows three parallel jobs; the rent job exits 0 with a `status=ok items=N` summary line; sold and on-market legs still resolve their existing Healthchecks UUIDs (check the run logs ping lines).

### U3. Expect rent in the morning feed digest

- **Goal:** A stale, blocked, or missing rent feed flags in the daily digest instead of silently vanishing.
- **Requirements:** R3
- **Dependencies:** U1 (a `feed_health` rent row must exist for the digest to report on)
- **Files:** `scripts/notify-feed-digest.mjs`, `scripts/notify-feed-digest.test.mjs`
- **Approach:** Change the `EXPECTED_CATEGORIES` default from `'sold,on-market'` to `'sold,on-market,rent'` and update the header comment. The env override remains for ad-hoc runs.
- **Test scenarios:**
  - Rent row present and fresh → digest line rendered, no warning mark.
  - Rent row missing entirely → digest flags rent as missing/stale (the existing expected-category miss path).
  - `EXPECTED_CATEGORIES` env override still wins over the new default.
- **Verification:** `npx vitest run scripts/notify-feed-digest.test.mjs` green; next morning's Telegram digest shows a rent line.

---

## Scope Boundaries

**In scope:** the three units above — script category, workflow matrix, digest expectation.

### Deferred to Follow-Up Work

- **Healthchecks.io check + `HEALTHCHECK_DOMAIN_RENT_UUID` secret** for the rent leg (user-deferred). One console click + one repo secret when wanted; the U2 include-mapping already has the slot.
- **`last_seen_at`/`active` refresh and expiry for on-market rows** — the same gap this plan closes for rentals (U1) also exists in the on-market branch today; fixing it is tangential to rentals and touches live-listing expiry semantics for a different table.
- **`address_slug` population for rental rows** — no Web Unlocker category sets slugs at ingest today, so slug-keyed reads (e.g. `getFeedSeedBySlug`) return no rentals regardless of freshness. The existing `scripts/backfill-address-slugs.ts` path covers it once slug-based rental reads become load-bearing.
- **Railway cron re-host** — Stage 2 of `docs/plans/2026-06-17-001-fix-data-feed-reliability-resequenced-plan.md`, unchanged by this work.
- **Rentals from other sources** (REA Apify, Homely) — this plan is Domain-only.
- **`listed_date` for rent rows** — Domain's rent search JSON has no listing-date field, so rows go in with `listed_date` unset. Migration 006's `COALESCE(listed_date, created_at)` already covers this: "listed within N days" filters fall back to first-seen-by-feed date rather than a true listing date, which is the intended degraded semantic, not a bug.

---

## Risks

- **Rent page shape differs from sale/sold** — mitigated by the U1 single-suburb smoke run before merging U2; if `listingsMap` is absent on rent pages, stop and re-plan the extraction.
- **Bright Data account is shared across all Domain + Homely feeds** — a third daily category adds ~29 requests/day of Web Unlocker spend; trivial volume, but any account suspension now also takes rentals down (existing failure domain, check `x-brd-err` headers first per prior incident).
- **First run is a cold start** — `property_rentals` goes from 0 to full in one run; digest and feed-health will look "new" rather than "recovered". No action needed, just expected.
