-- 007: feed_health — per-feed run health for freshness/blocked/broken monitoring.
-- One row per category (sold | on-market | rent), upserted on each ingest run.
-- Lets /api/cron/feed-freshness and /api/admin/crawl-status answer "is this feed
-- fresh, and if not — blocked (0 items), broken (error), or stale (no recent run)?"
-- Idempotent, additive.

CREATE TABLE IF NOT EXISTS feed_health (
  category      TEXT PRIMARY KEY,          -- 'sold' | 'on-market' | 'rent'
  last_run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_used   TEXT,                      -- 'domain-web-unlocker' | 'view-apify' | 'homely' | 'apify' ...
  items         INTEGER NOT NULL DEFAULT 0,-- rows processed this run
  newest_row_at TIMESTAMPTZ,               -- max(created_at) in the feed's table at run time
  status        TEXT NOT NULL DEFAULT 'ok',-- 'ok' | 'blocked' | 'broken'
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE feed_health ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON feed_health FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
