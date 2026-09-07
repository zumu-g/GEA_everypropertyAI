-- ============================================================================
-- Migration 013 — property_rental_history (append-only historical leases)
--
-- property_rentals is a CURRENT-listing table (unique on raw_address+source,
-- `active`/`last_seen_at` track today's asking rent) — it can't hold multiple
-- past lease periods for the same address+source without overwriting itself.
-- This new table mirrors property_sales' shape (append-only, dedup on the
-- natural event key) but for rentals, so a profile crawl's rentalHistory[]
-- has somewhere real to land. See src/lib/jobs/persist-rental-history.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS property_rental_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_slug    TEXT,
  raw_address     TEXT NOT NULL,
  suburb          TEXT,
  state           TEXT NOT NULL,
  postcode        TEXT,
  weekly_rent     NUMERIC(10,2) NOT NULL,
  lease_date      DATE NOT NULL,          -- date the lease/rental event was recorded
  bond            NUMERIC(10,2),
  lease_term      TEXT,
  agency_name     TEXT,
  agent_name      TEXT,
  source          TEXT NOT NULL,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raw_address, lease_date, weekly_rent, source)
);

CREATE INDEX IF NOT EXISTS idx_property_rental_history_slug   ON property_rental_history (address_slug);
CREATE INDEX IF NOT EXISTS idx_property_rental_history_suburb ON property_rental_history (suburb, state, lease_date DESC);

ALTER TABLE property_rental_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access"       ON property_rental_history FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON property_rental_history FOR ALL    USING (auth.role() = 'service_role');
