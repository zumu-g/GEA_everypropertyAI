-- ============================================================================
-- Migration 004 — listing URL + main photo on the feed tables (additive, safe to re-run)
-- Run in the Supabase SQL editor. Captures the Domain listing URL (item.url) and
-- main photo (item.property.image_urls[0]) onto each row so the agent-listings
-- API can return links + photos. Populated on re-ingest.
-- ============================================================================

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS listing_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url   TEXT;

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS listing_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url   TEXT;

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS listing_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url   TEXT;
