---
title: "feat: QuadrantChart on the property page, wired to real segment data"
date: 2026-07-13
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_depth: standard
---

# feat: QuadrantChart on the property page, wired to real segment data

**Target repo:** `propertyiq` (this repo)

## Summary

Embed `QuadrantChart` (`src/components/property/QuadrantChart.tsx`, shipped 2026-07-13 as a standalone `/quadrant` demo) as a section on the property detail page, and derive its four market segments from real suburb sold-sales data instead of hardcoded Berwick defaults. Segments shift to match the subject property's own type/size (e.g. a unit subject compares against 1-4 bed units/houses; a house subject compares against 3/4/5+ bed houses plus units). Persisting edits or the selected "most similar" segment stays out of scope — no backend target exists for it yet.

Product Contract preservation: no upstream brainstorm — direct planning from the user's brief (`ce-plan-bootstrap`). Origin plan: `docs/plans/2026-07-13-001-feat-quadrant-chart-plan.md` (its Scope Boundaries deferred both items this plan now picks up).

---

## Problem Frame

The chart component exists and works, but sits in isolation at `/quadrant` with made-up numbers — it delivers no value to an agent using the actual product. Two things block that: (1) it isn't rendered anywhere on the property page agents actually work from, and (2) even if it were, its segments are fixed defaults, not reflective of the subject property or its suburb. Real segment data (low/avg/median sale price per bedroom-count/type bucket) already exists in the `property_sales` table and is reachable via `getSalesForSuburb` (`src/lib/db/queries.ts`) — the same source `/api/sold-sales` and `ComparableSales` already draw from.

---

## Requirements

- **R1** — `QuadrantChart` renders as a section on the property detail page (`src/components/property/PropertyProfile.tsx`), positioned near the other market-context sections (Comparable Sales, On the Market Nearby).
- **R2** — Segments are derived from the subject property's own suburb and type/bedroom count, not fixed defaults. Segment set:
  - Subject is a **house** (or type unknown): 3-bed, 4-bed, 5+-bed houses, plus a Units/townhouses segment.
  - Subject is a **unit/townhouse**: 1-bed unit, 2-bed unit, 3-bed house, 4-bed house (shifted down one notch, per the original brief's "if a 2 bed unit, quadrants will change to 1 bed unit, 2 bed unit, 3 bed house, 4 bed house").
- **R3** — Each segment's low/average/median is computed from `property_sales` rows in the subject's suburb matching that segment's property-type/bedroom bucket, within a bounded recency window (mirroring `/api/sold-sales`'s `sinceDays` default of 730 days).
- **R4** — Target address, suburb, and a data-as-at date are passed into the chart's existing `targetAddress`/`suburb`/`dataDate` props — no new props needed on `QuadrantChart` itself. `dataDate` is defined as the most recent sale date used across all 4 segments' aggregation (not "today" — the two read differently whenever the most recent matching sale isn't from today).
- **R5** — A segment with too few comparable sales to be meaningful (threshold: fewer than 3 matching sales) shows a visibly distinct "insufficient data" state for that segment's bar/tile: the low/avg/median figures are hidden (not shown as $0 or blank), replaced with a single muted "Not enough recent sales" label in the same position the prices would occupy. This is a real visual state, not just dimmed real numbers — a viewer must not be able to mistake it for a genuine (low) price.
- **R6** — The section is optional/gracefully absent, but "no usable data" has exactly two triggers, both evaluated client-side in `QuadrantChartSection` (U2): (a) the subject property has no usable suburb (never fetches — same `parsedAddress?.suburb &&` guard used for Comparable Sales), or (b) the fetch itself fails / returns a non-2xx status. A successful response where **all 4 segments** are flagged insufficient (R5) is a different case — see R5a below — and does **not** trigger this guard; the chart still renders.
- **R5a** — When every one of the 4 segments in a successful response is flagged insufficient (the suburb genuinely has no usable recent sales at all), still render the chart with all 4 tiles in the R5 insufficient-data state, rather than hiding the section — the section's presence itself signals "we checked; there's no data," which is more useful than silent absence. (Per KTD4, the API response is never an empty array — it always returns exactly 4 segment entries, some or all of which may be flagged insufficient — so "empty response" is not a state `QuadrantChartSection` needs to handle separately from R6(b)'s fetch-failure case.)
- **R7** — `QuadrantChart.tsx`'s `QuadrantSegment` interface (currently `{ name, low, avg, median, icon? }`) gains one addition: an optional `sufficientData?: boolean` field (default true when absent, for the standalone `/quadrant` demo's hardcoded segments). When `false`, the component renders the R5 insufficient-data state for that tile instead of its price figures. This is a minimal, additive change — no other change to the component's existing rendering, editing, or selection behavior.
- **R8** — Persisting the user's inline edits or "most similar" selection remains explicitly out of scope (`QuadrantChart`'s `onChange` stays an unconsumed seam, same as the original plan).

---

## Key Technical Decisions

- **KTD1 — New API route, not a direct DB call from the client component.** `QuadrantChart`'s host section is a `"use client"` component (`PropertyProfile.tsx` is client-rendered); follow the existing `ComparableSales` pattern (self-fetching child component hitting an API route) rather than a server component wrapper, for consistency with the rest of the page and to keep `PropertyProfile.tsx`'s already-large render tree from growing another server/client boundary.
- **KTD2 — Route: `GET /api/market-segments`.** Query params mirror `/api/sold-sales`: `suburb` (required), `state` (default VIC), `propertyType`/`bedrooms` of the subject (to pick the segment set per R2), `sinceDays` (default 730). Reuses `getSalesForSuburb` from `src/lib/db/queries.ts` — no new DB query function needed, just a new route that buckets and aggregates its results. As a public data route parallel to `/api/sold-sales` and `/api/comparable-sales`, it must be added to the `config.matcher` array in `src/middleware.ts` so the same `EVERYPROPERTY_API_KEYS` gate (`apiKeyGate`) applies to non-same-origin callers — every sibling public route is already covered there and this one would otherwise be the sole ungated exception.
- **KTD3 — Bucketing logic lives server-side in the new route,** not in `QuadrantChart` (which stays segment-agnostic per the original plan's KTD4) and not duplicated in a client util. Bucket by `property_type` (unit/townhouse vs house, from `PropertySaleRecord.property_type`) and `bedrooms`; house-subject buckets are exact bedroom counts (3, 4, 5+) plus one units/townhouses bucket; unit-subject buckets are 1-bed unit, 2-bed unit, 3-bed house, 4-bed house.
- **KTD4 — Aggregation: low = min, avg = mean, median = p50 of `sale_price`** within each bucket, all rounded to the nearest thousand (matching the chart's `formatCurrency` which already rounds to whole dollars — no fractional-dollar noise). Segments below the 3-sale threshold (R5) still report a bucket entry (so the segment position/label stays present) but flagged insufficient rather than omitted, so the chart never renders with fewer than 4 segments.
- **KTD5 — New component `QuadrantChartSection`** (`src/components/property/QuadrantChartSection.tsx`) — the self-fetching wrapper (KTD1), analogous to `ComparableSales`: takes `suburb`, `propertyType`, `bedrooms`, `targetAddress` props, fetches `/api/market-segments`, and renders `<QuadrantChart segments={...} targetAddress={...} suburb={...} dataDate={...} />` (loading/error/empty states handled here, not in `QuadrantChart`).
- **KTD6 — `PropertyProfile.tsx` renders `QuadrantChartSection`** guarded the same way as the existing Comparable Sales section (`{parsedAddress?.suburb && (...)}`), positioned directly before or after that section since both are suburb-market-context sections.

---

## Implementation Units

### U1. `/api/market-segments` route

**Goal:** Query, bucket, and aggregate suburb sold-sales into the 4-segment shape `QuadrantChart` expects.

**Requirements:** R2, R3, R5.

**Dependencies:** none.

**Files:**
- `src/app/api/market-segments/route.ts` (new)
- `src/app/api/__tests__/market-segments.test.ts` (new)
- `src/middleware.ts` (modify — add `/api/market-segments` to `config.matcher`, per KTD2)

**Approach:** `GET` handler: parse `suburb`, `state`, `propertyType`, `bedrooms`, `sinceDays` from query params (validate `suburb` required, 400 otherwise — mirror `/api/sold-sales`'s existing validation). Call `getSalesForSuburb` (or the same underlying query `/api/sold-sales` uses) scoped to the suburb/state/window. Determine the segment set (KTD3) from `propertyType`/`bedrooms`. Bucket matching rows into each segment, compute low/avg/median (KTD4), and mark `sufficientData: false` for buckets under 3 rows. Return `{ segments: QuadrantSegment[], dataDate: string }` shaped to match `QuadrantChart`'s existing `QuadrantSegment` interface (plus the `sufficientData` field from R7). `dataDate` (R4) is the most recent `sale_date` across all rows used in aggregation, formatted consistently with how the rest of the codebase renders dates (see `formatDate` helpers in sibling components). CORS/cache headers follow `/api/comparable-sales/route.ts`'s convention (`PUBLIC_GET_CACHE_HEADERS`) — note `/api/sold-sales/route.ts` itself does not currently set cache headers despite superficially similar CORS setup, so use `/api/comparable-sales` as the header pattern specifically, not `/api/sold-sales`.

**Patterns to follow:** `src/app/api/sold-sales/route.ts` (query-param parsing, `getSalesForSuburb` usage); `src/app/api/comparable-sales/route.ts` (per-property-context aggregation shape, `PUBLIC_GET_CACHE_HEADERS` usage); `src/middleware.ts`'s existing `config.matcher` entries for `/api/comparable-sales`, `/api/sold-sales`.

**Test scenarios:**
- Given a suburb with sales across all 4 house-segment buckets, returns 4 segments with correct low/avg/median per bucket.
- Given `propertyType=unit`/`bedrooms=2`, returns the shifted unit segment set (1-bed unit, 2-bed unit, 3-bed house, 4-bed house).
- A bucket with fewer than 3 matching sales is returned with `sufficientData: false` rather than omitted or zeroed.
- Missing `suburb` param returns 400.
- No sales at all for the suburb/window returns exactly 4 segment entries, all flagged `sufficientData: false` — never an empty array or error.
- `sinceDays` window is honored — a sale older than the window is excluded from aggregation.
- `dataDate` reflects the most recent `sale_date` among rows actually used in aggregation, not the request time.

**Verification:** Route tests pass; manual `curl` against a known-populated suburb returns plausible, correctly-bucketed figures.

### U2. `QuadrantChartSection` component

**Goal:** Self-fetching wrapper connecting the property page to U1's data and the existing `QuadrantChart`.

**Requirements:** R1, R4, R5a, R6, R7.

**Dependencies:** U1.

**Files:**
- `src/components/property/QuadrantChartSection.tsx` (new)
- `src/components/property/__tests__/QuadrantChartSection.test.tsx` (new)
- `src/components/property/QuadrantChart.tsx` (modify — add `sufficientData?: boolean` to `QuadrantSegment` (R7) and the insufficient-data tile render (R5): hide the low/avg/median figures and show a muted "Not enough recent sales" label in their place)
- `src/components/property/__tests__/QuadrantChart.test.tsx` (modify — add a test scenario for the insufficient-data render state)

**Approach:** Client component taking `suburb`, `propertyType?`, `bedrooms?`, `targetAddress` props. On mount, fetch `/api/market-segments` with those params. Loading state: lightweight skeleton (reuse `src/components/ui/Skeleton.tsx`, matching `ComparableSales`'s loading treatment). Render-nothing (R6) triggers **only** on fetch failure or a non-2xx response — this is a supplementary market-context section, not a critical path, so no error banner. Any successful 2xx response renders `<QuadrantChart segments={...} targetAddress={targetAddress} suburb={suburb} dataDate={...} />` regardless of how many segments are flagged insufficient (R5a) — per KTD4 the response always has exactly 4 segment entries, so there is no separate "empty array" case to special-case. Thread `sufficientData` per segment through to `QuadrantChart` per the minimal prop R7 requires.

**Patterns to follow:** `ComparableSales.tsx`'s `useEffect`+`fetch` self-loading pattern for the loading/fetch-failure branching only — its "no results" branch does not apply here, since U1 never returns zero segments.

**Test scenarios:**
- Renders `QuadrantChart` with the segments returned by a mocked successful fetch.
- Shows a loading skeleton while the fetch is in flight.
- Renders nothing (no chart, no error UI) when the fetch fails (network error or non-2xx).
- Renders the chart (not nothing) when the fetch succeeds but all 4 segments are flagged `sufficientData: false` — covers R5a; each tile shows the insufficient-data state (R5), not a hidden section.
- Passes `targetAddress`/`suburb`/`dataDate` through correctly to `QuadrantChart`.

**Verification:** Tests pass; component renders correctly in isolation with a mocked fetch.

### U3. Wire into `PropertyProfile.tsx`

**Goal:** Add the section to the actual property page.

**Requirements:** R1, R6.

**Dependencies:** U2.

**Files:**
- `src/components/property/PropertyProfile.tsx` (modify)

**Approach:** Add a new `<section>` rendering `<QuadrantChartSection suburb={parsedAddress.suburb} propertyType={...} bedrooms={...} targetAddress={displayAddress} />`, guarded by `{parsedAddress?.suburb && (...)}` (KTD6), positioned adjacent to the existing Comparable Sales section. Pull `propertyType`/`bedrooms` from the same `d.propertyType`/`d.bedrooms` fields `ComparableSales` already reads a few lines above.

**Test scenarios:** Test expectation: none — thin wiring; behavior is covered by U1/U2's own tests. A single smoke check that the section appears in `PropertyProfile`'s render output when suburb data is present is reasonable if `PropertyProfile` already has render-level tests to extend (check `PropertyProfile.fetch.test.tsx` for a natural extension point); otherwise skip rather than inventing new test infrastructure for a thin wiring change.

**Verification:** Property page renders the new section for a property with a known suburb; section is absent for a property with no suburb data.

---

## Scope Boundaries

### In scope
R1–R8 as specified above.

### Deferred to Follow-Up Work
- Persisting edited segment values or the selected "most similar" quadrant (R8) — no backend target exists; `onChange` stays an unconsumed seam on `QuadrantChart`, same as the original plan.
- Caching/memoizing `/api/market-segments` responses beyond the existing `PUBLIC_GET_CACHE_HEADERS` convention — not addressed unless load testing shows it's needed.

### Out of scope
- Changes to `QuadrantChart.tsx`'s visual design (radial chart, mobile fallback, etc.) beyond the additive `sufficientData` prop and its tile state (R7) — already shipped and out of this plan's scope otherwise.
- Non-VIC suburb support beyond what `getSalesForSuburb`/`/api/sold-sales` already handle.

---

## Open Questions / Assumptions

- **Assumption:** the subject property's own segment (e.g. its own bedroom count) is included as one of the 4 comparison buckets rather than excluded — matches the original brief's examples ("this quadrant is most similar to yours" implies the subject's own bucket is one of the four, not a 5th hidden category).
- **Assumption:** "recency window" defaults to 730 days (matching `/api/sold-sales`), not tied to any user-configurable control in this pass.
- **Open:** exact insufficient-data threshold (3 sales) is a starting judgment call, not derived from a stated product requirement — adjust during implementation if the real data distribution makes 3 too strict/loose for common suburbs.

## Definition of Done

All requirements R1–R8 met; U1/U2 test scenarios pass under `npm run test`; `npm run build` clean; the section renders on a real property page with plausible segment figures (manual verification against a known-data suburb, e.g. Berwick).
