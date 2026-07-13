#!/usr/bin/env node
// ============================================================
// One-off import: 6 historical sales on Hayseys Rd, Narre Warren East VIC
// 3804, supplied by the user from an external source (not one of our
// existing ingest feeds). Inserted into property_sales so they power
// Comparable Sales / Street Details for this street.
//
// Upserts on (raw_address, sale_date, sale_price, source) — safe to re-run.
//
// Usage:
//   node scripts/add-hayseys-rd-sales.mjs          # apply
//   node scripts/add-hayseys-rd-sales.mjs --dry     # print rows only
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws'; // Node 20 lacks native WebSocket; realtime-js needs a transport

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

const SUBURB = 'Narre Warren East';
const STATE = 'VIC';
const POSTCODE = '3804';
const SOURCE = 'manual-import';

const ROWS = [
  {
    raw_address: '86 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: 1_900_000,
    sale_date: '2026-04-09',
  },
  {
    raw_address: '15 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: 2_510_000,
    sale_date: '2025-11-11',
    bedrooms: 6,
    bathrooms: 3,
    car_spaces: 3,
  },
  {
    raw_address: '20 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: 550_000,
    sale_date: '2021-04-14',
  },
  {
    raw_address: '70 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: 2_700_000,
    sale_date: '2018-12-18',
    bedrooms: 7,
    bathrooms: 5,
    car_spaces: 6,
  },
  {
    // Price shown as "N/A" (withheld/confidential) in the source.
    raw_address: '130 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: null,
    sale_date: '2013-11-08',
    bathrooms: 2,
    car_spaces: 2,
  },
  {
    // Price shown as "N/A" (withheld/confidential) in the source.
    raw_address: '106 Hayseys Rd, Narre Warren East VIC 3804',
    sale_price: null,
    sale_date: '2012-05-18',
  },
].map((r) => ({
  raw_address: r.raw_address,
  suburb: SUBURB,
  state: STATE,
  postcode: POSTCODE,
  sale_price: r.sale_price,
  sale_date: r.sale_date,
  bedrooms: r.bedrooms ?? null,
  bathrooms: r.bathrooms ?? null,
  car_spaces: r.car_spaces ?? null,
  source: SOURCE,
}));

if (DRY) {
  console.log(JSON.stringify(ROWS, null, 2));
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  realtime: { transport: ws },
});

const { data, error } = await supabase
  .from('property_sales')
  .upsert(ROWS, { onConflict: 'raw_address,sale_date,sale_price,source', ignoreDuplicates: true })
  .select('raw_address, sale_price, sale_date');

if (error) {
  console.error('[add-hayseys-rd-sales] insert error:', error.message);
  process.exit(1);
}

console.log(`Inserted/confirmed ${data?.length ?? 0} row(s):`);
for (const row of data ?? []) {
  console.log(`  ${row.raw_address} — ${row.sale_price ?? 'N/A'} — ${row.sale_date}`);
}
