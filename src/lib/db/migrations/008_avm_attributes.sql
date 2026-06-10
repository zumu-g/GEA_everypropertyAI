-- 008: persist AVM-relevant attributes the enrichment pipeline already extracts
-- but the sold/listing/rental rows never stored.
--
-- Adds four nullable columns to property_sales, property_listings and
-- property_rentals so the price-estimation/AVM work can train on real feature
-- data instead of beds/baths proxies:
--   building_area_sqm — internal/floor area (the #1 AVM predictor); sparse,
--                        sourced from listing floor plans where available (008+U2)
--   year_built        — construction year; drives age/condition effects
--   features          — JSONB array of feature flags (pool, solar, renovated, …)
--   field_confidence  — JSONB per-field confidence from the merger, so the model
--                        can down-weight low-quality attributes
--
-- Additive + idempotent: nothing is removed, no consumer/response shape changes,
-- and re-running is a no-op. Values stay NULL until the ingest/enrichment paths
-- populate them (this migration is the schema foundation only).

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS building_area_sqm numeric(10,2),
  ADD COLUMN IF NOT EXISTS year_built        smallint,
  ADD COLUMN IF NOT EXISTS features          jsonb,
  ADD COLUMN IF NOT EXISTS field_confidence  jsonb;

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS building_area_sqm numeric(10,2),
  ADD COLUMN IF NOT EXISTS year_built        smallint,
  ADD COLUMN IF NOT EXISTS features          jsonb,
  ADD COLUMN IF NOT EXISTS field_confidence  jsonb;

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS building_area_sqm numeric(10,2),
  ADD COLUMN IF NOT EXISTS year_built        smallint,
  ADD COLUMN IF NOT EXISTS features          jsonb,
  ADD COLUMN IF NOT EXISTS field_confidence  jsonb;
