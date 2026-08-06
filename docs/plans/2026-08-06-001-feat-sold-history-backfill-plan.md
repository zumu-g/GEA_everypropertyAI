---
title: "feat: Backfill rich per-property sold history (multi-sale, beds/baths)"
status: active
date: 2026-08-06
type: feat
depth: standard
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Backfill rich per-property sold history (multi-sale, beds/baths)

## Summary

The VIC Valuer-General ingest (built 2026-07-15, `src/lib/jobs/ingest-vg-data.ts`) gives `property_sales` verified price+date rows, but nothing richer: no beds/baths, no listing metadata, and only as far back as VG's free quarterly files reach. Meanwhile the per-property profile pipeline (`src/lib/jobs/fetch-profile.ts`) already extracts full `saleHistory[]` arrays from oldlistings/onthehouse/domain pages — but that history only ever lands in `property_cache`, never in `property_sales`. Two disconnected worlds.

This plan backfills rich multi-sale history for Casey/Cardinia addresses using the **abotapi/realestate-au-scraper Apify actor with price-history enrichment** (structured REA data: sale timelines with dates + prices, beds/baths, ~$1.50/1k results) as the primary source, bridges the existing profile `saleHistory` into `property_sales` as a permanent write-back, and measures coverage before/after.

**Session-settled decisions:**
- Gap = richer per-property data (beds/baths, full listing history), not VG coverage (session-settled: user-directed — chosen over "VG underdelivered": user confirmed the gap is data richness).
- Source selection = compare all, pick best (session-settled: user-directed — chosen over "computer-use is the point": user asked for honest comparison with computer-use as last resort).

---

## Problem Frame

**Who's affected:** the property profile's sale-history display, CMA pack, comparable-sales estimator, and vendor reports — all see thin history (VG price+date only, or single-scrape sold rows with no beds/baths).

**Root cause:** no source of structured multi-sale history has ever been bulk-ingested; the crawl pipeline extracts it per-property on demand but never persists it to `property_sales`.

**Success criteria:**
- Most Casey/Cardinia addresses with any prior sale gain a multi-sale timeline in `property_sales` (distinct `sale_date` rows per address).
- New history rows carry beds/baths where the source provides them.
- Future on-demand profile crawls automatically top up `property_sales` (the write-back is permanent, not one-off).
- Coverage is measured, not assumed: a before/after report quantifies the gain.

---

## Key Technical Decisions

**KTD1 — abotapi Apify actor is the backfill backbone; computer-use screenshots are rejected.** property.com.au is REA-owned; the abotapi actor returns the same REA sale-history data as structured JSON (per-listing timelines of sale/lease/withdrawal events with dates+prices, beds/baths, ~$1.50/1k, history enrichment billed only on non-empty timelines). A vision/computer-use pipeline over screenshots would cost more per property, be far more fragile (Kasada on REA properties), and produce lower-fidelity parses. Rejected on cost, fragility, and fidelity — this is the honest comparison the user asked for.

**KTD2 — Reuse the existing Apify client pattern, not a new integration.** `scripts/ingest-rea-apify.mjs:134-164` and `src/lib/apify/client.ts` already show the run-poll-page pattern (`APIFY_API_TOKEN`, `waitForFinish`, dataset paging). The backfill script mirrors that shape.

**KTD3 — New `source='rea-history-apify'` rows through the existing dedup key.** `property_sales` dedups on `UNIQUE (raw_address, sale_date, sale_price, source)` via `insertPropertySales` (`src/lib/db/queries.ts:931`, upsert + ignoreDuplicates). Timeline events become ordinary rows; re-runs are idempotent. `source` being part of the key means a VG row and an REA-history row for the same sale coexist — acceptable, consistent with how `domain`/`vic-vg` coexist today, and consumers already dedupe by address+date where it matters.

**KTD4 — Bridge profile `saleHistory` → `property_sales` as a permanent write-back, not a one-off.** After `fetch-profile.ts` merges `saleHistory[]` (from oldlistings/onthehouse/domain via the orchestrator), write those entries into `property_sales` with `source='profile-crawl'`. This closes the two-worlds gap forever: every future on-demand crawl tops up history. The oldlistings/onthehouse extraction already exists (`src/lib/firecrawl/sources/`, `src/lib/extraction/merger.ts:115-121`); only the persist step is new.

**KTD5 — Address universe = existing DB addresses, not a suburb sweep.** Enumerate distinct addresses from `property_sales` + `property_listings` (Casey/Cardinia only, guard via the existing service-area convention). Backfilling addresses we already know about serves every current consumer; discovering never-seen addresses is a different (deferred) problem.

**KTD6 — Batch with a resumable cursor.** The VG backfill's known weakness is no cursor (re-processes the same first-20 links). The Apify backfill script must persist progress (last processed address batch) to a local state file or DB marker so it can resume across runs — 10-50k addresses will not finish in one invocation.

---

## Scope Boundaries

**In scope:**
- One-time bulk backfill of Casey/Cardinia addresses via the abotapi actor (price-history enrichment on).
- Permanent profile-crawl → `property_sales` write-back.
- Beds/baths carried from the actor payload; existing `findBedBathMatches` fallback untouched.
- Before/after coverage measurement.

### Deferred to Follow-Up Work
- Domain API partner quote (`GET /v1/properties/{id}` → `history.sales[]`) and Pricefinder API quote — the *legit, verified* long-term options; pursue commercially in parallel, swap in if a quote lands low.
- LANDATA bulk historical purchase (verified VG per-property history, quote-based).
- Discovering never-listed addresses (G-NAF sweep) — different problem, different plan.
- onthehouse.com.au as a backbone source — CoreLogic-owned, ToS explicitly bans scraping/database-building; leave it as the incidental orchestrator fallback it already is, do not build on it.

**Outside scope:** computer-use/screenshot pipeline (rejected per KTD1); NSW/WA history; rental history.

---

## Implementation Units

### U1. Coverage baseline report

**Goal:** Quantify current multi-sale coverage before touching anything.
**Requirements:** success criterion "coverage is measured, not assumed".
**Dependencies:** none.
**Files:** `scripts/report-sold-coverage.mjs` (extend), possibly a small SQL addition.
**Approach:** Extend the existing report to output: distinct addresses in `property_sales`; % with ≥2 distinct sale dates; % of sold rows with beds/baths; per-source row counts. Save output snapshot for the after-comparison.
**Patterns to follow:** existing report script structure.
**Test scenarios:** Test expectation: none — reporting script, verified by running it against prod (read-only).
**Verification:** report runs and prints the four metrics; snapshot saved.

### U2. Apify sale-history backfill script

**Goal:** Bulk-ingest REA sale-history timelines for known Casey/Cardinia addresses.
**Requirements:** primary backfill success criteria (multi-sale timelines, beds/baths).
**Dependencies:** U1 (baseline first).
**Files:** `scripts/backfill-sale-history-apify.mjs` (new), `scripts/backfill-sale-history-apify.test.mjs` (new).
**Approach:**
1. Enumerate distinct `(raw_address, suburb, postcode)` from `property_sales` + `property_listings` (service-role key; RLS since migration 011).
2. Batch addresses to the abotapi actor with price-history enrichment enabled, mirroring the run-poll-page pattern of `scripts/ingest-rea-apify.mjs`.
3. Map each returned timeline event → `property_sales` row: `sale_date`, `sale_price`, beds/baths/car, `property_type`, `listing_url`, `source='rea-history-apify'`, `raw_data` = the event. Skip non-sale events (lease/rent/withdrawal).
4. Guard every row through the service-area check; insert via `insertPropertySales`.
5. Persist a resume cursor (KTD6) after each batch; support `--limit` for a smoke run.
**Execution note:** run a 20-address smoke batch first to validate the actor's payload shape and per-result cost before committing to the full run.
**Patterns to follow:** `scripts/ingest-rea-apify.mjs` (actor invocation, SLUGS env override, service-area guard), `scripts/lib/pool.mjs` (bounded concurrency if needed).
**Test scenarios:**
- Timeline event with sale type, date, price → mapped row with correct fields and `source='rea-history-apify'`.
- Lease/rent/withdrawal event → skipped.
- Event missing sale date → skipped (dedup key needs it).
- Address outside service area in actor response → dropped by guard.
- Resume: cursor at batch N → next run starts at N+1, no re-processing.
- Malformed/empty actor item → skipped without crash.
**Verification:** smoke run inserts expected rows for known multi-sale addresses; full run resumable; cost per 1k within estimate.

### U3. Profile-crawl saleHistory write-back

**Goal:** Every merged profile's `saleHistory[]` persists into `property_sales`, permanently closing the two-worlds gap.
**Requirements:** success criterion "future crawls top up automatically".
**Dependencies:** none (parallel to U2).
**Files:** `src/lib/jobs/fetch-profile.ts` (modify), `src/lib/db/queries.ts` (reuse `insertPropertySales`), `src/lib/jobs/fetch-profile.test.ts` or nearest existing test home (new/extend).
**Approach:** After the merge/ground step in `fetchAndCacheProfile`, map `saleHistory` entries that have a parseable date + price into `property_sales` rows (`source='profile-crawl'`, address fields from the profile's grounded address) and insert best-effort — a write-back failure must never fail the profile fetch. Cite KTD3/KTD4.
**Test scenarios:**
- Profile with 3 sale-history entries (dates+prices) → 3 rows offered to insert.
- Entry with price but no date → skipped.
- Entry marked confidential/no price → skipped.
- Insert failure → profile fetch still succeeds and caches (error logged).
- Same profile fetched twice → idempotent (dedup key absorbs).
**Verification:** fetching a known multi-sale property's profile inserts its history rows; profile API behaviour unchanged.

### U4. After-report and consumer sanity check

**Goal:** Prove the gain and confirm consumers behave with denser history.
**Requirements:** success criteria (coverage gain, consumer correctness).
**Dependencies:** U2, U3.
**Files:** `scripts/report-sold-coverage.mjs` (run), no code changes expected.
**Approach:** Re-run the U1 report; compare. Spot-check `/api/sold-sales`, `/api/comparable-sales`, and the profile SaleHistory UI for a handful of backfilled addresses — comparable-sales reads cached-profile `saleHistory[0]` and sold-sales reads `property_sales`, so both paths should show consistent, deduped results.
**Test scenarios:** Test expectation: none — verification unit; the checks are the U2/U3 scenarios plus manual spot-checks.
**Verification:** ≥2-sale-date coverage materially up from baseline; beds/baths coverage up; no duplicate-looking entries in the profile timeline UI.

---

## Open Questions

- Exact abotapi input schema for address-level lookup (vs suburb search) — execution-time discovery in the U2 smoke run.
- Whether the actor's history events carry beds/baths per-event or per-property — affects U2 mapping detail only.
- Apify spend cap: the account has a known spend cap (memory: daily scrape blocked by it once) — confirm headroom before the full run.

---

## Sources & Research

- Repo: `src/lib/jobs/ingest-vg-data.ts`, `src/lib/jobs/fetch-profile.ts`, `src/lib/extraction/merger.ts`, `src/lib/db/queries.ts:931`, `scripts/ingest-rea-apify.mjs`, `src/lib/db/schema.sql:155-186`.
- External: [abotapi/realestate-au-scraper](https://apify.com/abotapi/realestate-au-scraper) (~$1.50/1k + history-event fee), [Domain properties/{id} history.sales](https://developer.domain.com.au/docs/v1/apis/pkg_properties_locations/references/properties_get/) (partner tier), [Pricefinder API](https://www.pricefinder.com.au/api/) (quote), [OnTheHouse ToS scraping ban](https://www.onthehouse.com.au/terms-of-use), LANDATA per-property history reports (paid).
- Prior plan: `docs/plans/2026-07-15-001-feat-vic-property-sales-history-plan.md` (implemented — VG path).
