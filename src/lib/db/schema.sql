-- ============================================================================
-- PropertyIQ — Supabase / PostgreSQL Schema
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy text search

-- ─── Properties (core) ──────────────────────────────────────────────────────

CREATE TABLE properties (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_slug                TEXT NOT NULL UNIQUE,
  full_address                TEXT NOT NULL,
  unit                        TEXT,
  street_number               TEXT,
  street_name                 TEXT,
  street_type                 TEXT,
  suburb                      TEXT NOT NULL,
  state                       TEXT NOT NULL,
  postcode                    TEXT NOT NULL,
  lat                         DOUBLE PRECISION,
  lng                         DOUBLE PRECISION,
  property_type               TEXT,
  bedrooms                    SMALLINT,
  bathrooms                   SMALLINT,
  car_spaces                  SMALLINT,
  land_area_sqm               NUMERIC(10,2),
  building_area_sqm           NUMERIC(10,2),
  year_built                  SMALLINT,
  construction                TEXT,
  roof_type                   TEXT,
  features                    JSONB DEFAULT '[]'::jsonb,
  estimated_value_low         NUMERIC(14,2),
  estimated_value_mid         NUMERIC(14,2),
  estimated_value_high        NUMERIC(14,2),
  value_confidence            NUMERIC(3,2),       -- 0.00 to 1.00
  council_valuation_land      NUMERIC(14,2),
  council_valuation_improvements NUMERIC(14,2),
  current_listing_status      TEXT,
  current_listing_price       NUMERIC(14,2),
  current_listing_agent       TEXT,
  current_listing_url         TEXT,
  ai_summary                  TEXT,
  overall_confidence          NUMERIC(3,2),       -- 0.00 to 1.00
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sale History ───────────────────────────────────────────────────────────

CREATE TABLE sale_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price             NUMERIC(14,2),
  sale_date         DATE,
  sale_type         TEXT,              -- 'private-treaty','auction','off-market', etc.
  days_on_market    INTEGER,
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Rental History ─────────────────────────────────────────────────────────

CREATE TABLE rental_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  weekly_rent       NUMERIC(10,2),
  start_date        DATE,
  end_date          DATE,
  source            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Crawl Jobs ─────────────────────────────────────────────────────────────

CREATE TABLE crawl_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID REFERENCES properties(id) ON DELETE SET NULL,
  source_name       TEXT NOT NULL,
  url               TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',   -- queued, running, completed, failed, etc.
  markdown_content  TEXT,
  extracted_data    JSONB,
  confidence_score  NUMERIC(3,2),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Data Sources ───────────────────────────────────────────────────────────

CREATE TABLE data_sources (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source_name       TEXT NOT NULL,
  url               TEXT,
  last_crawled      TIMESTAMPTZ,
  fields_extracted  JSONB DEFAULT '{}'::jsonb,
  raw_confidence    NUMERIC(3,2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Photos ─────────────────────────────────────────────────────────────────

CREATE TABLE photos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  source            TEXT,
  caption           TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE properties     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos         ENABLE ROW LEVEL SECURITY;

-- Public read access (anon + authenticated can SELECT)
CREATE POLICY "Public read access" ON properties     FOR SELECT USING (true);
CREATE POLICY "Public read access" ON sale_history   FOR SELECT USING (true);
CREATE POLICY "Public read access" ON rental_history FOR SELECT USING (true);
CREATE POLICY "Public read access" ON crawl_jobs     FOR SELECT USING (true);
CREATE POLICY "Public read access" ON data_sources   FOR SELECT USING (true);
CREATE POLICY "Public read access" ON photos         FOR SELECT USING (true);

-- Service role can do everything (insert/update/delete via server-side only)
CREATE POLICY "Service role full access" ON properties     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON sale_history   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON rental_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON crawl_jobs     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON data_sources   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON photos         FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_properties_address_slug ON properties (address_slug);
CREATE INDEX idx_properties_suburb_state ON properties (suburb, state);
CREATE INDEX idx_properties_postcode     ON properties (postcode);
CREATE INDEX idx_properties_full_address_trgm ON properties USING gin (full_address gin_trgm_ops);

CREATE INDEX idx_sale_history_property_id   ON sale_history (property_id);
CREATE INDEX idx_sale_history_sale_date     ON sale_history (property_id, sale_date DESC);

CREATE INDEX idx_rental_history_property_id ON rental_history (property_id);

CREATE INDEX idx_crawl_jobs_property_id     ON crawl_jobs (property_id);
CREATE INDEX idx_crawl_jobs_status          ON crawl_jobs (status);

CREATE INDEX idx_data_sources_property_id   ON data_sources (property_id);

CREATE INDEX idx_photos_property_id         ON photos (property_id);

-- ============================================================================
-- Updated-at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
