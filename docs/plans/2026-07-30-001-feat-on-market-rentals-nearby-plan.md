---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
date: 2026-07-30
---

# feat: On the Market Rentals section on property profile

## Summary

Add an "On the Market Rentals" section to the property profile page, same card format and behaviour as the existing "On the Market Nearby" (for-sale) section, backed by the already-live `/api/rental-listings` endpoint in lat/lng radius mode.

## Problem Frame

The profile page shows current for-sale listings nearby (`OnMarketNearby`) but nothing for current rental listings, even though `/api/rental-listings` already returns geo-filtered rentals from `property_rentals` with the same field shape plus `weeklyRent`. Users assessing a property's rental market see comparable rentals (weighted comps) but not what is actually advertised for rent nearby.

## Requirements

- R1: A new section titled "On the Market Rentals" renders on the property profile directly after "On the Market Nearby", using identical card layout (photo / placeholder, address, price line, bed·bath·car·land meta line, external listing link when present).
- R2: Data comes from `GET /api/rental-listings?lat=&lng=&radius=2&limit=6`, excluding the subject property's address — mirroring `OnMarketNearby`'s fetch behaviour.
- R3: Price line shows the feed's `displayPrice` when present, else `$<weeklyRent>/wk` formatted en-AU; hidden when neither exists.
- R4: The section hides itself entirely (no skeleton, no empty state) when there are no results, on fetch error, or when the property has no coordinates — same as `OnMarketNearby`.

## Key Technical Decisions

- **New sibling component, not a genericised `OnMarketNearby`.** The two differ only in endpoint, title, icon, and price fallback; a props-driven generic would add indirection for two call sites. Clone-and-adjust is the established pattern here (ComparableRentals was cloned from ComparableSales the same way).
- **Reuse the existing endpoint untouched.** `/api/rental-listings` geo mode already filters `active !== false`, applies haversine radius, and returns `{ results }` with all fields the card needs. No API change.
- **Price fallback is rental-specific.** For-sale uses `priceLow/priceHigh` range logic (`listingPrice`); rentals use `displayPrice ?? $X/wk from weeklyRent`. Keep it as a small local helper in the new component.

## Implementation Units

### U1. OnMarketRentalsNearby component + profile wiring

**Goal:** New section component rendering nearby rental listings, wired into the profile page.
**Requirements:** R1-R4
**Dependencies:** none
**Files:**
- `src/components/property/OnMarketRentalsNearby.tsx` (new)
- `src/components/property/PropertyProfile.tsx` (render after `OnMarketNearby`, guarded by the same `latitude`/`longitude` check, passing `excludeAddress={displayAddress}`)
- `src/components/property/__tests__/OnMarketRentalsNearby.test.tsx` (new)

**Approach:** Copy `OnMarketNearby.tsx`; change the fetch URL to `/api/rental-listings`, title to "On the Market Rentals", pick a rental-appropriate lucide icon (e.g. `KeyRound`), and replace `listingPrice` with a `rentalPrice` helper: `displayPrice` when present, else `weeklyRent` formatted as `$1,234/wk` (en-AU, no decimals), else null. Keep the null-render-when-empty behaviour, image optimizer allow-list handling (`isOptimizerBlocked`), and external-link wrapping exactly as in the source component.
**Patterns to follow:** `src/components/property/OnMarketNearby.tsx` (structure), `ComparableRentals.tsx` `fmtRent` (weekly-rent formatting).

**Test scenarios** (`src/components/property/__tests__/OnMarketRentalsNearby.test.tsx`, mirroring `OnMarketNearby.price.test.tsx`):
- Happy path: fetch resolves with two results → section heading "On the Market Rentals" and both addresses render; card with `listingUrl` is an `<a>` with `target="_blank"`.
- Price fallback: `displayPrice: "$550 per week"` renders verbatim; `displayPrice: null, weeklyRent: 550` renders `$550/wk`; both null → no price line.
- Exclude subject: a result whose `rawAddress` case-insensitively equals `excludeAddress` is filtered out.
- Empty/error: empty `results` or rejected fetch → component renders nothing.

**Verification:** `npm test` passes including the new test file; profile page for a property with coordinates in a suburb with rental rows shows the section, and one without rentals shows nothing (no gap, no skeleton).

---

## Scope Boundaries

- Out: any API or DB changes; suburb-mode rentals; rent-range filters UI; PDF report inclusion.
- Deferred to follow-up: adding the section to `property-report` PDF if wanted later.

## Definition of Done

- New section live on the profile page per R1-R4, tests green, no changes to API routes.
