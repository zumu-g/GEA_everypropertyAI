---
title: "feat: Vacant-land detection and land-aware estimates"
date: 2026-07-20
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Vacant-land detection and land-aware estimates

## Summary

Vacant blocks of land (e.g. 24 Mary St, Bunyip) currently get house-priced estimates because the estimator's `typeBucket()` only knows `unit | house | unknown` — a land subject buckets to `unknown`, passes every prefilter, and is priced off house comparables. Conversely, land sales pollute house estimates. This plan adds a `land` type bucket classified from explicit property-type strings across all feeds, makes the sale estimator land-aware in both directions, suppresses the meaningless rent estimate for land, and labels the property as vacant land in the UI.

**Product Contract preservation:** solo plan (no upstream brainstorm). Scope confirmed with user 2026-07-20: explicit type strings only (no attribute-absence heuristic), rent panel suppressed for land, both subject-side and comp-side filtering.

---

## Problem Frame

- **R1** — A property whose data identifies it as vacant land must be estimated from land comparables only, never dwellings.
- **R2** — Dwelling estimates must exclude vacant-land sales from their comparable pool.
- **R3** — Land classification comes from explicit property-type strings only. Attribute absence (no beds/baths/building area) is NOT a land signal — VG sold records routinely lack attributes for real houses.
- **R4** — No weekly-rent estimate is shown for vacant land.
- **R5** — The property page identifies the property as vacant land.
- **R6** — When too few land comps exist, the estimate degrades honestly (low confidence + explanation) rather than silently falling back to house/suburb medians.

**Out of scope:** development-potential/rezoning valuation; per-m² land-rate modelling beyond the existing comparables machinery; backfilling or re-normalising stored `property_type` values; rural/acreage/farm as a distinct bucket (see Deferred).

---

## Evidence (2026-07-20 DB sample)

Distinct `property_type` values carrying a land signal:

- `property_sales`: `Vacant land` (492), `VacantLand` (44), `land` (3), `New land` (3), `Development Site` (1)
- `property_listings`: `Vacant land` (116), `VacantLand` (97), `residential land` (210), `residentialLand` (116), `New land` (16), `NewLand` (14)
- Trap: `New House & Land` (81) / `NewHouseLand` (199) are house-and-land packages — houses, not land.
- Rural family (`AcreageSemiRural`, `Rural`, `Farm`, `lifestyle`, `cropping`…) usually has a dwelling — stays `unknown` for now.

Values are free text end-to-end; only the LLM extraction path constrains to an enum that already includes `land` (`src/lib/extraction/schemas.ts:59-62`).

---

## Key Technical Decisions

- **KTD1 — One classification helper, string-based.** `isVacantLandType(propertyType)` beside `typeBucket` in `src/lib/estimation/comparables-estimator.ts` (or a small shared module) matching: contains `vacant`, OR contains `land` without `house` (covers `residential land`, `residentialLand`, `New land`, bare `land`; excludes `New House & Land`/`NewHouseLand`), OR `development site`. Case-insensitive on the same lowercased input `typeBucket` already uses. camelCase variants like `residentialLand`/`NewLand` lowercase to substrings containing `land` and are covered.
- **KTD2 — Extend `typeBucket` to `'land'`.** Check order: unit → house → land → unknown, so house-and-land packages resolve `house` before the land check runs. Existing `unknown` semantics unchanged for everything else — no behaviour change for rural/commercial.
- **KTD3 — Hard exclusion falls out of existing prefilters.** `passesPrefilter` (`src/lib/estimation/estimate-service.ts:68-76`) already hard-excludes when both buckets are known and differ; adding the `land` bucket makes land↔house exclusion automatic in both directions (R1 + R2). Same for the rental prefilter.
- **KTD4 — Land estimates weight land area heavily.** In `similarityWeight` (`src/lib/estimation/comparables-estimator.ts:126-160`), when the subject bucket is `land`, land-area similarity is the dominant factor (beds/baths factors are meaningless and default to 1.0 anyway since land has none).
- **KTD5 — No house-median fallback for land (R6).** The legacy suburb-median cascade prices from house/unit medians. For a land subject with fewer than `MIN_COMPS` land comps, return the fallback with confidence floored to low and a methodology note ("insufficient vacant-land sales nearby; suburb dwelling medians are not representative of land value") rather than presenting a confident house-derived figure. This mirrors the existing attribute-gap penalty pattern in `estimate-service.ts`.
- **KTD6 — Rent suppression at the service boundary (R4).** `getRentEstimate` path returns null for land subjects; the UI additionally guards so neither the comparables rent panel nor the yield-derived fallback panel renders for land.

---

## Implementation Units

### U1. Land classification + `land` type bucket

**Goal:** Classify vacant land from explicit type strings; `typeBucket` returns `'land'`.
**Requirements:** R3, foundations for R1/R2.
**Dependencies:** none.
**Files:** `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/__tests__/comparables-estimator.test.ts` (extend existing test file if present, else create).
**Approach:** Add `LAND_TYPES` matching per KTD1; extend the `TypeBucket` union and `typeBucket()` per KTD2 (order: unit → house → land). Export `isVacantLandType` for UI/service use.
**Test scenarios:**
- `typeBucket('Vacant land') === 'land'`; same for `VacantLand`, `residential land`, `residentialLand`, `New land`, `NewLand`, `land`, `Development Site`.
- Covers the package trap: `typeBucket('New House & Land') === 'house'`; `NewHouseLand` → `house`.
- Unchanged: `House`→house, `ApartmentUnitFlat`→unit, `AcreageSemiRural`→unknown, `Rural`→unknown, null/''→unknown.
- `isVacantLandType(undefined) === false`.

### U2. Land-aware sale estimate

**Goal:** Land subjects price from land comps only; house subjects exclude land comps; honest degradation when land comps are sparse.
**Requirements:** R1, R2, R6.
**Dependencies:** U1.
**Files:** `src/lib/estimation/estimate-service.ts`, `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/__tests__/estimate-service.test.ts`.
**Approach:** Prefilter exclusion is automatic once the bucket exists (KTD3) — verify, don't reimplement. In `similarityWeight`, apply KTD4 land-area dominance when subject bucket is `land`. In the legacy-fallback branch of `getEstimate`, apply KTD5: land subject → confidence floored (≤ low band), methodology note appended. Methodology string for the comps path should say "comparable vacant-land sales".
**Test scenarios:**
- Land subject + mixed comp pool → only land comps survive prefilter (house comp with beds is excluded).
- House subject + pool containing `Vacant land` comps → land comps excluded (regression: previously included with weight 0.85).
- Land subject with ≥3 land comps → estimate returned, methodology mentions vacant-land sales.
- Land subject with <MIN_COMPS land comps → fallback result has `confidenceLevel === 'low'` and the KTD5 note; never a silent house-median figure.
- Unknown-type subject behaviour unchanged (no new exclusions).

### U3. Suppress rent estimate for land

**Goal:** No weekly-rent panel for vacant land.
**Requirements:** R4.
**Dependencies:** U1.
**Files:** `src/lib/estimation/estimate-rental-service.ts`, `src/components/property/PropertyProfile.tsx`, `src/lib/estimation/__tests__/estimate-rental-service.test.ts`.
**Approach:** Early-return null in the rental service when `typeBucket(subject.propertyType) === 'land'`. In `PropertyProfile.tsx`, gate both the comparables rent panel and the yield-derived fallback panel (the `midRent` block near line 1150) on not-land.
**Test scenarios:**
- Rental service returns null for a `Vacant land` subject even with rental comps nearby.
- Non-land subjects unchanged (house subject still gets a rent estimate).
- Component-level: land profile renders no `/pw` text (extend existing PropertyProfile fetch tests' fixtures with a land property).

### U4. UI: vacant-land identity

**Goal:** The page reads as a land listing, not a broken house.
**Requirements:** R5.
**Dependencies:** U1.
**Files:** `src/components/property/PropertyProfile.tsx`.
**Approach:** Where the header derives `propertyType` (~line 653) show "Vacant land" (via `isVacantLandType`) as the type label. Suppress the dwelling-attribute nudge ("add bedrooms…", added 2026-07-17) for land subjects — beds/baths are not missing data on a block of land; keep the land-area stat editable. The estimate-panel title/methodology already communicates land basis via U2.
**Execution note:** cosmetic unit; verify by rendering a land profile locally rather than exhaustive unit coverage.
**Test scenarios:** Test expectation: light — one render assertion that a land profile shows the "Vacant land" label and no beds-nudge (piggyback on U3's fixture).

---

## Verification Contract

- All new/changed behaviour covered by the unit tests above; `npx vitest run src/lib/estimation` green; `npx tsc --noEmit` clean.
- Manual: 24 Mary St, Bunyip renders as Vacant land with a land-comps (or low-confidence) estimate and no rent panel; a known house (8 Sunnyside Dr, Berwick) shows an unchanged sane estimate.
- Regression watch: Berwick/Pakenham house estimates should not move materially except where land sales were previously polluting the pool (movement there is the fix working).

## Definition of Done

R1–R6 demonstrably hold on production data for the Bunyip test case and one house control case; tests green; deployed.

---

## Risks & Deferred

- **Risk:** free-text drift — new feeds may emit unseen land spellings. Mitigation: substring rules (KTD1) rather than exact match; the evidence list above is the fixture set.
- **Risk:** house-and-land packages listed as `Vacant land` by agents (mislabelled source data) — accepted; source data wins.
- **Deferred:** rural/acreage/farm bucket (often has a dwelling; needs its own comp semantics). Deferred: attribute-absence heuristic (rejected for now per R3 rationale). Deferred: normalising `property_type` at ingest into a controlled vocabulary (bigger change; classification-at-read covers current need). Deferred: legacy `price-estimator.ts:73` exact-match unit list diverges from `typeBucket` — worth unifying, separate cleanup.

## Sources & Research

- DB `property_type` distinct-value sample, 2026-07-20 (both tables, service-role query).
- Code map: `typeBucket` consumers (`comparables-estimator.ts:96-160`, `estimate-service.ts:68-76`, `estimate-rental-service.ts:60,104`, `rental-comparables-estimator.ts:104-111`); ingest paths write free text (Domain mapper `src/lib/ingest/domain-mapper.ts:195`, VG `src/lib/jobs/ingest-vg-data.ts`, LLM enum `src/lib/extraction/schemas.ts:59-62`).
