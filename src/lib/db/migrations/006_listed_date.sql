-- 006: add listed_date to property_rentals + property_listings
-- A semantically-clean "listing date" for on-market rows so reports/CMA can
-- filter "listed in the last N months". Populated by the Domain ingest with the
-- scraped listing date when available, else the row's first-seen value (this
-- DEFAULT). The ingest OMITS listed_date from the upsert payload when it has no
-- real date, so the merge-update never resets it on a daily re-scrape — the
-- earliest value stands. Idempotent, additive.
--
-- Note: existing property_listings rows get this migration's run-time as their
-- listed_date until next re-scraped (rows with a real date self-correct on the
-- next ingest). property_rentals is empty today, so no rental rows are affected.

ALTER TABLE property_rentals
  ADD COLUMN IF NOT EXISTS listed_date TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE property_listings
  ADD COLUMN IF NOT EXISTS listed_date TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_property_rentals_listed_date
  ON property_rentals (suburb, state, listed_date);

CREATE INDEX IF NOT EXISTS idx_property_listings_listed_date
  ON property_listings (suburb, state, listed_date);
