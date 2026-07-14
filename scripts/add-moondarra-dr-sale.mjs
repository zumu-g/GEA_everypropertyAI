#!/usr/bin/env node
// ============================================================
// One-off import: 112 Moondarra Drive, Berwick VIC 3806 sale, supplied by
// the user from a realestate.com.au listing screenshot (not one of our
// existing ingest feeds). Inserted into property_sales so it powers
// Comparable Sales / Street Details for this street.
//
// Upserts on (raw_address, sale_date, sale_price, source) — safe to re-run.
//
// Usage:
//   node scripts/add-moondarra-dr-sale.mjs          # apply
//   node scripts/add-moondarra-dr-sale.mjs --dry     # print row only
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

const ROW = {
  raw_address: '112 Moondarra Drive, Berwick VIC 3806',
  suburb: 'Berwick',
  state: 'VIC',
  postcode: '3806',
  sale_price: 885_000,
  sale_date: '2026-06-10',
  bedrooms: 3,
  bathrooms: 2,
  car_spaces: 4,
  land_area_sqm: 620,
  property_type: 'House',
  agency_name: 'Just Real Estate - Casey Cardinia',
  agent_name: 'Barry Erlenwein',
  source: 'manual-import',
};

if (DRY) {
  console.log(JSON.stringify(ROW, null, 2));
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  realtime: { transport: ws },
});

const { data, error } = await supabase
  .from('property_sales')
  .upsert([ROW], { onConflict: 'raw_address,sale_date,sale_price,source', ignoreDuplicates: true })
  .select('raw_address, sale_price, sale_date');

if (error) {
  console.error('[add-moondarra-dr-sale] insert error:', error.message);
  process.exit(1);
}

console.log(`Inserted/confirmed ${data?.length ?? 0} row(s):`);
for (const row of data ?? []) {
  console.log(`  ${row.raw_address} — ${row.sale_price ?? 'N/A'} — ${row.sale_date}`);
}
