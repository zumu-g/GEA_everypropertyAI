-- 009: persist free external AVM features keyed by address_slug (plan 002 U3).
--
-- The AVM (U4–U7) trains on more than the property's own attributes — location
-- signals matter. This table holds slow-changing external features so the
-- training-matrix builder (U5) can join them in by address_slug without hitting
-- external services per row.
--
-- Populated by the batch enricher (src/lib/jobs/feature-enrichment.ts), which
-- calls the existing verifiable Victorian sources:
--   planning_*          — zone code/name + LGA + overlays, from
--                         spatial.planning.vic.gov.au ArcGIS (enrichment/planning.ts)
--   nearest_station_*   — nearest train station + distance, from
--                         Nominatim (enrichment/transport.ts)
--
-- The remaining plan-U3 signals are DEFERRED until their reference data sources
-- are confirmed (they need a downloaded dataset / verified endpoint, not a live
-- query). Their columns are created now as nullable placeholders so the later
-- enrichers populate them with no further migration / schema churn:
--   seifa_irsad_decile      — ABS SEIFA SA1/SA2 socio-economic decile
--   parcel_land_area_sqm    — Vicmap cadastral parcel area
--   school_zone_primary     — DET primary catchment name (point-in-polygon)
--   school_zone_secondary   — DET secondary catchment name
--
-- Additive + idempotent: re-running is a no-op; nothing else changes shape.

CREATE TABLE IF NOT EXISTS property_features (
  address_slug          text PRIMARY KEY,

  -- Planning (live, populated now)
  planning_zone_code    text,
  planning_zone_name    text,
  planning_lga          text,
  planning_overlays     jsonb,

  -- Transport (live, populated now)
  nearest_station_name  text,
  nearest_station_km    numeric(6,2),

  -- Deferred signals (nullable placeholders — see header)
  seifa_irsad_decile    smallint,
  parcel_land_area_sqm  numeric(10,2),
  school_zone_primary   text,
  school_zone_secondary text,

  -- Provenance
  source                text,
  fetched_at            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Freshness scans (skip rows enriched within the TTL).
CREATE INDEX IF NOT EXISTS idx_property_features_fetched_at
  ON property_features (fetched_at);
