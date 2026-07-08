---
title: "feat: Add 11 missing Casey/Cardinia suburbs to sold + for-sale feeds"
status: active
date: 2026-07-08
type: feat
depth: lightweight
---

# feat: Add 11 missing Casey/Cardinia suburbs to sold + for-sale feeds

## Summary

Same gap the Harkaway change closed, batched. Of the 24 suburbs requested, **13 are already in every feed's scrape queue** and need no work. The remaining **11 are present in each feed's service-area filter but absent from the scrape queues**, so no feed ever queries them — sold and for-sale listings for those suburbs are silently missing.

Fix: add the 11 suburbs to each of the four feeds' scrape-queue constants, exactly as Harkaway was added (see `docs/plans/2026-07-08-001-feat-harkaway-feed-coverage-plan.md`).

**Already covered (no action):** hallam, endeavour hills, hampton park, narre warren south, cranbourne north, clyde, clyde north, cardinia, koo wee rup, nar nar goon, tynong, garfield, bunyip.

**To add (the 11):** narre warren north, narre warren east, lysterfield south, guys hill, dewhurst, pakenham upper, officer south, dalmore, tynong north, maryknoll, garfield north.

---

## Problem Frame

Each ingest script carries two suburb lists: a **scrape queue** (`SUBURB_SLUGS` in domain/rea/homely, `SUBURBS` in view-apify) that drives which suburbs are queried, and a **service-area filter** (`SERVICE_AREA` / `SERVICE_AREA_SUBURBS`) that rejects out-of-area rows. All 11 target suburbs are in the filter everywhere but the queue nowhere. Adding them to the queue closes the gap; the daily crons (`daily-domain-scrape.yml`, `daily-rea-apify-scrape.yml`, `daily-homely-scrape.yml`) iterate the full queue by default, so they pick up the additions with no workflow change.

**Slug format:** domain/rea/homely use `suburb-vic-postcode` (e.g. `narre-warren-north-vic-3804`); view-apify uses a `['Suburb Name', 'postcode']` tuple. Postcodes below are best-known and must be confirmed at execution (a wrong postcode produces a 404 slug):

| Suburb | Postcode (verify) | Note |
|---|---|---|
| Narre Warren North | 3804 | |
| Narre Warren East | 3804 | small; may fold into a parent on some portals |
| Lysterfield South | 3156 | Knox-side boundary suburb |
| Guys Hill | 3807 | small semi-rural |
| Dewhurst | 3808 | small semi-rural |
| Pakenham Upper | 3810 | |
| Officer South | 3809 | |
| Dalmore | 3981 | small rural |
| Tynong North | 3813 | small rural |
| Maryknoll | 3812 | small rural |
| Garfield North | 3814 | small rural |

**Category coverage:** sold = domain-webunlocker + view-apify; for-sale = all four feeds. Adding to all four (as confirmed for Harkaway) covers both.

---

## Requirements

- R1. Each of the 11 suburbs is scraped by every feed that produces sold data (domain-webunlocker, view-apify).
- R2. Each of the 11 suburbs is scraped by every feed that produces on-market data (all four feeds).
- R3. No regression to existing suburbs — the change is purely additive to each scrape queue.
- R4. Scraped rows survive the existing service-area filter and land in the correct tables.
- R5. A portal that has no page for a given suburb slug (404/empty) fails soft for that suburb without aborting the run or corrupting expiry sweeps for the others.

---

## Key Technical Decisions

- **Add to all four feeds** (domain-webunlocker, rea-apify, homely, view-apify) — consistent with the Harkaway decision and with how every other suburb is handled.
- **Verify each postcode/slug at execution.** The tiny localities are the failure risk; confirm the portal resolves each slug (or adjust to the portal's form) rather than trusting the table above blindly.
- **One atomic commit** — a single logical change ("extend suburb coverage"), keeping the four feeds' suburb sets in lockstep.
- **No cron/workflow edits** — scripts default to the full queue.

---

## Implementation Units

### U1. Add the 11 suburbs to all four feed scrape queues

**Goal:** every sold and for-sale feed queries the 11 suburbs.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** none

**Files:**
- `scripts/ingest-domain-webunlocker.mjs` — add the 11 `suburb-vic-postcode` slugs to `SUBURB_SLUGS`.
- `scripts/ingest-rea-apify.mjs` — add the same 11 slugs to `SUBURB_SLUGS`.
- `scripts/ingest-homely.mjs` — add the same 11 slugs to `SUBURB_SLUGS`.
- `scripts/ingest-view-apify.mjs` — add the 11 `['Suburb', 'postcode']` tuples to `SUBURBS`.

**Approach:** Insert the new entries grouped with their geographic neighbours (e.g. Narre Warren North/East near the other Narre Warrens, the Pakenham/Officer/Nar Nar Goon/Tynong/Garfield satellites near their parents) so the lists stay readable. Do not touch the `SERVICE_AREA` / `SERVICE_AREA_SUBURBS` filters — all 11 are already in them. Confirm each postcode before writing the slug.

**Patterns to follow:** the Harkaway addition (`docs/plans/2026-07-08-001-…`) and every existing entry in each list.

**Test scenarios:** `Test expectation: none — pure config addition to existing, already-tested ingest paths.` Existing feed tests (`ingest-domain-webunlocker.test.mjs`, `ingest-homely.test.mjs`) continue to exercise the pipeline.

**Verification (execution-time):**
- Run each feed scoped to the new suburbs, e.g. `SLUGS=narre-warren-north-vic-3804,maryknoll-vic-3812,… node scripts/ingest-domain-webunlocker.mjs sold` (and `sale`), then rea-apify and homely; for view-apify run its normal entry and confirm the new tuples appear in the actor's location set.
- For each suburb, confirm the portal resolves the slug. Any 404s → correct the postcode/slug form and note it; if a portal genuinely lacks a suburb, leave it out for that feed and record why (R5 — it must fail soft, not abort).
- Spot-check the DB: rows for the added suburbs appear in `property_sales` (sold) and `property_listings` (for sale) with expected `source` tags. Low/zero volume for the tiny rural suburbs is expected, not a failure.

---

## Scope Boundaries

**In scope:** adding the 11 missing suburbs to the four scrape queues; verifying slugs and that rows land.

### Deferred to Follow-Up Work
- Historical backfill of solds for the new suburbs via `ingest-legacy-backfill.mjs` (go-forward coverage needs no change there; a one-off backfill is separate).
- The 13 already-covered suburbs — no action.

---

## Risks & Dependencies

- **Slug/postcode validity** is the main risk — the small rural localities may 404 or fold into a parent suburb on some portals. Verification per U1 catches this; the ingest already fails soft per-suburb (the WU concurrency + feed-health logic only sweeps expiry when zero suburbs failed), so a 404 is noisy but not destructive.
- **Marginal cost/time increase** — 11 extra suburbs × four feeds per morning (Apify/Web-Unlocker calls). Small but non-zero against the Apify spend cap.
- No data-model, auth, or downstream-consumer surface is touched.
