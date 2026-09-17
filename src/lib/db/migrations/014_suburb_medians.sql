-- ============================================================================
-- Migration 014 — suburb_medians (Valuer-General per-suburb house/unit medians)
--
-- Stores quarterly and yearly median-price rows parsed from the Valuer-General
-- Victoria "Property Sales Report" datasets, scoped to service-area suburbs.
-- Distinct from property_sales' legacy `vic-vg-aggregate` rows (retired by
-- this same change — see src/lib/jobs/vg-suburb-medians.ts): those were
-- individual pseudo-sale rows appended non-idempotently; this table is the
-- suburb-level median itself, upserted on its natural key so re-ingest never
-- duplicates and a revised figure replaces the earlier one.
-- See docs/plans/2026-09-07-1735-feat-casey-cardinia-values-guide-plan.md (U1).
-- ============================================================================

CREATE TABLE IF NOT EXISTS suburb_medians (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suburb          TEXT NOT NULL,          -- canonical (normaliseSuburbAlias) suburb name
  property_type   TEXT NOT NULL CHECK (property_type IN ('house', 'unit')),
  period_type     TEXT NOT NULL CHECK (period_type IN ('quarter', 'year')),
  period_start    DATE NOT NULL,          -- first day of the quarter/year the row covers
  median          NUMERIC(12,2) CHECK (median IS NULL OR median > 0), -- null = VG suppressed (thin market)
  sales_count     INTEGER,                -- published sales count for the period, when VG discloses it
  source_url      TEXT NOT NULL,          -- the exact file URL this row was parsed from (rollback anchor)
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (suburb, property_type, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_suburb_medians_suburb_type
  ON suburb_medians (suburb, property_type);

-- RLS: service-role only, per migration 011's convention (the values-guide
-- endpoint reads this via the service-role server client, never the anon key).
ALTER TABLE suburb_medians ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON suburb_medians FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
