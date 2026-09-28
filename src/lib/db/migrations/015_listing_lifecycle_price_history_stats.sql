-- ============================================================================
-- Migration 015 — listing lifecycle, price history, feed runs, suburb stats
--
-- Adds every column and table the suburb-market-stats work writes:
--   * property_listings / property_rentals gain a normalised lifecycle
--     (lifecycle_status, miss counting, removed_at / leased_at, campaign start,
--     listed-date provenance, sale method + auction date, engagement counters).
--   * listing_price_history records one row per price observation per listing
--     identity (table, raw_address, source) — written by the feed write module
--     on first sight and on parsed-price change, never by a trigger.
--   * feed_runs records one row per crawl run (seen / new / priced / miss /
--     closed / skipped counts and cost). feed_health is untouched so the
--     freshness and digest jobs keep working.
--   * suburb_stats_history freezes per-period suburb statistics on the natural
--     key (suburb, state, period_type, period_start). Modelled on migration 014.
--
-- Idempotent: safe to re-run in the Supabase SQL editor. Every CREATE and ADD
-- COLUMN is IF NOT EXISTS; policies use the duplicate_object guard from 011.
-- ============================================================================

-- ─── 1. property_listings — lifecycle columns ───────────────────────────────
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'under_offer', 'sold', 'withdrawn'));
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS miss_count SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS miss_marked_at TIMESTAMPTZ;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS campaign_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS listed_date_source TEXT;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS enquiry_count INTEGER;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS view_count INTEGER;
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS sale_method TEXT NOT NULL DEFAULT 'unknown' CHECK (sale_method IN ('auction', 'private', 'unknown'));
ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS auction_date DATE;

COMMENT ON COLUMN property_listings.lifecycle_status IS 'Normalised from source status text (KTD3); raw text stays in status.';
COMMENT ON COLUMN property_listings.miss_count IS 'Consecutive verified full sweeps of this source that did not see the row; closed at 2.';
COMMENT ON COLUMN property_listings.miss_marked_at IS 'When miss_count was last incremented; a sweep only counts a miss once per ~20h.';
COMMENT ON COLUMN property_listings.removed_at IS 'Run start of the sweep that closed the row; cleared if the listing reopens.';
COMMENT ON COLUMN property_listings.campaign_started_at IS 'Start of the current campaign; days-on-market basis. Reset when a closed row is seen again.';
COMMENT ON COLUMN property_listings.listed_date_source IS 'Which source supplied listed_date; null means listed_date is null and created_at is the fallback.';
COMMENT ON COLUMN property_listings.enquiry_count IS 'Reserved; no current writer populates it.';
COMMENT ON COLUMN property_listings.view_count IS 'Reserved; no current writer populates it.';
COMMENT ON COLUMN property_listings.sale_method IS 'auction | private | unknown, derived from price/status text; auction sticks for the campaign.';
COMMENT ON COLUMN property_listings.auction_date IS 'Stated auction day when the source text carries one.';

-- ─── 2. property_rentals — lifecycle columns ────────────────────────────────
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'under_offer', 'sold', 'withdrawn'));
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS miss_count SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS miss_marked_at TIMESTAMPTZ;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS campaign_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS listed_date_source TEXT;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS enquiry_count INTEGER;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS view_count INTEGER;
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS leased_at TIMESTAMPTZ;

COMMENT ON COLUMN property_rentals.leased_at IS 'Rental analogue of removed_at: run start of the sweep that closed the row.';

-- ─── 3. Backfill campaign_started_at from first-seen ────────────────────────
-- New column defaulted to now() on existing rows, which is later than their real
-- first sight. Only rows still at the default (> created_at) are touched, so a
-- re-run is a no-op and rows a later crawl legitimately reopened are left alone.
UPDATE property_listings SET campaign_started_at = created_at WHERE campaign_started_at > created_at;
UPDATE property_rentals  SET campaign_started_at = created_at WHERE campaign_started_at > created_at;

-- ─── 4. Partial indexes: current-market reads and the per-source sweep ──────
CREATE INDEX IF NOT EXISTS idx_property_listings_active_suburb
  ON property_listings (suburb, state) WHERE active;
CREATE INDEX IF NOT EXISTS idx_property_rentals_active_suburb
  ON property_rentals (suburb, state) WHERE active;
CREATE INDEX IF NOT EXISTS idx_property_listings_sweep
  ON property_listings (source, suburb, active, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_property_rentals_sweep
  ON property_rentals (source, suburb, active, last_seen_at);

-- ─── 5. listing_price_history ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_price_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name    TEXT NOT NULL CHECK (table_name IN ('listings', 'rentals')),
  raw_address   TEXT NOT NULL,
  source        TEXT NOT NULL,
  listing_url   TEXT,                                -- informational; changes on relist, not part of identity
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_price TEXT,
  price_low     NUMERIC(14,2),                       -- weekly_rent for rentals
  price_high    NUMERIC(14,2)
);

CREATE INDEX IF NOT EXISTS idx_listing_price_history_identity
  ON listing_price_history (table_name, raw_address, source, observed_at DESC);

ALTER TABLE listing_price_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON listing_price_history FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 6. feed_runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feed_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category        TEXT NOT NULL,                     -- 'sold' | 'on-market' | 'rent'
  source          TEXT NOT NULL,
  mode            TEXT,                              -- e.g. REA 'full' | 'daily'
  run_start       TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_end         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',   -- 'running' | 'ok' | 'broken' | 'blocked'
  seen            INTEGER NOT NULL DEFAULT 0,        -- rows the crawl saw (last_seen_at refreshed)
  new_rows        INTEGER NOT NULL DEFAULT 0,
  priced          INTEGER NOT NULL DEFAULT 0,        -- price-history rows written
  miss1           INTEGER NOT NULL DEFAULT 0,        -- rows given their first miss this run
  closed          INTEGER NOT NULL DEFAULT 0,        -- rows closed at miss 2
  skipped_suburbs INTEGER NOT NULL DEFAULT 0,        -- suburbs the coverage guard skipped
  fetched         INTEGER NOT NULL DEFAULT 0,        -- paid detail fetches
  dated           INTEGER NOT NULL DEFAULT 0,        -- rows given a listed_date
  failed          INTEGER NOT NULL DEFAULT 0,
  est_cost_usd    NUMERIC(10,4),
  notes           JSONB                              -- free-form: skipped suburb list, errors
);

CREATE INDEX IF NOT EXISTS idx_feed_runs_source_start
  ON feed_runs (source, run_start DESC);

ALTER TABLE feed_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON feed_runs FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 7. suburb_stats_history ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suburb_stats_history (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suburb         TEXT NOT NULL,                      -- canonical (normaliseSuburbAlias) suburb name
  state          TEXT NOT NULL DEFAULT 'VIC',
  period_type    TEXT NOT NULL CHECK (period_type IN ('week', 'month')),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  stats          JSONB NOT NULL,
  provisional    BOOLEAN NOT NULL DEFAULT true,      -- false once frozen (60 days after period_end)
  reconstructed  BOOLEAN NOT NULL DEFAULT false,     -- true when built from history rather than observed live
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version SMALLINT NOT NULL DEFAULT 1,
  UNIQUE (suburb, state, period_type, period_start)
);

ALTER TABLE suburb_stats_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON suburb_stats_history FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
