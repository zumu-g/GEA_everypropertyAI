/**
 * One-off importer: load a G-NAF Core CSV into the `addresses` table,
 * filtered to Casey/Cardinia postcodes. Re-runnable each quarterly G-NAF release.
 *
 * G-NAF Core (free, Geoscape via data.gov.au) is a single CSV with one row per
 * address. This parser is header-driven so it tolerates column-name variation.
 *
 * Usage (from the propertyiq directory):
 *   node scripts/import-gnaf.mjs /path/to/gnaf-core.csv
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
 * (or the environment). Streams the file, so very large CSVs are fine.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// ── Casey / Cardinia postcodes (keep in sync with src/data/casey-cardinia.ts) ──
const POSTCODES = new Set([
  '3800', '3802', '3803', '3804', '3805', '3806', '3807', '3808', '3809',
  '3810', '3811', '3812', '3813', '3814', '3815', '3816',
  '3977', '3978', '3979', '3980',
]);

// ── Load env from .env.local if not already set ──
function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node scripts/import-gnaf.mjs /path/to/gnaf-core.csv');
  process.exit(1);
}

// ── Helpers ──
function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Mirrors src/lib/utils/address.ts toSlug()
function toSlug(parts) {
  return parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function findIdx(headers, candidates) {
  for (const name of candidates) {
    const i = headers.findIndex((h) => h.toLowerCase() === name);
    if (i >= 0) return i;
  }
  // loose contains match
  for (const name of candidates) {
    const i = headers.findIndex((h) => h.toLowerCase().includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

async function upsertChunk(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/addresses`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`  upsert error ${res.status}: ${txt.slice(0, 200)}`);
  }
}

// ── Stream + import ──
let headers = null;
let col = {};
let scanned = 0;
let matched = 0;
let batch = [];
const CHUNK = 500;

const rl = readline.createInterface({
  input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

console.log(`Importing G-NAF from ${csvPath} (Casey/Cardinia postcodes only)…`);

for await (const line of rl) {
  if (!line.trim()) continue;
  if (!headers) {
    headers = splitCsv(line).map((h) => h.replace(/^["']|["']$/g, '').trim());
    col = {
      number: findIdx(headers, ['number_first', 'house_number', 'number', 'address_number']),
      street: findIdx(headers, ['street_name', 'street']),
      stype: findIdx(headers, ['street_type', 'street_type_code']),
      suburb: findIdx(headers, ['locality_name', 'locality', 'suburb']),
      state: findIdx(headers, ['state_abbreviation', 'state']),
      postcode: findIdx(headers, ['postcode', 'post_code']),
      lat: findIdx(headers, ['latitude', 'lat']),
      lng: findIdx(headers, ['longitude', 'lon', 'lng']),
      label: findIdx(headers, ['address_label', 'full_address', 'address']),
    };
    if (col.suburb < 0 || col.postcode < 0) {
      console.error('Could not locate suburb/postcode columns. Headers:', headers.join(', '));
      process.exit(1);
    }
    continue;
  }

  scanned++;
  const c = splitCsv(line);
  const get = (i) => (i >= 0 ? (c[i] ?? '').replace(/^["']|["']$/g, '').trim() : '');
  const postcode = get(col.postcode);
  if (!POSTCODES.has(postcode)) continue;

  const number = get(col.number);
  const street = get(col.street);
  const stype = get(col.stype);
  const suburb = get(col.suburb);
  const state = (get(col.state) || 'VIC').toUpperCase();
  const lat = parseFloat(get(col.lat));
  const lng = parseFloat(get(col.lng));
  const label = get(col.label) || [number, street, stype, suburb, state, postcode].filter(Boolean).join(' ');

  const slug = toSlug([number, street, stype, suburb, state, postcode]);
  if (!slug) continue;

  batch.push({
    address_slug: slug,
    raw_address: label,
    street_number: number || null,
    street_name: street || null,
    street_type: stype || null,
    suburb: suburb || null,
    state,
    postcode: postcode || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    source: 'gnaf',
  });
  matched++;

  if (batch.length >= CHUNK) {
    await upsertChunk(batch);
    batch = [];
    if (matched % 5000 === 0) console.log(`  …${matched} matched / ${scanned} scanned`);
  }
}

if (batch.length > 0) await upsertChunk(batch);

console.log(`Done. Scanned ${scanned} rows, imported ${matched} Casey/Cardinia addresses.`);
