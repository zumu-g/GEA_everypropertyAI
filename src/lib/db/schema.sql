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

-- ─── Raw Property Cache ─────────────────────────────────────────────────────
-- Stores the full MergedPropertyProfile JSON for fast retrieval.
-- Replaces in-memory cache for cross-restart persistence.

CREATE TABLE property_cache (
  address_slug     TEXT PRIMARY KEY,
  raw_data         JSONB NOT NULL,
  cached_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_cache_cached_at ON property_cache (cached_at);

-- ─── Agencies ────────────────────────────────────────────────────────────────

CREATE TABLE agencies (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT NOT NULL,
  website              TEXT NOT NULL,
  suburb               TEXT,
  state                TEXT NOT NULL DEFAULT 'VIC',
  postcode             TEXT,
  franchise_group      TEXT,
  search_pattern       TEXT,
  suburbs_covered      TEXT[] DEFAULT '{}',
  enabled              BOOLEAN NOT NULL DEFAULT true,
  url_verified         BOOLEAN DEFAULT false,
  last_crawled         TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (website, suburb)
);

CREATE INDEX idx_agencies_state        ON agencies (state);
CREATE INDEX idx_agencies_enabled      ON agencies (enabled);
CREATE INDEX idx_agencies_suburb       ON agencies (suburb);

-- ─── Property Sales (Valuer General + confirmed records) ─────────────────────

CREATE TABLE property_sales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_slug    TEXT,
  raw_address     TEXT NOT NULL,
  suburb          TEXT,
  state           TEXT NOT NULL,
  postcode        TEXT,
  lot_number      TEXT,
  plan_number     TEXT,
  land_area_sqm   NUMERIC(10,2),
  building_area_sqm NUMERIC(10,2),         -- 008: $/m² building rate for CMA
  property_type   TEXT,
  agency_name     TEXT,
  agent_name      TEXT,
  listing_url     TEXT,
  image_url       TEXT,
  sale_price      NUMERIC(14,2),
  sale_date       DATE,
  listed_date     TIMESTAMPTZ,             -- 008: scraped listing date (daysOnMarket)
  settlement_date DATE,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  source          TEXT NOT NULL,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, sale_date, sale_price, source)
);

CREATE INDEX idx_property_sales_suburb_date ON property_sales (suburb, state, sale_date DESC);
CREATE INDEX idx_property_sales_slug        ON property_sales (address_slug);
CREATE INDEX idx_property_sales_source      ON property_sales (source);

-- ─── Addresses (enumeration universe — e.g. G-NAF Core) ──────────────────────
-- Every known address in scope, independent of whether it has sold. Seeds the
-- backfill orchestrator's per-suburb crawl list. No sale data here (that lives
-- in property_sales); details are filled into property_cache by the crawl.

CREATE TABLE addresses (
  address_slug  TEXT PRIMARY KEY,
  raw_address   TEXT NOT NULL,
  street_number TEXT,
  street_name   TEXT,
  street_type   TEXT,
  suburb        TEXT,
  state         TEXT NOT NULL,
  postcode      TEXT,
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  source        TEXT NOT NULL DEFAULT 'gnaf',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_addresses_suburb ON addresses (suburb, state);
CREATE INDEX idx_addresses_postcode ON addresses (postcode);

-- ─── Suburb Crawl Progress ───────────────────────────────────────────────────

CREATE TABLE suburb_crawl_progress (
  suburb       TEXT NOT NULL,
  state        TEXT NOT NULL,
  postcode     TEXT NOT NULL,
  last_crawled TIMESTAMPTZ,
  next_due     TIMESTAMPTZ,
  listings_found INT DEFAULT 0,
  PRIMARY KEY (suburb, state)
);

-- ─── Crawl Queue ─────────────────────────────────────────────────────────────

CREATE TABLE crawl_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type     TEXT NOT NULL,
  payload      JSONB NOT NULL,
  priority     INT NOT NULL DEFAULT 5,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result       JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crawl_queue_status_next ON crawl_queue (status, next_attempt)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_crawl_queue_job_type    ON crawl_queue (job_type);

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE properties     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (anon + authenticated can SELECT)
CREATE POLICY "Public read access" ON properties     FOR SELECT USING (true);
CREATE POLICY "Public read access" ON sale_history   FOR SELECT USING (true);
CREATE POLICY "Public read access" ON rental_history FOR SELECT USING (true);
CREATE POLICY "Public read access" ON crawl_jobs     FOR SELECT USING (true);
CREATE POLICY "Public read access" ON data_sources   FOR SELECT USING (true);
CREATE POLICY "Public read access" ON photos         FOR SELECT USING (true);
CREATE POLICY "Public read access" ON property_cache FOR SELECT USING (true);

ALTER TABLE agencies               ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_sales         ENABLE ROW LEVEL SECURITY;
ALTER TABLE suburb_crawl_progress  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_queue            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON agencies               FOR SELECT USING (true);
CREATE POLICY "Public read access" ON property_sales         FOR SELECT USING (true);
CREATE POLICY "Public read access" ON suburb_crawl_progress  FOR SELECT USING (true);
CREATE POLICY "Public read access" ON crawl_queue            FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON agencies               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON property_sales         FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON suburb_crawl_progress  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON crawl_queue            FOR ALL USING (auth.role() = 'service_role');

-- Service role can do everything (insert/update/delete via server-side only)
CREATE POLICY "Service role full access" ON properties     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON sale_history   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON rental_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON crawl_jobs     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON data_sources   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON photos         FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON property_cache FOR ALL USING (auth.role() = 'service_role');

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

-- ============================================================================
-- RPC: increment_agency_failures
-- Called by queries.ts markAgencyFailure() to track crawl failures per agency.
-- When an agency hits 5 consecutive failures it is automatically disabled.
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_agency_failures(p_website TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE agencies
  SET
    consecutive_failures = consecutive_failures + 1,
    enabled = CASE
      WHEN consecutive_failures + 1 >= 5 THEN false
      ELSE enabled
    END
  WHERE website = p_website;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Property Overrides ──────────────────────────────────────────────────────
-- Stores user-corrected field values. Applied at read time, highest priority.

CREATE TABLE property_overrides (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_slug TEXT NOT NULL,
  field        TEXT NOT NULL,
  value        TEXT NOT NULL,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (address_slug, field)
);

CREATE INDEX idx_property_overrides_slug ON property_overrides (address_slug);

ALTER TABLE property_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access"       ON property_overrides FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON property_overrides FOR ALL    USING (auth.role() = 'service_role');

-- ─── User Tracked Properties ─────────────────────────────────────────────────

CREATE TABLE user_properties (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL,
  address_slug TEXT NOT NULL,
  full_address TEXT NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, address_slug)
);

CREATE INDEX idx_user_properties_user_id ON user_properties (user_id);

ALTER TABLE user_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own properties"
  ON user_properties FOR ALL USING (auth.uid() = user_id);

-- ─── Property Listings (on-market / for-sale) ────────────────────────────────
-- Suburb- and radius-queryable feed of CURRENT on-market listings, sourced from
-- the Domain Apify scraper (record_type "listing", /sale/ pages). Parallel to
-- property_sales (which holds SOLD records). Deduped per source on raw_address.

CREATE TABLE IF NOT EXISTS property_listings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_address   TEXT NOT NULL,
  address_slug  TEXT,            -- links to addresses.address_slug
  suburb        TEXT,
  state         TEXT NOT NULL DEFAULT 'VIC',
  postcode      TEXT,
  display_price TEXT,            -- raw price string, e.g. "$930,000 - $970,000"
  price_low     NUMERIC(14,2),   -- parsed low end of the range (low=high if single)
  price_high    NUMERIC(14,2),   -- parsed high end of the range
  status        TEXT,            -- listing.tags.tag_text, e.g. "Under offer"
  bedrooms      SMALLINT,
  bathrooms     SMALLINT,
  car_spaces    SMALLINT,
  land_area_sqm NUMERIC(10,2),
  property_type TEXT,
  agency_name   TEXT,
  agent_name    TEXT,
  listing_url   TEXT,
  image_url     TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  source        TEXT NOT NULL,
  raw_data      JSONB,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- bumped each sync run
  active        BOOLEAN NOT NULL DEFAULT true,        -- false once no longer on-market
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, source)
);

CREATE INDEX IF NOT EXISTS idx_property_listings_suburb ON property_listings (suburb, state);
CREATE INDEX IF NOT EXISTS idx_property_listings_geo    ON property_listings (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_property_listings_active ON property_listings (suburb, state, active);
CREATE INDEX IF NOT EXISTS idx_property_listings_slug   ON property_listings (address_slug);

ALTER TABLE property_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access"       ON property_listings FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON property_listings FOR ALL    USING (auth.role() = 'service_role');

-- ─── Property Rentals (on-market / for-rent) ─────────────────────────────────
-- Suburb- and radius-queryable feed of CURRENT rental listings, sourced from the
-- Domain Apify scraper (/rent/ pages). Distinct from rental_history (per-property
-- lease records). Deduped per source on raw_address. (Table + endpoint exist now;
-- the /rent/ scrape is loaded in a later step.)

CREATE TABLE IF NOT EXISTS property_rentals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_address   TEXT NOT NULL,
  address_slug  TEXT,            -- links to addresses.address_slug
  suburb        TEXT,
  state         TEXT NOT NULL DEFAULT 'VIC',
  postcode      TEXT,
  display_price TEXT,            -- raw price string, e.g. "$550 per week"
  weekly_rent   NUMERIC(10,2),   -- parsed weekly rent
  status        TEXT,            -- listing.tags.tag_text, e.g. "Under application"
  bedrooms      SMALLINT,
  bathrooms     SMALLINT,
  car_spaces    SMALLINT,
  land_area_sqm NUMERIC(10,2),
  property_type TEXT,
  agency_name   TEXT,
  agent_name    TEXT,
  listing_url   TEXT,
  image_url     TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  source        TEXT NOT NULL,
  raw_data      JSONB,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- bumped each sync run
  active        BOOLEAN NOT NULL DEFAULT true,        -- false once no longer listed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, source)
);

CREATE INDEX IF NOT EXISTS idx_property_rentals_suburb ON property_rentals (suburb, state);
CREATE INDEX IF NOT EXISTS idx_property_rentals_geo    ON property_rentals (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_property_rentals_active ON property_rentals (suburb, state, active);
CREATE INDEX IF NOT EXISTS idx_property_rentals_slug   ON property_rentals (address_slug);

ALTER TABLE property_rentals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access"       ON property_rentals FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON property_rentals FOR ALL    USING (auth.role() = 'service_role');
