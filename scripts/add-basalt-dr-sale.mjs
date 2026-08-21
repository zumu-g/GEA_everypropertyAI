#!/usr/bin/env node
// ============================================================
// One-off import: 14 Basalt Drive, Clyde North VIC 3978 sale, from the
// Domain "market trends" panel (12 Basalt Dr investigation, 2026-08-18).
// This sale was missed by the sold feeds entirely — it is the direct
// neighbour comp for 12 Basalt and the street's most recent sale.
//
// Coordinates are the adjacent 12 Basalt Dr's (next door, ~20m error —
// immaterial for km-scale comp distance weighting).
//
// Upserts on (raw_address, sale_date, sale_price, source) — safe to re-run.
//
// Usage:
//   node scripts/add-basalt-dr-sale.mjs          # apply
//   node scripts/add-basalt-dr-sale.mjs --dry    # print row only
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

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

const ROW = {
  raw_address: '14 Basalt Drive, Clyde North VIC 3978',
  suburb: 'Clyde North',
  state: 'VIC',
  postcode: '3978',
  sale_price: 780_000,
  sale_date: '2026-05-09',
  bedrooms: 4,
  bathrooms: 2,
  car_spaces: 2,
  land_area_sqm: 399,
  property_type: 'House',
  latitude: -38.083785,
  longitude: 145.361322,
  source: 'manual-import',
};

if (DRY) {
  console.log(JSON.stringify(ROW, null, 2));
  process.exit(0);
}

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/property_sales?on_conflict=raw_address,sale_date,sale_price,source`,
  {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify([ROW]),
  },
);
if (!res.ok) {
  console.error('[add-basalt-dr-sale] insert error:', res.status, (await res.text()).slice(0, 300));
  process.exit(1);
}
const data = await res.json();
console.log(`Inserted/confirmed ${data.length} row(s):`);
for (const row of data) console.log(`  ${row.raw_address} — ${row.sale_price} — ${row.sale_date}`);
