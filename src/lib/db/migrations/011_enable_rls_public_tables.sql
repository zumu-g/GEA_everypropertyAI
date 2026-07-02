-- ============================================================================
-- Migration 011 — Enable RLS on `addresses`; lock public-read on data tables
-- ============================================================================
-- Context: Supabase advisor flagged `addresses` with RLS disabled (any anon-key
-- holder could read/write). Secondary finding: `crawl_queue`, `property_sales`,
-- `property_cache`, `property_listings`, `property_rentals` had a "Public read
-- access" policy. The app's anon client is auth-only — all data queries go via
-- the service-role server client — so public-read grants are unnecessary exposure.
--
-- Evidence (2026-07-02 probe against xulylioakpkvfywskmpk):
--   addresses          → anon INSERT returns 23502 (RLS off; only NOT-NULL blocked it)
--   crawl_queue et al  → anon SELECT returns real rows (public-read policy present)
--
-- Idempotent: safe to re-run. All CREATE POLICY calls are wrapped in the
-- duplicate_object guard from the repo's 001/007 convention.
-- ============================================================================

-- 1. addresses — enable RLS + service-role-only policy
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON addresses FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. crawl_queue — drop public-read; ensure service-role policy
DROP POLICY IF EXISTS "Public read access" ON crawl_queue;
ALTER TABLE crawl_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON crawl_queue FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. property_sales — drop public-read; ensure service-role policy
DROP POLICY IF EXISTS "Public read access" ON property_sales;
ALTER TABLE property_sales ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_sales FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. property_cache — drop public-read; ensure service-role policy
DROP POLICY IF EXISTS "Public read access" ON property_cache;
ALTER TABLE property_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_cache FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. property_listings — drop public-read; ensure service-role policy (KTD4: confirmed service-role-only consumers)
DROP POLICY IF EXISTS "Public read access" ON property_listings;
ALTER TABLE property_listings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_listings FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. property_rentals — drop public-read; ensure service-role policy
DROP POLICY IF EXISTS "Public read access" ON property_rentals;
ALTER TABLE property_rentals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON property_rentals FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
