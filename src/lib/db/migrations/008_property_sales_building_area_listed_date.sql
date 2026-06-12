-- 008: add building_area_sqm + listed_date to property_sales
-- The CMA estimator computes $/m² building rates from sold comparables, so each
-- sold row needs a building area; sold rows also need a listing date so
-- daysOnMarket can be derived (saleDate − firstListedDate). Both are captured
-- at ingest going forward (Domain item fields, when present) and recovered for
-- historic rows by the raw_data backfill script. Idempotent, additive.
--
-- Nullable on purpose, same rationale as 006: ingest omits these keys when the
-- source has no value, and supabase-js .upsert() (defaultToNull: true) would
-- reject a heterogeneous batch against a NOT NULL column. NULL means "unknown";
-- the API layer fills blanks from the cached property profile / listings join
-- and returns null when no source has the value — never a fabricated default.
--
-- No DEFAULT and no backfill here: unlike listed_date on listings (006), sold
-- rows have no meaningful first-seen fallback — a sold record's created_at is
-- the scrape date, not a listing date.

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS building_area_sqm NUMERIC(10,2);

ALTER TABLE property_sales
  ADD COLUMN IF NOT EXISTS listed_date TIMESTAMPTZ;
