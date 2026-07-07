---
title: "feat: Add Harkaway to sold + for-sale data feeds"
status: active
date: 2026-07-08
type: feat
depth: lightweight
---

# feat: Add Harkaway to sold + for-sale data feeds

## Summary

Harkaway (VIC 3806) never gets scraped. It is present in every feed's **service-area filter** (the allow-list that decides whether a scraped row is kept) but is **absent from every feed's scrape queue** (the list of suburbs each ingest script actually queries). The result: rows would be accepted if they appeared, but no feed ever asks the portal for Harkaway, so sold and for-sale listings for the suburb are silently missing.

The fix is a one-line addition to each of the four active feeds' scrape-queue constants. No new logic, no schema change — Harkaway already passes the downstream filter, geocoding, and dedup paths that every other suburb uses.

---

## Problem Frame

Each ingest script carries two suburb lists:

1. A **scrape queue** — `SUBURB_SLUGS` (domain / rea / homely) or `SUBURBS` (view-apify) — iterated to build the per-suburb portal requests.
2. A **service-area filter** — `SERVICE_AREA` / `SERVICE_AREA_SUBURBS` — used to reject out-of-area rows.

Harkaway is in list 2 everywhere but list 1 nowhere. Adding it to list 1 in each feed closes the gap. The daily crons (`daily-domain-scrape.yml`, `daily-rea-apify-scrape.yml`, `daily-homely-scrape.yml`) iterate the full `SUBURB_SLUGS` by default, so they pick up the new suburb automatically with no workflow change.

**Category coverage** (per user: sold + for sale):
- Sold → `ingest-domain-webunlocker.mjs` (→ `property_sales`), `ingest-view-apify.mjs`
- For sale → `ingest-domain-webunlocker.mjs`, `ingest-rea-apify.mjs`, `ingest-homely.mjs`, `ingest-view-apify.mjs`

**Decision (confirmed with user):** add Harkaway to **all four feeds** for consistency and maximum coverage, matching how every other suburb is handled.

---

## Requirements

- R1. Harkaway (VIC 3806) sold listings are scraped by every feed that produces sold data (domain-webunlocker, view-apify).
- R2. Harkaway for-sale listings are scraped by every feed that produces on-market data (domain-webunlocker, rea-apify, homely, view-apify).
- R3. No regression to existing suburbs — the change is purely additive to each scrape queue.
- R4. Scraped Harkaway rows survive the existing service-area filter and land in the correct tables.

---

## Key Technical Decisions

- **Slug format `harkaway-vic-3806`** for the three `SUBURB_SLUGS` feeds — mirrors the `suburb-vic-postcode` convention used for every other entry (e.g. `berwick-vic-3806`). Harkaway shares postcode 3806 with Berwick.
- **Tuple `['Harkaway', '3806']`** for view-apify's `SUBURBS`, matching its `[suburb, postcode]` shape.
- **All four feeds in one atomic commit** — it is a single logical change ("cover Harkaway"), and grouping keeps the feeds' suburb sets in lockstep.
- **No cron/workflow edits** — scripts default to the full queue; the crons inherit the addition for free. view-apify has no dedicated workflow in `.github/workflows/`; confirm its trigger path during verification (execution-time note, U1 verification).

---

## Implementation Units

### U1. Add Harkaway to all four feed scrape queues

**Goal:** Harkaway is queried by every sold and for-sale feed.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `scripts/ingest-domain-webunlocker.mjs` — add `'harkaway-vic-3806'` to `SUBURB_SLUGS` (the array at ~line 46).
- `scripts/ingest-rea-apify.mjs` — add `'harkaway-vic-3806'` to `SUBURB_SLUGS` (~line 55).
- `scripts/ingest-homely.mjs` — add `'harkaway-vic-3806'` to `SUBURB_SLUGS` (~line 63).
- `scripts/ingest-view-apify.mjs` — add `['Harkaway', '3806']` to the `SUBURBS` tuple array (~line 42, under the `// Casey` group).

**Approach:** Insert the new entry next to the other 3806/Casey suburbs (e.g. adjacent to `berwick-vic-3806`) so the lists stay readable. Do not touch the `SERVICE_AREA` / `SERVICE_AREA_SUBURBS` filters — Harkaway is already in them. Pure additive edit, no logic change.

**Patterns to follow:** every existing entry in each list is the template; match quoting, casing, and grouping exactly.

**Test scenarios:** `Test expectation: none — pure config addition to existing, already-tested ingest paths.` The existing `ingest-domain-webunlocker.test.mjs` and `ingest-homely.test.mjs` continue to exercise the pipeline; no suburb-specific unit test is warranted.

**Verification (execution-time):**
- Run each feed scoped to the new suburb and confirm rows land without error, e.g. `SLUGS=harkaway-vic-3806 node scripts/ingest-domain-webunlocker.mjs sold` (and `sale`), then `... ingest-rea-apify.mjs`, `... ingest-homely.mjs`. For view-apify, run its normal entry point and confirm Harkaway appears in the actor's location set.
- Confirm the portal actually resolves the `harkaway-vic-3806` slug (real suburb, expected yes) — if a portal 404s the slug, adjust to that portal's slug form and note it.
- Spot-check the DB: Harkaway rows present in `property_sales` (sold) and `property_listings` (for sale) with the expected `source` tags.
- Note Harkaway is a small, semi-rural suburb — low listing volume is expected and not a failure.

---

## Scope Boundaries

**In scope:** adding Harkaway to the four feed scrape queues; verifying rows land.

### Deferred to Follow-Up Work
- Backfill of historical Harkaway sold sales via `ingest-legacy-backfill.mjs` (it filters on service-area only and has no scrape queue, so no change is needed there for go-forward coverage; a one-off historical backfill is a separate task if wanted).
- Any per-suburb feed-health alerting for Harkaway specifically.

---

## Risks & Dependencies

- **Marginal cost/time increase** — one extra suburb per morning run across four feeds (Apify actor calls, Web Unlocker requests). Negligible, but worth noting against the Apify spend cap referenced in project ops.
- **Slug validity** — the `-vic-3806` slug is assumed valid for Domain/REA URL construction; verification step U1 catches a mismatch.
- No data-model, auth, or downstream-consumer surface is touched.
