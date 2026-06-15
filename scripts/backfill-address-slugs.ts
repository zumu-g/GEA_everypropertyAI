#!/usr/bin/env npx tsx
/**
 * Backfill null `address_slug` values on property_sales, property_listings,
 * and property_rentals by re-computing the slug from `raw_address`.
 *
 * Usage:
 *   npx -y tsx scripts/backfill-address-slugs.ts [--dry] [--help]
 *
 * Options:
 *   --dry   Compute and count only; no writes.
 *   --help  Print usage and exit.
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

// ── --help guard ─────────────────────────────────────────────────────────────
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
backfill-address-slugs — populate null address_slug rows from raw_address.

Usage:
  npx -y tsx scripts/backfill-address-slugs.ts [--dry] [--help]

Options:
  --dry   Compute slugs and report counts only; no writes to the database.
  --help  Print this message and exit.

Env vars (loaded from .env.local):
  NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   — Service role key (bypasses RLS)

Tables processed:
  property_sales
  property_listings
  property_rentals
`);
  process.exit(0);
}

// ── Imports ───────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - 'ws' ships no bundled type declarations; only used as the realtime transport on Node <22
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

// Import address utilities directly (relative paths — tsx won't resolve @/ aliases
// without tsconfig path config; domain-mapper itself uses @/ so we bypass it).
// NOTE: address.ts imports from '@/types/property' and '@/data/vic-suburbs'.
// We therefore cherry-pick only what we need and inline slugForRawAddress.
import { parseAddress, toSlug } from '../src/lib/utils/address.js';

// ── slugForRawAddress (mirrors domain-mapper.ts exactly) ─────────────────────
function slugForRawAddress(raw: string): string | null {
  try {
    const slug = toSlug(parseAddress(raw));
    return slug || null;
  } catch {
    return null;
  }
}

// ── .env.local loader ────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // .env.local is optional; env vars may already be set.
}

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.argv.includes('--dry');
const PAGE_SIZE = 1000;
const BATCH_SIZE = 50;

const TABLES = ['property_sales', 'property_listings', 'property_rentals'] as const;
type TableName = (typeof TABLES)[number];

// ── Supabase client ───────────────────────────────────────────────────────────
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set ' +
      '(via .env.local or environment).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chunk an array into sub-arrays of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Per-table backfill ────────────────────────────────────────────────────────

interface TableSummary {
  table: TableName;
  scanned: number;
  updated: number;
  unparseable: number;
  samples: Array<{ raw_address: string; slug: string | null }>;
}

async function backfillTable(table: TableName): Promise<TableSummary> {
  let scanned = 0;
  let updated = 0;
  let unparseable = 0;
  const samples: Array<{ raw_address: string; slug: string | null }> = [];

  let lastId: string | null = null; // UUID cursor
  let hasMore = true;

  while (hasMore) {
    // Cursor-based pagination by id to avoid offset drift as rows are updated.
    let q = supabase
      .from(table)
      .select('id, raw_address')
      .is('address_slug', null)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q;

    if (error) throw new Error(`[${table}] select error: ${error.message}`);
    if (!data || data.length === 0) break;

    scanned += data.length;
    hasMore = data.length === PAGE_SIZE;
    lastId = data[data.length - 1].id as string;

    // Compute slugs for this page.
    const toUpdate: Array<{ id: string; slug: string }> = [];

    for (const row of data) {
      const raw = (row.raw_address as string | null) ?? '';
      const slug = raw ? slugForRawAddress(raw) : null;

      if (!slug) {
        unparseable++;
        if (samples.length < 5) samples.push({ raw_address: raw, slug: null });
        continue;
      }

      if (samples.length < 5) samples.push({ raw_address: raw, slug });
      toUpdate.push({ id: row.id as string, slug });
    }

    if (DRY || toUpdate.length === 0) continue;

    // Batch updates in chunks of BATCH_SIZE.
    for (const batch of chunk(toUpdate, BATCH_SIZE)) {
      await Promise.all(
        batch.map(({ id, slug }) =>
          supabase
            .from(table)
            .update({ address_slug: slug })
            .eq('id', id)
            .then(({ error: err }) => {
              if (err) throw new Error(`[${table}] update id=${id} error: ${err.message}`);
              updated++;
            })
        )
      );
    }
  }

  // In dry mode the "would update" count is toUpdate accumulation — re-derive.
  if (DRY) {
    // We counted unparseable above; the rest are computable.
    updated = scanned - unparseable;
  }

  return { table, scanned, updated, unparseable, samples };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nbackfill-address-slugs — ${DRY ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  const summaries: TableSummary[] = [];

  for (const table of TABLES) {
    process.stdout.write(`  Processing ${table} ... `);
    const summary = await backfillTable(table);
    summaries.push(summary);
    console.log(`done.`);
  }

  console.log('\n── Summary ──────────────────────────────────────────────────');
  for (const s of summaries) {
    console.log(`\n${s.table}:`);
    console.log(`  Scanned:      ${s.scanned}`);
    console.log(`  ${DRY ? 'Would update' : 'Updated'}:  ${s.updated}`);
    console.log(`  Unparseable:  ${s.unparseable}`);
    if (s.samples.length > 0) {
      console.log(`  Samples (up to 5):`);
      for (const sample of s.samples) {
        console.log(`    ${JSON.stringify(sample.raw_address)} → ${sample.slug ?? '(null)'}`);
      }
    }
  }
  console.log('\n─────────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
