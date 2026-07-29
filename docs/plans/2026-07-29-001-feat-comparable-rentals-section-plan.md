---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "feat: Comparable Rentals section on the property page"
date: 2026-07-29
depth: lightweight
---

# feat: Comparable Rentals section on the property page

## Summary

Add a "Comparable Rentals" card-grid section to the property page, visually identical to the existing Comparable Sales section (photo, address, weekly rent, as-of date, match badge, attribute chips). It surfaces the weighted rental comparables that `/api/estimate-rent` already computes — no new endpoint, and the cards shown are the top-weighted comps behind the displayed rent estimate (top 4 by weight).

## Problem Frame

The rent estimate on the property page is a bare number with no visible evidence. The sale estimate has a Comparable Sales grid; rentals have nothing. Users (agents preparing proposals/CMAs) need to see which nearby rentals justify the weekly-rent range.

## Requirements

- **R1** — A "Comparable Rentals" section renders below Comparable Sales on the property page, using the same card grid: photo (placeholder when absent), address, weekly rent (e.g. "$620/wk"), date, match badge, bed/bath/land chips.
- **R2** — The comps displayed are the `comparablesUsed` from the page's existing `/api/estimate-rent` response (top 4 by weight), so evidence matches the estimate.
- **R3** — Cards link to each comparable's own property page (same `comparableHref` behaviour as Comparable Sales).
- **R4** — When there is no rental estimate or no comps (e.g. vacant-land subjects, where `getRentalEstimate` returns null by design, or suburb-median fallback with no `comparablesUsed`), the section is hidden entirely — no empty-state card.

## Key Technical Decisions

- **KTD1 — Reuse estimate-rent comps, no new endpoint** (user-confirmed). `PropertyProfile.tsx` already calls `/api/estimate-rent`; its result (`RentalEstimateResult`) carries `comparablesUsed: WeightedRentalComp[]`. Pass those into the new component as props. Rejected alternative: a `/api/comparable-rentals` route mirroring `/api/comparable-sales` — more code, second fetch, and comps could disagree with the shown estimate.
- **KTD2 — Carry `imageUrl` through the estimator types.** `property_rentals.image_url` exists on `PropertyRentalRecord` but `toComparable` in `estimate-rental-service.ts` drops it. Add optional `imageUrl` to `RentalComparable` and map it. Pure passthrough — no weighting change.
- **KTD3 — Match badge from normalised weight.** `WeightedRentalComp.weight` is a raw similarity weight in (0, 1]. Display `Math.round((comp.weight / topWeight) * 100)`% (top comp = 100% match), mirroring how the mock reads. Reuse the existing `SimilarityBadge` colour thresholds semantics by keeping the same component shape (export or duplicate the small badge locally — prefer extracting it if trivial).
- **KTD4 — State plumbing.** `PropertyProfile` currently stores the rent result as `PriceEstimateResult` (no comps field). Widen the stored type (or store `comparablesUsed` alongside) so the section can read comps. The client-side legacy fallback (`calculateEnrichedPriceEstimate`) yields no comps → section hides (R4).

## Implementation Units

### U1. Carry imageUrl into rental comparables

**Goal:** Rental comps include a photo URL end-to-end.
**Requirements:** R1 (photos)
**Dependencies:** none
**Files:** `src/lib/estimation/rental-comparables-estimator.ts` (add `imageUrl?: string | null` to `RentalComparable`), `src/lib/estimation/estimate-rental-service.ts` (map `r.image_url` in `toComparable`), `src/lib/estimation/__tests__/estimate-rental-service.test.ts`
**Approach:** Optional field, passthrough only; the estimator ignores it for weighting.
**Test scenarios:**
- A comp built from a record with `image_url` set → `comparablesUsed[n].imageUrl` equals it.
- A record without `image_url` → `imageUrl` undefined/null; estimate output otherwise unchanged (existing tests stay green).

### U2. ComparableRentals component

**Goal:** The card grid, mirroring `ComparableSales.tsx`.
**Requirements:** R1, R2, R3, R4
**Dependencies:** U1
**Files:** `src/components/property/ComparableRentals.tsx` (new), `src/components/property/__tests__/ComparableRentals.test.tsx` (new)
**Approach:** Props-driven (no fetch): `comps: WeightedRentalComp[]`. Sort by weight desc, take 4, compute match % per KTD3. Card layout, `comparableHref`, photo/placeholder, and chip styling copied from `ComparableSales.tsx`; price line renders `$X/wk` (`weeklyRent`, no cents) and date from `asOf`. Returns null when fewer than 1 comp. Follow DESIGN.md tokens already used in the sibling component.
**Patterns to follow:** `src/components/property/ComparableSales.tsx` (card, badge, href builder, empty handling), `src/components/property/__tests__/ComparableSales.test.tsx` (test style).
**Test scenarios:**
- Renders max 4 cards sorted by weight; top comp shows "100% match".
- Rent renders as `$620/wk` formatted with en-AU digits; `asOf` renders as a readable date.
- Comp without image renders the placeholder block, not a broken `next/image`.
- Card href resolves to `/property?address=` with the comp's suburb (reuse the ComparableSales link assertions).
- Empty comps array → renders nothing.

### U3. Wire into PropertyProfile

**Goal:** Section appears below Comparable Sales when rental comps exist.
**Requirements:** R2, R4
**Dependencies:** U2
**Files:** `src/components/property/PropertyProfile.tsx`, `src/components/property/__tests__/PropertyProfile.fetch.test.tsx`
**Approach:** In `fetchEstimates`, keep the full estimate-rent result (widen state per KTD4) so `comparablesUsed` survives. Render `<section><SectionTitle icon={Scale} title="Comparable Rentals" /><ComparableRentals … /></section>` directly after the Comparable Sales section, gated on `comparablesUsed?.length > 0`.
**Test scenarios:**
- Mocked `/api/estimate-rent` returning `comparablesUsed` → "Comparable Rentals" heading and cards render after "Comparable Sales".
- Response with `result: null` or fallback result without comps → section absent.
- Client-side fallback path (estimate-rent fetch fails) → section absent, no crash.

## Scope Boundaries

**In scope:** the property-page section only.

### Deferred to Follow-Up Work
- A standalone `/api/comparable-rentals` endpoint for external consumers (proposal CLI, reports) — build only when a consumer needs it.
- Rental comps in the PDF property report.

**Non-goals:** changing rental weighting/estimation logic; leased (historical bond) data — comps are asking-rent listings from `property_rentals`.

## Verification Contract

- `npx vitest run` green, including the three new/extended test files.
- `npx tsc --noEmit` clean.
- Manual: load a Berwick house property page → Comparable Rentals grid renders below Comparable Sales with rents matching the displayed weekly-rent range's comps; load a vacant-land property (43 Bellagio Rd) → section absent.

## Definition of Done

All three units landed, verification contract passes, and the section visually matches the Comparable Sales grid per the supplied mock (photo-top cards, match badges, attribute chips).
