-- 006: add listed_date to property_rentals + property_listings
-- A "listing date" for on-market rows so reports/CMA can filter "listed in the
-- last N months". Holds the scraped Domain listing date WHEN AVAILABLE; NULL
-- otherwise. Reads fall back to created_at (first-seen) via COALESCE, so a NULL
-- listed_date simply means "use first-seen". Idempotent, additive.
--
-- Nullable on purpose: the ingest omits listed_date when it has no real date, and
-- supabase-js .upsert() (defaultToNull: true) substitutes NULL for keys missing
-- from any row in a heterogeneous batch. A NOT NULL column would reject the whole
-- batch (23502) the moment one item in it carries a date and the rest don't. NULL
-- is the correct "unknown" value and COALESCE(listed_date, created_at) covers reads.
--
-- No DEFAULT: existing rows become NULL → reads fall back to created_at (their true
-- first-seen) automatically, with no migration-time backfill skew.

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS listed_date TIMESTAMPTZ;

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS listed_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_property_rentals_listed_date
  ON property_rentals (suburb, state, listed_date);

CREATE INDEX IF NOT EXISTS idx_property_listings_listed_date
  ON property_listings (suburb, state, listed_date);
