#!/usr/bin/env node
// ============================================================
// Backfill Casey/Cardinia sold + on-market properties exported from the GEA
// legacy DB (source = "gea-legacy-db") into Supabase — dedup-safe.
//
// The exported files contain ONLY properties missing from everypropertyAI, but
// the DB unique constraints are source-scoped:
//   property_sales    (raw_address, sale_date, sale_price, source)
//   property_listings (raw_address, source)
// so a property already stored under source="domain-apify" would NOT be caught
// by an upsert of source="gea-legacy-db" rows. We therefore pre-dedup at the
// ADDRESS level against existing DB rows (any source) before inserting. This
// also makes re-runs idempotent (a second run sees its own rows as present).
//
// Usage:
//   node scripts/ingest-legacy-backfill.mjs sold      <path-to-missing-from-ep-sold.json>     [--dry]
//   node scripts/ingest-legacy-backfill.mjs on-market <path-to-missing-from-ep-onmarket.json> [--dry]
//   node scripts/ingest-legacy-backfill.mjs --purge   [--dry]   # delete implausible price outliers
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const SOURCE = 'gea-legacy-db';
const MAX_PLAUSIBLE = 50_000_000;     // upper price sanity bound (mirrors the API filter)
const MIN_ONMARKET_PRICE = 10_000;    // below this, on-market price is a placeholder ($0/$1)

// ── Service-area guard — mirror of SERVICE_AREA_SUBURBS in src/lib/utils/service-area.ts ──
const SERVICE_AREA_SUBURBS = new Set([
  // Casey
  'berwick', 'blind bight', 'botanic ridge', 'cannons creek', 'clyde', 'clyde north', 'cranbourne',
  'cranbourne east', 'cranbourne north', 'cranbourne south', 'cranbourne west', 'devon meadows',
  'doveton', 'endeavour hills', 'eumemmerring', 'five ways', 'hallam', 'hampton park', 'harkaway',
  'junction village', 'lynbrook', 'lyndhurst', 'lysterfield south', 'narre warren', 'narre warren east',
  'narre warren north', 'narre warren south', 'pearcedale', 'sandhurst', 'skye', 'tooradin', 'warneet',
  // Cardinia
  'athlone', 'avonsleigh', 'bayles', 'beaconsfield', 'beaconsfield upper', 'bunyip', 'bunyip north',
  'caldermeade', 'cardinia', 'catani', 'clematis', 'cockatoo', 'cora lynn', 'dalmore', 'dewhurst',
  'emerald', 'garfield', 'garfield north', 'gembrook', 'guys hill', 'heath hill', 'iona', 'koo wee rup',
  'koo wee rup north', 'lang lang', 'lang lang east', 'maryknoll', 'modella', 'monomeith', 'mount burnett',
  'nangana', 'nar nar goon', 'nar nar goon north', 'officer', 'officer south', 'pakenham', 'pakenham south',
  'pakenham upper', 'ripplebrook', 'rythdale', 'tonimbuk', 'toomuc valley', 'tynong', 'tynong north',
  'vervale', 'yannathan',
]);
const isServiceAreaSuburb = (s) => !!s && SERVICE_AREA_SUBURBS.has(String(s).trim().toLowerCase());

// ── Helpers (mirror src/lib/utils/address.ts + ingest-domain-apify.mjs) ──
function titleCaseSuburb(s) {
  if (s == null) return null;
  const out = String(s).trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')).join(' ');
  return out || null;
}
function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function smallint(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

// Street-type abbreviation expansion (mirrors the abbreviation map in
// src/lib/utils/address.ts) so "12 Smith St" matches "12 Smith Street".
const STREET_ABBR = {
  st: 'street', rd: 'road', dr: 'drive', drv: 'drive', ave: 'avenue', av: 'avenue',
  ct: 'court', crt: 'court', pl: 'place', cres: 'crescent', cr: 'crescent', cl: 'close',
  blvd: 'boulevard', bvd: 'boulevard', tce: 'terrace', ter: 'terrace', pde: 'parade',
  hwy: 'highway', ln: 'lane', gr: 'grove', grv: 'grove', way: 'way', cct: 'circuit',
  cir: 'circuit', sq: 'square', wy: 'way', esp: 'esplanade', mw: 'mews', rise: 'rise',
};
/** Normalised address key for cross-source dedup. */
function normAddr(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase();
  s = s.replace(/[.,]/g, ' ').replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.split(' ').map((w) => STREET_ABBR[w] || w).join(' ');
  return s;
}

// ── Per-category config ──
const CATEGORIES = {
  sold: {
    table: 'property_sales',
    conflict: 'raw_address,sale_date,sale_price,source',
    existingSelect: 'raw_address,sale_date',
    keyOfExisting: (r) => `${normAddr(r.raw_address)}|${r.sale_date || ''}`,
    map(o) {
      const price = num(o.price);
      if (price == null || price <= 0 || price > MAX_PLAUSIBLE) return null; // sold needs a sane price
      const rawAddress = (o.address ?? '').trim();
      if (!rawAddress) return null;
      const sale_date = o.sold_date && String(o.sold_date).trim() ? String(o.sold_date).trim() : null;
      return {
        row: {
          raw_address: rawAddress,
          suburb: titleCaseSuburb(o.suburb),
          state: (o.state ?? 'VIC').toUpperCase(),
          postcode: o.postcode ?? null,
          land_area_sqm: num(o.land_size),
          property_type: o.property_type ?? null,
          bedrooms: smallint(o.bedrooms),
          bathrooms: smallint(o.bathrooms),
          car_spaces: smallint(o.car_spaces),
          sale_price: price,
          sale_date,
          latitude: num(o.lat),
          longitude: num(o.lng),
          listing_url: (o.url && String(o.url).trim()) || null,
          image_url: (o.image_url && String(o.image_url).trim()) || null,
          source: SOURCE,
        },
        key: `${normAddr(rawAddress)}|${sale_date || ''}`,
      };
    },
  },

  'on-market': {
    table: 'property_listings',
    conflict: 'raw_address,source',
    existingSelect: 'raw_address',
    keyOfExisting: (r) => normAddr(r.raw_address),
    map(o) {
      const rawAddress = (o.address ?? '').trim();
      if (!rawAddress) return null;
      const p = num(o.price);
      // Placeholder $0/$1 prices → store null rather than a bogus figure; keep the listing for volume.
      const clean = p != null && p >= MIN_ONMARKET_PRICE && p <= MAX_PLAUSIBLE ? p : null;
      return {
        row: {
          raw_address: rawAddress,
          suburb: titleCaseSuburb(o.suburb),
          state: (o.state ?? 'VIC').toUpperCase(),
          postcode: o.postcode ?? null,
          display_price: null,
          price_low: clean,
          price_high: clean,
          status: null,
          bedrooms: smallint(o.bedrooms),
          bathrooms: smallint(o.bathrooms),
          car_spaces: smallint(o.car_spaces),
          land_area_sqm: num(o.land_size),
          property_type: o.property_type ?? null,
          latitude: num(o.lat),
          longitude: num(o.lng),
          listing_url: (o.url && String(o.url).trim()) || null,
          image_url: (o.image_url && String(o.image_url).trim()) || null,
          source: SOURCE,
          last_seen_at: new Date().toISOString(),
          active: true,
        },
        key: normAddr(rawAddress),
      };
    },
  },
};

// ── PostgREST helpers ──
function authHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

/** Collapse rows sharing the same on_conflict key, keeping the last (PostgREST rejects dup conflict targets in one batch). */
function dedupeByConflict(rows, conflict) {
  const cols = conflict.split(',').map((c) => c.trim());
  const byKey = new Map();
  for (const row of rows) {
    const key = cols.map((c) => String(row[c] ?? '')).join(' ');
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function upsert(table, conflict, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Fetch all rows' chosen columns, paged, → Set of normalised keys. */
async function fetchExistingKeys(table, select, keyOf) {
  const keys = new Set();
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
      headers: authHeaders({ Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' }),
    });
    if (!res.ok) throw new Error(`fetch existing ${table} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) keys.add(keyOf(r));
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  return keys;
}

async function purge(dry) {
  console.log('Purging implausible price outliers from property_sales...');
  for (const filter of [`sale_price=gt.${MAX_PLAUSIBLE}`, 'sale_price=lte.0']) {
    // Count first
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/property_sales?select=id&${filter}`, {
      headers: authHeaders({ Prefer: 'count=exact', Range: '0-0' }),
    });
    const range = cRes.headers.get('content-range') || '*/0';
    const count = range.split('/')[1];
    console.log(`  ${filter} → ${count} row(s)${dry ? ' (dry, not deleted)' : ''}`);
    if (dry) continue;
    const dRes = await fetch(`${SUPABASE_URL}/rest/v1/property_sales?${filter}`, {
      method: 'DELETE',
      headers: authHeaders({ Prefer: 'return=minimal' }),
    });
    if (!dRes.ok) throw new Error(`delete ${filter} HTTP ${dRes.status}: ${(await dRes.text()).slice(0, 200)}`);
  }
  console.log('Purge done.');
}

// ── Main ──
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const positional = args.filter((a) => !a.startsWith('--'));
const [categoryArg, filePath] = positional;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

(async () => {
  if (args.includes('--purge')) {
    await purge(dry);
    if (!categoryArg) return;
  }

  const cat = CATEGORIES[categoryArg];
  if (!cat || !filePath) {
    console.error('Usage: node scripts/ingest-legacy-backfill.mjs <sold|on-market> <file.json> [--dry]');
    console.error('       node scripts/ingest-legacy-backfill.mjs --purge [--dry]');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) { console.error('Expected a JSON array'); process.exit(1); }
  console.log(`Loaded ${data.length} ${categoryArg} records from ${filePath}`);

  let badRow = 0, outOfArea = 0;
  const mapped = [];
  for (const o of data) {
    const m = cat.map(o);
    if (!m) { badRow++; continue; }
    if (!isServiceAreaSuburb(m.row.suburb)) { outOfArea++; continue; }
    mapped.push(m);
  }

  console.log('Fetching existing DB keys for dedup...');
  const existing = await fetchExistingKeys(cat.table, cat.existingSelect, cat.keyOfExisting);
  console.log(`  ${existing.size} existing key(s) in ${cat.table}`);

  let alreadyPresent = 0;
  const seenIncoming = new Set();
  const toUpsert = [];
  for (const m of mapped) {
    if (existing.has(m.key)) { alreadyPresent++; continue; }
    if (seenIncoming.has(m.key)) { alreadyPresent++; continue; } // dup within incoming file
    seenIncoming.add(m.key);
    toUpsert.push(m.row);
  }

  const deduped = dedupeByConflict(toUpsert, cat.conflict);

  console.log(
    `\nSummary (${categoryArg}):\n` +
    `  parsed:               ${data.length}\n` +
    `  dropped (bad/price):  ${badRow}\n` +
    `  skipped out-of-area:  ${outOfArea}\n` +
    `  already present:      ${alreadyPresent}\n` +
    `  to insert:            ${deduped.length}` + (dry ? '  (DRY RUN — nothing written)' : '')
  );

  if (dry || deduped.length === 0) return;

  for (let i = 0; i < deduped.length; i += 500) {
    await upsert(cat.table, cat.conflict, deduped.slice(i, i + 500));
    console.log(`  upserted ${Math.min(i + 500, deduped.length)}/${deduped.length}`);
  }
  console.log(`\nDone. Inserted ${deduped.length} row(s) into ${cat.table}.`);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
