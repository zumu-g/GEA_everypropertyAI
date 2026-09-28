import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Migration 015 is applied by hand in the Supabase SQL editor, so the only thing
// we can check in CI is the text: idempotency guards, the constraints later units
// rely on, and the RLS posture. Whitespace is collapsed so formatting is free.
const raw = readFileSync(
  join(__dirname, '..', 'migrations', '015_listing_lifecycle_price_history_stats.sql'),
  'utf8',
);
const sql = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');

const NEW_TABLES = ['listing_price_history', 'feed_runs', 'suburb_stats_history'];

describe('migration 015', () => {
  it('guards every CREATE TABLE / CREATE INDEX / ADD COLUMN with IF NOT EXISTS', () => {
    expect(sql.match(/CREATE TABLE(?! IF NOT EXISTS)/gi)).toBeNull();
    expect(sql.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/gi)).toBeNull();
    expect(sql.match(/ADD COLUMN(?! IF NOT EXISTS)/gi)).toBeNull();
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/gi)).toHaveLength(NEW_TABLES.length);
  });

  it('adds lifecycle_status with the four-value CHECK on both listing tables', () => {
    const re = /ALTER TABLE (property_listings|property_rentals) ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK \(lifecycle_status IN \('active', 'under_offer', 'sold', 'withdrawn'\)\)/g;
    expect(sql.match(re)).toHaveLength(2);
  });

  it('adds sale_method with the three-value CHECK on sales listings only', () => {
    expect(sql).toMatch(
      /ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS sale_method TEXT NOT NULL DEFAULT 'unknown' CHECK \(sale_method IN \('auction', 'private', 'unknown'\)\)/,
    );
    expect(sql).not.toMatch(/ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS sale_method/);
    expect(sql).toMatch(/ALTER TABLE property_listings ADD COLUMN IF NOT EXISTS auction_date DATE/);
    expect(sql).toMatch(/ALTER TABLE property_rentals ADD COLUMN IF NOT EXISTS leased_at TIMESTAMPTZ/);
  });

  it('adds the shared lifecycle columns to both listing tables', () => {
    for (const col of [
      'miss_count SMALLINT NOT NULL DEFAULT 0',
      'miss_marked_at TIMESTAMPTZ',
      'removed_at TIMESTAMPTZ',
      'campaign_started_at TIMESTAMPTZ NOT NULL DEFAULT now()',
      'listed_date_source TEXT',
      'enquiry_count INTEGER',
      'view_count INTEGER',
    ]) {
      for (const table of ['property_listings', 'property_rentals']) {
        expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col}`);
      }
    }
  });

  it('backfills campaign_started_at from created_at only where it still holds the default', () => {
    const re = /UPDATE (property_listings|property_rentals) SET campaign_started_at = created_at WHERE campaign_started_at > created_at/g;
    expect(sql.match(re)).toHaveLength(2);
  });

  it('constrains table_name and period_type and keys suburb_stats_history on its natural key', () => {
    expect(sql).toMatch(/table_name TEXT NOT NULL CHECK \(table_name IN \('listings', 'rentals'\)\)/);
    expect(sql).toMatch(/period_type TEXT NOT NULL CHECK \(period_type IN \('week', 'month'\)\)/);
    expect(sql).toMatch(/UNIQUE \(suburb, state, period_type, period_start\)/);
  });

  it('creates the price-history, feed-run and sweep indexes', () => {
    expect(sql).toMatch(/ON listing_price_history \(table_name, raw_address, source, observed_at DESC\)/);
    expect(sql).toMatch(/ON feed_runs \(source, run_start DESC\)/);
    for (const table of ['property_listings', 'property_rentals']) {
      expect(sql).toMatch(new RegExp(`ON ${table} \\(suburb, state\\) WHERE active`));
      expect(sql).toMatch(new RegExp(`ON ${table} \\(source, suburb, active, last_seen_at\\)`));
    }
  });

  it('enables RLS with a guarded service-role policy on each new table', () => {
    for (const table of NEW_TABLES) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(
        `DO $$ BEGIN CREATE POLICY "Service role full access" ON ${table} FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
    }
  });
});
