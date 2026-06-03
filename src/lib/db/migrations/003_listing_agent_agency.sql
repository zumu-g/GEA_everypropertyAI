-- ============================================================================
-- Migration 003 — agent + agency on the bulk feed tables (additive, safe to re-run)
-- Run in the Supabase SQL editor. Captures the listing/selling agency + agent
-- name (from the Domain feed's `contacts` block) onto each row, so the API can
-- return "who listed / sold this property". Names only; populated on re-ingest.
-- ============================================================================

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS agency_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_name  TEXT;

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS agency_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_name  TEXT;

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS agency_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_name  TEXT;
