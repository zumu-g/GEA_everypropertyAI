---
title: "feat: school-zone (catchment) enrichment from Victorian DET zone data"
status: active
date: 2026-06-10
type: feat
---

# feat: school-zone (catchment) enrichment from Victorian DET zone data

## Summary

Complete the school-catchment signal **deferred** in plan 002 U3 (`docs/plans/2026-06-10-002-feat-statistical-avm-plan.md`). Resolve a property's lat/lng to the **government school zones it falls within** — a primary catchment and a secondary catchment — and persist them to the `school_zone_primary` / `school_zone_secondary` columns that migration 009 (`src/lib/db/migrations/009_external_features.sql`) already created on `property_features`.

The data is sourced offline from the official Victorian datasets, clipped to Casey + Cardinia, reprojected to WGS84, and bundled as a compact reference file. At enrichment time a **dependency-free point-in-polygon** lookup runs locally (no per-request external call), wired into the existing `src/lib/jobs/feature-enrichment.ts` pipeline as a third fail-soft source.

---

## Problem Frame

Plan 002 U3 shipped the `property_features` table and a batch enricher that populates planning zone/overlays and nearest-station distance, but **deferred** three signals (SEIFA, Vicmap parcel, school catchments) because each needs a confirmed reference data source rather than a live query. This plan resolves the **school-catchment** one.

**Source correction (load-bearing).** The request named "My School". ACARA's **My School** (`myschool.edu.au`) publishes school *performance/NAPLAN* data — it does **not** publish catchment polygons. Victorian school **zone boundaries** come from the Department of Education's **`findmyschool.vic.gov.au`**, and the licensed, downloadable spatial data is on **`data.vic.gov.au`** ("Victorian Government School Zones" — a yearly dataset, e.g. 2026/2027). No public ArcGIS REST query endpoint surfaced for live point lookups (unlike `spatial.planning.vic.gov.au`, which `planning.ts` queries live), so this plan uses **bundled reference data + local point-in-polygon**, matching plan 002 U3's stated approach: *"cache static reference data (overlay polygons, … coordinates) locally rather than hitting external services per property."*

**Data characteristics** (from the dataset metadata):
- Separate spatial datasets for **primary** zones and for **each year level of secondary**.
- Projection **GDA94 VicGrid, EPSG:3111** — must be reprojected to **WGS84 (EPSG:4326)** for lat/lng point-in-polygon.
- Zones are Voronoi/shortest-practical-route polygons keyed to a school location; each polygon carries the school it belongs to.

**Scope decisions (confirmed with user):**
- Store a **single representative secondary zone** (the whole-secondary / Year 7 catchment), not per-year-level.
- Clip the bundled reference data to **Casey + Cardinia only** (matches the project's Casey/Cardinia-only data scope; keeps the file small and repo-friendly).

---

## Requirements

- **R1** — For a Casey/Cardinia lat/lng, the enrichment resolves the **primary** government-school zone and a **secondary** government-school zone (the school name for each containing polygon) and writes them to `property_features.school_zone_primary` / `school_zone_secondary`.
- **R2** — A point inside **no** zone (or outside the clipped extent) returns `null` for that zone — no error, no fabricated value.
- **R3** — The school-zone lookup is **local** (bundled reference data + in-process point-in-polygon); it makes no per-property external network call.
- **R4** — School-zone resolution is wired into the existing `feature-enrichment` pipeline as an **independent, fail-soft** source: a failure (missing/corrupt reference file, lookup throw) leaves the two zone columns absent without blocking planning/transport enrichment or failing the row (mirrors plan 002 U3 R3).
- **R5** — The reference data is **reproducible**: a documented prep step regenerates the bundled file from the official `data.vic.gov.au` datasets when DET publishes a new year.
- **R6** — No new migration and no response-shape change; the existing `property_features` columns are populated.

---

## Key Technical Decisions

- **Source = `data.vic.gov.au` "Victorian Government School Zones", not My School (R1, R5).** My School is performance data with no catchment geometry. The DET zone datasets are the authoritative, licensed, downloadable polygons. The prep step pins a specific dataset year (e.g. 2026) and records the source URL for reproducibility.
- **Offline prep → bundled WGS84 reference file; local point-in-polygon at runtime (R3).** No documented live point-query endpoint exists, and bundling avoids a per-request dependency on an external service (the failure mode plan 002 U3 explicitly designed around). The prep step reprojects EPSG:3111→4326 and clips to Casey + Cardinia so the runtime never reprojects and the file stays small.
- **Dependency-free point-in-polygon (R1, R2).** The repo carries **no GIS dependency** and already hand-rolls geo math (`haversine` in `src/lib/enrichment/transport.ts`). A small even-odd ray-casting test over GeoJSON rings — supporting `Polygon`, `MultiPolygon`, and interior holes — keeps that convention and avoids pulling in `@turf/*`. (Alternative — `@turf/boolean-point-in-polygon` — considered; rejected to avoid a dependency for ~30 lines of well-understood geometry. Revisit only if multipart/hole correctness proves fiddly.)
- **Single secondary zone (confirmed).** DET publishes a catchment per secondary year level; storing the representative whole-secondary (Year 7) zone covers the common 7–12 case with one column and far less data. Per-year granularity is deferred (would need extra columns).
- **Clip to Casey + Cardinia (confirmed).** Matches the project's data restriction; yields a sub-megabyte reference file that imports/loads cheaply. Whole-of-Victoria is deferred to a future expansion.
- **Reference data lives in-repo, loaded lazily and cached in module scope (R3).** Mirrors `planning.ts`'s module-level in-memory cache: load the GeoJSON once on first lookup, reuse thereafter.
- **Populate existing columns; no new migration (R6).** Migration 009 already created `school_zone_primary` / `school_zone_secondary` as nullable placeholders for exactly this.

---

## High-Level Technical Design

```
OFFLINE (prep, U1 — run once per DET dataset year)
  data.vic.gov.au zone datasets (EPSG:3111, primary + per-year secondary)
        │  ogr2ogr: reproject 3111→4326, clip to Casey+Cardinia LGA, keep school-name field, simplify
        ▼
  src/lib/enrichment/data/school-zones-primary.casey-cardinia.json     (GeoJSON FeatureCollection, WGS84)
  src/lib/enrichment/data/school-zones-secondary.casey-cardinia.json

RUNTIME (per point, U2 + U3)
  enrichFeaturesForPoint(lat,lng)
        ├─► fetchPlanningData      (existing)
        ├─► fetchNearbyTransport   (existing)
        └─► resolveSchoolZones(lat,lng)  ◄── NEW (U2)
                 │  lazy-load + cache reference FeatureCollections
                 │  point-in-polygon (even-odd ray cast; Polygon/MultiPolygon/holes)
                 ▼
            { primary?: schoolName, secondary?: schoolName }   (null when no containing zone)
        ▼
  buildFeatureRow(... , zones)  →  property_features.school_zone_primary / _secondary
        (each source isolated: a throw in any one never blocks the others — R4)
```

Resolution outcomes:

```
point inside a primary zone?   inside a secondary zone?  →  result
        yes                           yes                →  both names written
        yes                           no                 →  primary written, secondary absent
        no                            no                 →  both absent (point outside extent / unzoned)
   reference file missing/corrupt                        →  source fails soft → both absent, row still written
```

---

## Implementation Units

### U1. Prep step + bundled reference data

**Goal:** Produce compact WGS84 GeoJSON reference files for Casey + Cardinia primary and secondary school zones from the official `data.vic.gov.au` datasets, plus a documented, repeatable prep recipe.

**Requirements:** R1, R5

**Dependencies:** none

**Files:**
- `scripts/prep-school-zones.md` (new) — documented recipe: which `data.vic.gov.au` dataset + year, the `ogr2ogr` invocation (reproject EPSG:3111→4326, `-clipsrc` to the Casey+Cardinia LGA extent, retain the school-name attribute, simplify tolerance), and which secondary year-level layer is taken as the representative secondary zone
- `src/lib/enrichment/data/school-zones-primary.casey-cardinia.json` (new) — GeoJSON FeatureCollection, WGS84; each feature carries the primary school name
- `src/lib/enrichment/data/school-zones-secondary.casey-cardinia.json` (new) — as above for the representative secondary zone

**Approach:** Offline tooling, not application code. Use `ogr2ogr` (GDAL) — it understands EPSG:3111 natively and does reproject + clip + field-select + simplify + GeoJSON emit in one pass (`mapshaper` is a viable npm-only alternative, noted in the recipe). Clip by the Casey + Cardinia LGA polygons (from the Vicmap/`data.vic.gov.au` LGA dataset) or a tight bounding box of the two LGAs. Normalise each feature's properties to a single stable `school` name field so the runtime lookup is property-name-stable. Record the dataset year + source URL in the recipe header for the yearly refresh (R5).

**Execution note:** This unit produces data artifacts via an external tool; treat the JSON files as generated fixtures. Verify by inspection (feature counts plausible for Casey/Cardinia; coordinate bounds fall within ~144.9–145.6 E / −37.8–−38.4 S; each feature has a non-empty `school`).

**Test scenarios:** `Test expectation: none — offline data-prep artifact + recipe; correctness is verified by the U2 lookup tests that consume these files and by the inspection checks in the Execution note.`

**Verification:** Both JSON files exist, are valid WGS84 GeoJSON FeatureCollections clipped to Casey/Cardinia, and every feature exposes a `school` name; the recipe reproduces them from the cited dataset.

---

### U2. Point-in-polygon school-zone lookup module

**Goal:** A local module that lazily loads the bundled reference data and resolves a lat/lng to `{ primary?, secondary? }` school names via dependency-free point-in-polygon.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- `src/lib/enrichment/school-zones.ts` (new) — `resolveSchoolZones(lat, lng): { primary?: string; secondary?: string }`; module-scope lazy-load + cache of the two FeatureCollections; even-odd ray-casting point-in-polygon supporting `Polygon`, `MultiPolygon`, and interior holes
- `src/lib/enrichment/__tests__/school-zones.test.ts` (new)

**Approach:** On first call, load and cache the two GeoJSON files (mirror the module-level cache in `src/lib/enrichment/planning.ts`). For each collection, return the `school` of the first feature whose geometry contains the point. Point-in-polygon: even-odd ray cast across all rings of a polygon (exterior + holes, so a point in a hole is correctly excluded); for `MultiPolygon`, a point is inside if it is inside any constituent polygon. Coordinates are already WGS84 (`[lng, lat]` GeoJSON order) — no reprojection at runtime. Fail-soft: a missing/corrupt file or load error yields `{}` (R2/R4), logged once.

**Patterns to follow:** `src/lib/enrichment/transport.ts` (hand-rolled `haversine` — same dependency-free geo-math convention); `src/lib/enrichment/planning.ts` (module-level lazy cache shape).

**Test scenarios:**
- Happy path: a point clearly inside a known primary zone returns that school as `primary`; a point inside a known secondary zone returns it as `secondary`.
- Both: a point inside both a primary and secondary zone returns both names.
- Edge — outside all zones: a point outside the clipped extent returns `{}` (no throw) (R2).
- Edge — hole/donut: a point inside an interior hole of a polygon is **not** matched to that polygon.
- Edge — MultiPolygon: a point inside a non-first constituent polygon of a `MultiPolygon` zone is matched.
- Edge — boundary determinism: a point on a shared edge resolves to exactly one zone deterministically (document the tie-break — e.g. first-match wins).
- Error/fail-soft: with the reference file absent or unparparseable, `resolveSchoolZones` returns `{}` and does not throw (R3/R4).
- The point-in-polygon helper is unit-tested directly against hand-built square/donut/multipolygon fixtures (independent of the bundled data) for inside/outside/on-vertex cases.

**Verification:** A known Berwick (Casey) coordinate resolves to its actual primary and secondary government-school zones; an ocean/out-of-area coordinate returns `{}`.

---

### U3. Wire school zones into feature enrichment + persist

**Goal:** Add school-zone resolution as a third fail-soft source in the feature-enrichment pipeline and persist the names to the existing `property_features` columns.

**Requirements:** R4, R6

**Dependencies:** U2

**Files:**
- `src/lib/jobs/feature-enrichment.ts` (modify) — call `resolveSchoolZones` inside `enrichFeaturesForPoint` (isolated in its own try/catch like the planning/transport calls); extend `buildFeatureRow` to map `{ primary, secondary }` → `school_zone_primary` / `school_zone_secondary`, omitting absent values; extend `FEATURE_SOURCE` provenance to reflect the added source
- `src/lib/jobs/__tests__/feature-enrichment.test.ts` (modify) — extend the existing suite
- `INTEGRATIONS.md` (modify) — note that `property_features` now also carries school-zone catchments and how the reference data is refreshed (link the U1 recipe)

**Approach:** `resolveSchoolZones` is synchronous and local, but wrap it so a throw can never break the row (R4) — keep the same per-source isolation the planning/transport calls already use. In `buildFeatureRow`, write `school_zone_primary` / `school_zone_secondary` only when present (never `''`/null), consistent with the existing omit-absent behavior. The `property_features` columns already exist (migration 009) — no schema change, no new migration (R6). Surface via the existing on-demand `GET /api/cron/enrich-features` route — no route change needed.

**Patterns to follow:** the existing `buildFeatureRow` / `enrichFeaturesForPoint` structure in `src/lib/jobs/feature-enrichment.ts` and its test file `src/lib/jobs/__tests__/feature-enrichment.test.ts`.

**Test scenarios:**
- `buildFeatureRow` maps `{ primary, secondary }` to `school_zone_primary` / `school_zone_secondary` (happy path).
- `buildFeatureRow` omits a zone column when its name is absent (partial result).
- `enrichFeaturesForPoint`: a thrown school-zone lookup does **not** block the planning/transport columns or fail the row (R4) — mirror the existing per-source fail-soft tests.
- `enrichFeaturesForPoint`: with all three sources returning data, the assembled row carries planning + station + both school zones.

**Verification:** Running the enricher for a Casey/Cardinia sold address persists its primary and secondary school zones to `property_features`; a row whose point is unzoned still persists with planning/transport populated and the zone columns absent.

---

## Scope Boundaries

**In scope:** offline prep of Casey/Cardinia primary + representative-secondary zone reference data; a dependency-free local point-in-polygon lookup module; wiring it as a fail-soft source into the existing feature-enrichment pipeline; persisting to the existing `property_features` columns; a reproducible refresh recipe; documentation.

**Out of scope (true non-goals):**
- The other deferred plan-002-U3 signals (SEIFA decile, Vicmap parcel land area) — separate follow-ups.
- Live/per-request school-zone API integration — no documented endpoint, and bundling is the intended approach.
- Non-government (Catholic/independent) school catchments — DET zones cover government schools only.
- Changing `property_features` schema, the cron route, or any response shape.

### Deferred to Follow-Up Work
- **Per-year-level secondary zones** — store each secondary year-level catchment separately (extra columns + data); deferred per the single-zone decision.
- **Whole-of-Victoria extent** — re-clip the reference data beyond Casey/Cardinia when the project's geographic scope expands.
- **Distance-to-zoned-school** as an additional AVM feature (the zone gives membership; a distance signal could complement it).

---

## Risks & Dependencies

- **External tool for prep (`ogr2ogr`/GDAL).** Required only at prep time (U1), not at runtime. Mitigated: documented recipe + `mapshaper` npm alternative; the committed JSON files mean contributors don't re-run prep to build/test.
- **Reprojection correctness (EPSG:3111→4326).** A wrong reprojection silently shifts every zone. Mitigated by the U2 verification against a **known** Berwick coordinate's real zones and the WGS84-bounds inspection check in U1.
- **Reference-data size in the repo.** Mitigated by the Casey/Cardinia clip + geometry simplification in U1; target sub-megabyte per file. If still large, store simplified geometry (lookup tolerates simplified boundaries).
- **Boundary/tie cases.** Points exactly on a shared edge — mitigated by a documented deterministic tie-break (first-match wins) and an explicit boundary test (U2).
- **Yearly dataset churn.** DET republishes zones annually. Mitigated by R5's reproducible recipe; refresh is a documented, low-frequency operation.
- **Dependency:** migration 009 (`property_features.school_zone_primary` / `_secondary`) — already applied in plan 002 U3.

---

## Sources & Research

- Victorian Government School Zones datasets — `data.vic.gov.au` (yearly, e.g. 2026/2027): downloadable spatial data, primary + per-secondary-year layers, **GDA94 VicGrid EPSG:3111**, Voronoi/shortest-practical-route polygons. Authoritative catchment source.
- `findmyschool.vic.gov.au` (DET) — the public zone-lookup site backed by the same data; no documented public ArcGIS REST query endpoint surfaced for live point lookups (hence offline bundling).
- **My School (`myschool.edu.au`, ACARA)** — performance/NAPLAN data, **not** catchment geometry; explicitly not the source.
- Codebase grounding: `src/lib/jobs/feature-enrichment.ts` (`buildFeatureRow`/`enrichFeaturesForPoint` fail-soft pipeline), `src/lib/enrichment/planning.ts` (module-level cache pattern), `src/lib/enrichment/transport.ts` (hand-rolled geo math), `src/lib/db/migrations/009_external_features.sql` (existing zone columns), plan 002 U3 deferral.
