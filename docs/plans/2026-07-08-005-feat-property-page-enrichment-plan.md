---
title: "feat: Property page — track-row stats, at-a-glance, map, comps/on-market images"
status: active
date: 2026-07-08
type: feat
depth: standard
---

# feat: Property page — track-row stats, at-a-glance, map, comps/on-market images

## Summary

Five additions to the property profile page: (1) beds/baths/cars/land/house-size stats plus an "On market" tag on the same row as the Track button; (2) a "Property at a glance" prose section; (3) a discrete (muted, non-colourful) Mapbox static map of the property and land; (4) images on comparable-sale cards; (5) a new nearby on-market listings section with images, separate from comparables. Nearby childcare already exists as a section (renders when the Overpass lookup returns centres) — no change needed.

## Requirements

- R1. The Track button row also shows beds, baths, cars, land size, and house size (building area), plus an "On market" tag when the property's listing status is active/for-sale.
- R2. A "Property at a glance" section describes the property in prose — composed from attributes, using the listing description when available.
- R3. A map of the property location renders on the page, visually discrete (muted/greyscale, not saturated colour), using the existing Mapbox account. Token stays server-side via a proxy route.
- R4. Comparable-sale cards show a property image when one is available.
- R5. A separate "On the market nearby" section lists current for-sale properties with images, price, and attributes.
- R6. Existing sections (childcare, schools, sales history) are unaffected.

## Key Technical Decisions

- **Map = Mapbox Static Images API via a same-origin proxy** (`src/app/api/map-static/route.ts`). `MAPBOX_ACCESS_TOKEN` is server-side only; a proxy keeps it that way. Style `light-v11` with a single steel-accent marker is already muted — satisfies "discrete, not in colour" without custom styling. Zoom ~16.5 shows the lot and surrounds.
- **Comps images from existing data** — cached-profile comparables carry `photos[]` in `raw_data`; surface `photos[0]` as `imageUrl` in `/api/comparable-sales`. `property_sales`-sourced comps use their `image_url` where the supplement query exposes it; otherwise the card falls back to the current no-image layout.
- **On-market section reuses `GET /api/on-market-listings`** (already returns `imageUrl`, `displayPrice`, beds/baths, `listingUrl`) queried by the profile's lat/lng with a small radius — no new backend.
- **At-a-glance is composed client-side** from profile attributes (type, beds/baths/cars, land/building area, year built, suburb) with `d.description` folded in when present — no LLM call, no new endpoint.

## Implementation Units

### U1. Track-row stats + on-market tag
**Files:** `src/components/property/PropertyProfile.tsx`
Merge the existing quick-stats strip into the Track button row (one flex row, wrapping on mobile); add a building-area stat (`d.buildingArea`/`buildingAreaSqm`) alongside land; render an "On market" pill when `d.listingStatus` is active/for-sale (reuse the hero badge logic).
**Test expectation:** existing PropertyProfile tests keep passing; visual check.

### U2. Property at a glance
**Files:** `src/components/property/PropertyProfile.tsx`
New section near the top composing a readable summary sentence/paragraph from attributes + `d.description` (existing description block folds into this section).
**Test expectation:** none — presentational composition.

### U3. Discrete property map
**Files:** `src/app/api/map-static/route.ts` (new), `src/components/property/PropertyProfile.tsx`
Proxy route: `?lat&lng[&zoom]` → fetches Mapbox Static Image (light-v11, marker), streams back with long cache headers; 400 on missing params, 502 on upstream failure. Render in a new "Location" section when profile lat/lng exist.
**Tests:** route unit test — 400 without lat/lng; happy path proxies upstream (mock fetch) with token appended and returns image content-type.

### U4. Images on comparable sales
**Files:** `src/app/api/comparable-sales/route.ts`, `src/components/property/ComparableSales.tsx`
Add `imageUrl` to `ComparableResult` (photos[0] from cached-profile raw_data; property_sales `image_url` when present). Card shows a thumbnail (next/image) with graceful no-image fallback.
**Tests:** route test asserting `imageUrl` surfaces from raw_data photos; card renders with and without image.

### U5. On the market nearby section
**Files:** `src/components/property/OnMarketNearby.tsx` (new), `src/components/property/PropertyProfile.tsx`
Client component fetching `/api/on-market-listings?lat&lng&radius=2&limit=6`; image cards (photo, display price, beds/baths/cars, address, link to listing). Renders below Comparable Sales as its own section; hides when empty.
**Tests:** renders cards from mocked response; hides on empty; link targets listingUrl.

## Scope Boundaries

**Non-goals:** parcel-boundary overlays (no cadastre data source wired), childcare changes (section exists), interactive/pannable map (static image only for now).

## Risks

- Comps sourced from `property_sales` may lack images → fallback layout, not a blocker.
- Overpass-based childcare can be empty for some addresses — pre-existing behaviour, unchanged.
