-- ============================================================================
-- Migration 002 — listing lifecycle + address linkage (additive, safe to re-run)
-- Run in the Supabase SQL editor AFTER 001_listings_rentals.sql.
-- Adds address_slug (link to `addresses`), last_seen_at + active (expiry) to the
-- on-market listing/rental tables. property_sales is append-only (no expiry).
-- ============================================================================

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS address_slug TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS active       BOOLEAN     NOT NULL DEFAULT true;

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS address_slug TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS active       BOOLEAN     NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_property_listings_active ON property_listings (suburb, state, active);
CREATE INDEX IF NOT EXISTS idx_property_listings_slug   ON property_listings (address_slug);
CREATE INDEX IF NOT EXISTS idx_property_rentals_active  ON property_rentals (suburb, state, active);
CREATE INDEX IF NOT EXISTS idx_property_rentals_slug    ON property_rentals (address_slug);
