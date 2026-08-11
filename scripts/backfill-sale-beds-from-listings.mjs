#!/usr/bin/env node
// ============================================================
// Backfill bedrooms / bathrooms / car_spaces on property_sales rows from a
// matching property_listings (preferred) or property_rentals row, by
// normalised raw_address.
//
// Domain's sold-listings Apify actor never returns bedrooms/bathrooms for
// sold items (2026-08-03 comparables-estimate investigation confirmed
// raw_data has nothing to re-parse either — this is the feed's limitation,
// not an ingest bug). A prior on-market listing or rental for the same
// address often does carry beds/baths; this script fills the gap where that
// overlap exists. Measured overlap is modest (~5% of null-bed sold rows,
// even restricted to the last 24 months) — property_listings only holds
// current on-market stock, not a historical archive — so this is a real but
// small win, not a fix for the broader gap. See
// docs/plans/2026-08-03-001-fix-small-block-estimate-skew-plan.md (KTD3).
//
// A column is only filled where it is currently NULL. Existing non-null
// values are never overwritten, so re-runs are idempotent.
//
// Usage:
//   node scripts/backfill-sale-beds-from-listings.mjs          # apply updates
//   node scripts/backfill-sale-beds-from-listings.mjs --dry    # report only
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findBedBathMatches, normaliseAddressKey } from './lib/bed-bath-lookup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no dep) — only fills missing process.env keys.
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env.local).');
  process.exit(1);
}

const DRY = process.argv.includes('--dry');
const PAGE_SIZE = 1000;
const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function fetchSoldPage(offset) {
  const url =
    `${SUPABASE_URL}/rest/v1/property_sales?` +
    `or=(bedrooms.is.null,bathrooms.is.null,car_spaces.is.null)` +
    `&select=id,raw_address,suburb,bedrooms,bathrooms,car_spaces` +
    `&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function updateRow(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/property_sales?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  let scanned = 0;
  let matched = 0;
  let updatedRows = 0;
  let updateErrors = 0;
  const counts = { bedrooms: 0, bathrooms: 0, car_spaces: 0 };

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await fetchSoldPage(offset);
    if (!rows || rows.length === 0) break;
    scanned += rows.length;

    const targets = rows.map((r) => ({ rawAddress: r.raw_address, suburb: r.suburb }));
    const matches = await findBedBathMatches(SUPABASE_URL, SERVICE_KEY, targets);

    for (const row of rows) {
      const m = matches.get(normaliseAddressKey(row.raw_address));
      if (!m) continue;

      const patch = {};
      if (row.bedrooms == null && m.bedrooms != null) { patch.bedrooms = m.bedrooms; counts.bedrooms += 1; }
      if (row.bathrooms == null && m.bathrooms != null) { patch.bathrooms = m.bathrooms; counts.bathrooms += 1; }
      if (row.car_spaces == null && m.car_spaces != null) { patch.car_spaces = m.car_spaces; counts.car_spaces += 1; }
      if (Object.keys(patch).length === 0) continue;

      matched += 1;
      if (!DRY) {
        try {
          await updateRow(row.id, patch);
          updatedRows += 1;
        } catch (err) {
          updateErrors += 1;
          console.error(`Update failed for id=${row.id}: ${err.message}`);
        }
      }
    }

    console.log(`  processed ${offset + rows.length} · matched ${matched}`);
    if (rows.length < PAGE_SIZE) break;
  }

  console.log('');
  console.log(`${DRY ? 'DRY RUN — no writes.' : 'Backfill complete.'}`);
  console.log(`Rows scanned (bedrooms/bathrooms/car_spaces missing): ${scanned}`);
  console.log(`Rows with a listings/rentals match:                  ${matched}`);
  console.log(`Candidates — bedrooms:    ${counts.bedrooms}`);
  console.log(`Candidates — bathrooms:   ${counts.bathrooms}`);
  console.log(`Candidates — car_spaces:  ${counts.car_spaces}`);
  if (!DRY) {
    console.log(`Rows updated: ${updatedRows}${updateErrors ? ` (errors: ${updateErrors})` : ''}`);
    if (updateErrors) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
