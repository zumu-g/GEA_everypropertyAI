-- ============================================================================
-- Migration 001 — on-market listings + rentals (additive, safe to re-run)
-- Run this in the Supabase SQL editor (DDL can't go through PostgREST).
-- Adds: coords on property_sales, property_listings table, property_rentals table.
-- Nothing here drops or alters existing columns/behaviour.
-- ============================================================================

-- 1. Coordinates on property_sales (no-op if already present)
ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- 2. On-market (for-sale) listings
CREATE TABLE IF NOT EXISTS property_listings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_address   TEXT NOT NULL,
  suburb        TEXT,
  state         TEXT NOT NULL DEFAULT 'VIC',
  postcode      TEXT,
  display_price TEXT,
  price_low     NUMERIC(14,2),
  price_high    NUMERIC(14,2),
  status        TEXT,
  bedrooms      SMALLINT,
  bathrooms     SMALLINT,
  car_spaces    SMALLINT,
  land_area_sqm NUMERIC(10,2),
  property_type TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  source        TEXT NOT NULL,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, source)
);

CREATE INDEX IF NOT EXISTS idx_property_listings_suburb ON property_listings (suburb, state);
CREATE INDEX IF NOT EXISTS idx_property_listings_geo    ON property_listings (latitude, longitude);

ALTER TABLE property_listings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Public read access"       ON property_listings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_listings FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. On-market rental listings (table now; /rent/ scrape loaded later)
CREATE TABLE IF NOT EXISTS property_rentals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_address   TEXT NOT NULL,
  suburb        TEXT,
  state         TEXT NOT NULL DEFAULT 'VIC',
  postcode      TEXT,
  display_price TEXT,
  weekly_rent   NUMERIC(10,2),
  status        TEXT,
  bedrooms      SMALLINT,
  bathrooms     SMALLINT,
  car_spaces    SMALLINT,
  land_area_sqm NUMERIC(10,2),
  property_type TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  source        TEXT NOT NULL,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, source)
);

CREATE INDEX IF NOT EXISTS idx_property_rentals_suburb ON property_rentals (suburb, state);
CREATE INDEX IF NOT EXISTS idx_property_rentals_geo    ON property_rentals (latitude, longitude);

ALTER TABLE property_rentals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Public read access"       ON property_rentals FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_rentals FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
