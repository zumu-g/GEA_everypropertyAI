---
title: "fix: /api/property returns empty profiles — seed from our own feed data"
status: completed
date: 2026-06-10
type: fix
---

# fix: /api/property returns empty profiles — seed from our own feed data

## Summary

`POST /api/property` (and the `proposal`/`property` CLI commands that drive the GEA_ST_CMA Property/Rental Information Packs) returns a profile whose `data` contains only `address`, `latitude`, `longitude` with `overallConfidence: 0` — no beds/baths/land/type/price/photos — for addresses we demonstrably hold full data on (e.g. 14 Loders Way Berwick is returned complete by our own `/api/sold-sales`).

**Root cause (diagnosed):** the per-property profile is built **solely from a live multi-source crawl** (`fetchAndCacheProfile` → `crawlProperty`). In production that crawl yields **zero successful extractions** (sources unconfigured/blocked — Apify/Firecrawl/LLM keys, Domain bot-block), so `mergePropertyData([])` produces an empty profile; `seedResolvedAddress` then overlays only the address + geocoded coordinates. There is **no fallback to the structured data we already store** in `property_sales` / `property_listings`, even though those rows carry beds, baths, car spaces, land area, property type, sale/list price and a photo for the exact address.

**The fix:** add a **feed-seed layer** to the profile pipeline. Before deciding the profile is empty, look up the best matching feed row by `address_slug` and populate the profile's attribute fields (with confidence and a `property-feed` source). The live crawl becomes enrichment layered on top, not the sole input. This makes `/api/property` return populated attributes and a non-zero confidence for any address in our feeds, independent of crawl health.

**Contract clarification (answers the polling question):** with `fast: false` the endpoint is **already synchronous** (`runPipelineWithTimeout`, 110s) — there is no background/polling contract to adopt. The emptiness was a crawl-failure masked as a thin profile, not async-by-design. `fast: true` is the only background path. This is documented, not changed.

---

## Problem Frame

Traced through `src/app/api/property/route.ts` → `src/lib/jobs/fetch-profile.ts`:

1. `fast:false` → cache miss → `runPipelineWithTimeout(address, {fast:false, 110s})` → `fetchAndCacheProfile(address)` (synchronous).
2. `doFetchAndCacheProfile`: `crawlProperty` returns no `status:'success'` sources in prod → `extractions = []` → `mergePropertyData([])` → `profile.data = {}`, `profile.sources = []`, `overallConfidence = 0`.
3. `crawlEmpty = sources.length === 0 || Object.keys(data).length === 0` → **true**.
4. `seedResolvedAddress` overlays `address`, `latitude`, `longitude` → `data` now has exactly those 3 keys.
5. `crawlEmpty` → profile **not cached**, returned as `empty`. Route's `empty` check (`sources.length===0 || data keys===0`) is true → `source:'queued'`, confidence 0.

So the profile is "address-only" whenever the crawl fails — and the crawl is failing in prod. The data exists in our DB; the profile path just never consults it.

**Affected:** GEA_ST_CMA Property/Rental Information Packs (Property Details page + cover hero photo), via the `proposal`/`property` CLI → this endpoint. Other endpoints (`/api/sold-sales`, `/api/on-market-listings`, `/api/rental-listings`, `/api/enrich`) are healthy — they read the DB directly; only the profile path depends on the crawl.

---

## Requirements

- **R1** — For an address present in `property_sales` or `property_listings` (or `property_rentals`), `/api/property` returns a profile populated with the feed's attributes (property type, bedrooms, bathrooms, car spaces, land area, price, a photo) and `overallConfidence > 0`, even when the live crawl yields nothing.
- **R2** — The `proposal` CLI command for such an address returns beds/baths/estimate/heroPhotos (it reads this endpoint).
- **R3** — When the live crawl **does** succeed, its richer extracted data still merges in; the feed seed never overwrites higher-confidence crawled values with stale feed values (crawl/extraction wins where present).
- **R4** — A genuinely unknown address (no feed row, no crawl) still returns the address-only profile gracefully (no error, no fabricated data).
- **R5** — No change to the response shape or the auth/CORS behavior of `/api/property`; the `fast:true` background path is unchanged.
- **R6** — The synchronous-vs-background contract is documented so the CMA app knows `fast:false` is a single synchronous call (no polling required).

---

## Key Technical Decisions

- **Seed from feed rows, don't rely solely on the crawl (R1).** The authoritative-enough attributes (beds/baths/land/type/price/photo) already live in `property_sales`/`property_listings`/`property_rentals`. Reading the best matching row by `address_slug` and mapping it into the profile is cheap, always-available, and exactly the data the CMA pack needs. This mirrors how the healthy endpoints already work.
- **Feed seed is a low-tier source; crawl/extraction wins (R3).** Inject the feed values through the same merge surface the crawl uses, registered as a `property-feed` source at a **low confidence tier**, so when a real crawl extraction exists for a field it takes precedence, and the feed only fills gaps. Avoids regressing addresses where the crawl works.
- **Prefer sold, then on-market, then rental for the seed row (R1).** A sold record carries the most complete physical attributes (and now land/beds/baths via prior migrations); fall back to an active listing, then a rental, when no sale exists. Most recent row wins within a category.
- **Re-evaluate "empty" after seeding (R1, R4).** Today `crawlEmpty` is computed before the address seed and gates caching. Introduce a distinct notion: a profile with feed-seeded attributes is **not empty** and should be returned populated (and may be cached). A profile with neither crawl nor feed data stays address-only and uncached (retryable). Keep the route's response-shape semantics intact.
- **Map DB columns → merger field keys precisely (R1, R3).** The profile `data` uses merger keys (`propertyType`, `bedrooms`, `bathrooms`, `carSpaces`, `landArea`, `buildingArea`, `yearBuilt`, `priceNumeric`/`currentPrice`, `agencyName`, `agentName`, photos). The DB columns are `property_type`, `bedrooms`, `bathrooms`, `car_spaces`, `land_area_sqm`, `building_area_sqm`, `year_built`, `sale_price`/`price_low`/`price_high`/`display_price`, `agency_name`, `agent_name`, `image_url`. A single explicit mapping function (pure, tested) owns this translation.

---

## High-Level Technical Design

```
POST /api/property (fast:false)
        │
        ▼
 fetchAndCacheProfile ──► crawlProperty ──► extract ──► mergePropertyData
        │                    (prod: 0 successful → empty merge)
        │
        ├─► NEW: getFeedSeedBySlug(slug)  ──►  property_sales → _listings → _rentals
        │                                       (best row, most recent)
        │
        ├─► NEW: seedFromFeed(profile, row)   map columns→merger keys, low-tier
        │        (gap-fill only; crawl values win)        source 'property-feed'
        │
        ├─► seedResolvedAddress (existing)    address + lat/lng
        │
        ▼
 profile populated (attrs + confidence > 0)  ──► cache + return
```

Decision the seed introduces:

```
crawl yields data?   feed row exists?   →  result
       yes                 any          →  crawl data (+ feed gap-fill), cached, confidence>0
       no                  yes          →  feed-seeded attrs, cached, confidence>0   ◄── the fix
       no                  no           →  address-only, NOT cached (retryable), confidence 0
```

---

## Implementation Units

### U1. Feed-row lookup by address_slug

**Goal:** Fetch the single best feed row (sold → on-market → rental, most recent) for an `address_slug`, exposing the attribute columns the profile seed needs.

**Requirements:** R1

**Dependencies:** none

**Files:**
- `src/lib/db/queries.ts` (modify) — add `getFeedSeedBySlug(slug)` returning a normalised row + which feed it came from, or null
- `src/lib/db/__tests__/queries-feed-seed.test.ts` (new) — or extend an existing queries test

**Approach:** Query `property_sales` by `address_slug` ordered by `sale_date` desc (limit 1); if none, `property_listings` by `last_seen_at`/`created_at` desc; if none, `property_rentals`. Return `{ feed: 'sold'|'on-market'|'rent', row }` with the attribute columns selected (type, beds, baths, car, land_area_sqm, building_area_sqm, year_built, price fields, agency/agent, image_url, lat/lng). Fail-soft (Supabase unconfigured/error → null).

**Test scenarios:**
- Happy path: a slug present in `property_sales` returns `feed:'sold'` with its attributes.
- Precedence: a slug present in both sold and on-market returns the **sold** row.
- Fallback: a slug only in on-market returns `feed:'on-market'`; only in rentals returns `feed:'rent'`.
- Recency: two sold rows for the same slug return the most recent by `sale_date`.
- Miss: an unknown slug returns null (no throw).
- Fail-soft: Supabase unconfigured returns null.

**Verification:** Given 14 Loders Way's slug, the function returns the sold row with beds 5 / baths 2 / land 813 / price 1,200,000.

---

### U2. Seed the profile from the feed row (gap-fill, low tier)

**Goal:** Populate the merged profile's attribute fields from the feed row when the crawl didn't provide them, with confidence and a `property-feed` source, and treat a feed-seeded profile as non-empty.

**Requirements:** R1, R3, R4

**Dependencies:** U1

**Files:**
- `src/lib/jobs/fetch-profile.ts` (modify) — after merge, before/with `seedResolvedAddress`, call the feed seed; recompute emptiness to include feed data; adjust caching
- `src/lib/jobs/feed-seed.ts` (new) — pure `mapFeedRowToProfileFields(row, feed)` → `{ data, fieldConfidences }` keyed by merger field names
- `src/lib/jobs/__tests__/feed-seed.test.ts` (new)
- `src/lib/extraction/merger.ts` or `src/lib/utils/confidence.ts` (reference) — reuse the source-tier/confidence convention for the `property-feed` tier

**Approach:** Pure mapper translates DB columns → merger keys (`property_type`→`propertyType`, `car_spaces`→`carSpaces`, `land_area_sqm`→`landArea`, `building_area_sqm`→`buildingArea`, `year_built`→`yearBuilt`, sold `sale_price`→`priceNumeric`/`currentPrice`, listing `price_low`/`price_high`/`display_price`→price fields, `image_url`→the photo field the proposal CLI reads as `heroPhotos`, `agency_name`/`agent_name`). In `doFetchAndCacheProfile`, only fill a field when the crawl/merge did **not** already set it (gap-fill — crawl wins, R3), assign a low confidence/tier, and register a `property-feed` entry in `sources`. Recompute "empty": a profile carrying feed-seeded attributes is non-empty → cache it and return populated. An address-with-no-feed stays address-only and uncached (R4).

**Execution note:** Start with a failing integration-style test asserting that, with the crawl stubbed to return nothing, a profile for a slug with a feed row comes back populated with `overallConfidence > 0`.

**Patterns to follow:** existing `seedResolvedAddress` (same mutate-profile-after-merge shape); the merger's source-tier/confidence handling in `src/lib/utils/confidence.ts`.

**Test scenarios:**
- Mapper happy path: a sold row maps to `{ propertyType:'House', bedrooms:5, bathrooms:2, carSpaces:2, landArea:813, priceNumeric:1200000, ... }` with a photo.
- Gap-fill / crawl-wins: when `profile.data.bedrooms` is already set by the crawl, the feed's bedrooms does **not** overwrite it (R3).
- Empty crawl + feed row → profile non-empty, `overallConfidence > 0`, `sources` includes `property-feed` (R1).
- No feed row + empty crawl → profile stays address-only, uncached, confidence 0 (R4).
- Listing-only row maps price from `display_price`/`price_low`/`price_high` (not `sale_price`).
- Null/missing columns are omitted, never written as 0/empty-string.

**Verification:** With the crawl yielding nothing, `/api/property` for 14 Loders Way returns beds/baths/land/type/price/photo and confidence > 0; an address absent from all feeds returns address-only gracefully.

---

### U3. Document the contract; verify end-to-end

**Goal:** Record that `fast:false` is synchronous (no polling) and that profiles are now feed-seeded; verify the live path and the CLI.

**Requirements:** R2, R5, R6

**Dependencies:** U2

**Files:**
- `INTEGRATIONS.md` (modify) — note the `/api/property` contract: `fast:false` is a single synchronous call; profiles seed from our feeds so attributes are present for known addresses; `fast:true` is the background/partial path
- (verification only — no code) the `proposal`/`property` CLI in the everypropertyai package

**Approach:** Documentation + verification. Confirm against 14 Loders Way Berwick (sold) and one on-market listing that the endpoint returns populated attributes + confidence, and that the `proposal` CLI then surfaces beds/baths/estimate/heroPhotos.

**Test scenarios:** `Test expectation: none — documentation + manual end-to-end verification (covered by U1/U2 unit tests).`

**Verification:** `INTEGRATIONS.md` states the contract unambiguously; a live `curl` for 14 Loders Way returns populated data + non-zero confidence; the `proposal` CLI shows beds/baths/estimate/heroPhotos.

---

## Scope Boundaries

**In scope:** feed-row lookup; feed-seed of the profile with gap-fill + confidence + source; emptiness/caching adjustment; contract documentation; verification.

**Out of scope (true non-goals):**
- Fixing the live crawl itself (Apify/Firecrawl/LLM keys, Domain bot-block) — the seed makes the endpoint robust regardless; crawl health is a separate concern.
- Changing the response shape, auth, CORS, or the `fast:true` background contract.
- The AVM/estimation work (separate plan).

### Deferred to Follow-Up Work
- **Crawl-health restoration / monitoring** for the per-property profile sources (so enrichment beyond feed data works in prod) — separate investigation, likely env/secret config on Railway.
- **Seeding additional fields** (schools, planning, market context) into the profile from `/api/enrich` data — the CMA pack may want these; out of scope for the empty-profile fix.

---

## Risks & Dependencies

- **Stale feed values masking a good crawl.** Mitigated by gap-fill + low tier (R3): the feed never overwrites a crawled value, only fills gaps.
- **Address-slug mismatch.** The seed keys on `toSlug(address)`; if the feed row's `address_slug` was generated differently, the lookup misses. Mitigated by using the same `toSlug`/`generateSlug` convention the feeds store under; verify with the 14 Loders Way slug (`14-loders-way-berwick-vic-3806`) which both paths produce.
- **Caching a feed-only profile could suppress a later real crawl.** Mitigated by keeping the background/queue crawl able to overwrite the cache with richer data; a feed-seeded cache entry is better than an empty one for the 24h window. (If undesirable, mark feed-only profiles with a shorter TTL — deferred unless verification shows a problem.)
- **Photo field name.** The proposal CLI reads `heroPhotos`; the mapping must target whatever profile field feeds that. Confirm the exact key during U2 (deferred-to-implementation detail) and assert it in the mapper test.

---

## Sources & Research

Codebase grounding (no external research — root cause fully traced locally):
- `src/app/api/property/route.ts` — `fast:false` synchronous pipeline; `empty` → `source:'queued'`; address+geo only.
- `src/lib/jobs/fetch-profile.ts` — `doFetchAndCacheProfile`: empty merge on failed crawl, `crawlEmpty` gate, `seedResolvedAddress` overlay, no DB-seed.
- `src/lib/extraction/merger.ts` — `mergePropertyData`, scalar field keys (`propertyType`, `bedrooms`, `landArea`, `buildingArea`, `priceNumeric`, …) the seed must target.
- `src/lib/db/queries.ts` — feed tables + `address_slug` keying; healthy direct-DB reads the seed mirrors.
- Reproduction: `/api/property` for 14 Loders Way returns `data:{address,latitude,longitude}`, confidence 0, while `/api/sold-sales` returns the same address complete.
