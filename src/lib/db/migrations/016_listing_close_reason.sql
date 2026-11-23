-- ============================================================================
-- Migration 016 — close_reason on listings and rentals
--
-- Records why a row was closed, so the daily withdrawn report lists only
-- withdrawals the source sweep detected the day they happened:
--   'sweep' — sweepSource closed it after two missed crawls (scripts/lib/feed-write.mjs)
--   'stale' — the 21-day backstop closed it (scripts/reconcile-lifecycle.mjs)
--   NULL    — still active, or closed before this migration (incl. the 23/11/2026 cleanup)
-- A reopen clears it. Safe to run twice.
-- See docs/plans/2026-11-23-1311-feat-daily-55day-withdrawn-reports-plan.html (U1).
-- ============================================================================

ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS close_reason TEXT
  CHECK (close_reason IS NULL OR close_reason IN ('sweep', 'stale'));
ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS close_reason TEXT
  CHECK (close_reason IS NULL OR close_reason IN ('sweep', 'stale'));

CREATE INDEX IF NOT EXISTS property_listings_removed_reason_idx
  ON property_listings (removed_at) WHERE close_reason = 'sweep';
