-- ============================================================================
-- Migration 012 — Null out implausible sub-10m² land/building areas
-- ============================================================================
-- Context: extraction previously returned bare hectare/acre figures (e.g.
-- "3.64ha") as if they were already square metres, producing nonsense values
-- like land_area_sqm = 3.64 for an acreage property. Fixed at the source in
-- src/lib/extraction/prompts.ts (explicit unit-conversion instruction) and
-- guarded going forward in src/lib/utils/area.ts (sqmOrNull floor).
--
-- This is a data-only backfill: no house or land plot is plausibly under
-- 10m², so any stored value below that floor is corrupted data, not a real
-- reading. We don't know the true original unit reliably enough to convert
-- in place (could be ha, could be a stray decimal), so the safe fix is to
-- null it out — the app's enrichment/profile-fill fallback (see
-- src/lib/sold/enrich.ts) will backfill from another source on next read,
-- same "0/negative = missing" convention already used for these columns.
--
-- Idempotent: safe to re-run (WHERE clause only ever matches already-bad rows).
-- ============================================================================

UPDATE properties
SET land_area_sqm = NULL
WHERE land_area_sqm IS NOT NULL AND land_area_sqm < 10;

UPDATE properties
SET building_area_sqm = NULL
WHERE building_area_sqm IS NOT NULL AND building_area_sqm < 10;

UPDATE property_sales
SET land_area_sqm = NULL
WHERE land_area_sqm IS NOT NULL AND land_area_sqm < 10;

UPDATE property_sales
SET building_area_sqm = NULL
WHERE building_area_sqm IS NOT NULL AND building_area_sqm < 10;

UPDATE property_listings
SET land_area_sqm = NULL
WHERE land_area_sqm IS NOT NULL AND land_area_sqm < 10;

UPDATE property_rentals
SET land_area_sqm = NULL
WHERE land_area_sqm IS NOT NULL AND land_area_sqm < 10;
