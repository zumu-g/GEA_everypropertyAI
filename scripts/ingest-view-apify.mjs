#!/usr/bin/env node
// ============================================================
// Ingest view.com.au (Apify: abotapi/view-com-au-scraper) into Supabase.
//
// ALTERNATIVE DATA SOURCE to Domain. Domain.com.au hard-blocks scrapers
// (HTTP 403 "Access Denied") for extended periods; view.com.au is a separate
// portal that is not subject to that block, and its records are RICHER:
// they carry soldAt (sale date), soldPrice, location.lat/lon (coordinates —
// which Domain's sold rows lack) and a gnafId. Same tables + dedup keys as the
// Domain feed, so the two sources merge cleanly (source = 'view-apify').
//
// Usage:
//   node scripts/ingest-view-apify.mjs <category> <datasetId> [<datasetId> ...]
//   node scripts/ingest-view-apify.mjs <category> --run
//   <category> = sold | on-market | rent
//
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   APIFY_API_TOKEN. Optional: MAXLISTINGS (default 600), MAXPAGES (default 1).
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
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const SOURCE = 'view-apify';
const ACTOR_ID = '7iwbnQ1XMHHObYxTv'; // abotapi/view-com-au-scraper

// City of Casey + Shire of Cardinia ONLY — {suburb, postcode}.
const SUBURBS = [
  // Casey
  ['Berwick', '3806'], ['Harkaway', '3806'], ['Narre Warren', '3805'], ['Narre Warren South', '3805'],
  ['Narre Warren North', '3804'], ['Narre Warren East', '3804'], ['Cranbourne', '3977'],
  ['Cranbourne East', '3977'], ['Cranbourne North', '3977'], ['Cranbourne West', '3977'], ['Hallam', '3803'],
  ['Hampton Park', '3976'], ['Doveton', '3177'], ['Endeavour Hills', '3802'], ['Lynbrook', '3975'],
  ['Lyndhurst', '3975'], ['Clyde', '3978'], ['Clyde North', '3978'], ['Lysterfield South', '3156'],
  // Cardinia
  ['Pakenham', '3810'], ['Pakenham Upper', '3810'], ['Officer', '3809'], ['Officer South', '3809'],
  ['Beaconsfield', '3807'], ['Beaconsfield Upper', '3808'], ['Guys Hill', '3807'], ['Dewhurst', '3808'],
  ['Emerald', '3782'], ['Cockatoo', '3781'], ['Gembrook', '3783'], ['Koo Wee Rup', '3981'], ['Dalmore', '3981'],
  ['Nar Nar Goon', '3812'], ['Maryknoll', '3812'], ['Bunyip', '3815'], ['Garfield', '3814'], ['Garfield North', '3814'],
  ['Tynong', '3813'], ['Tynong North', '3813'],
  ['Cardinia', '3978'], ['Lang Lang', '3984'],
].map(([suburb, postcode]) => ({ suburb, state: 'VIC', postcode }));

// Service-area guard — mirror of SERVICE_AREA_SUBURBS in src/lib/utils/service-area.ts.
const SERVICE_AREA_SUBURBS = new Set([
  'berwick', 'blind bight', 'botanic ridge', 'cannons creek', 'clyde', 'clyde north', 'cranbourne',
  'cranbourne east', 'cranbourne north', 'cranbourne south', 'cranbourne west', 'devon meadows',
  'doveton', 'endeavour hills', 'eumemmerring', 'five ways', 'hallam', 'hampton park', 'harkaway',
  'junction village', 'lynbrook', 'lyndhurst', 'lysterfield south', 'narre warren', 'narre warren east',
  'narre warren north', 'narre warren south', 'pearcedale', 'sandhurst', 'skye', 'tooradin', 'warneet',
  'athlone', 'avonsleigh', 'bayles', 'beaconsfield', 'beaconsfield upper', 'bunyip', 'bunyip north',
  'caldermeade', 'cardinia', 'catani', 'clematis', 'cockatoo', 'cora lynn', 'dalmore', 'dewhurst',
  'emerald', 'garfield', 'garfield north', 'gembrook', 'guys hill', 'heath hill', 'iona', 'koo wee rup',
  'koo wee rup north', 'lang lang', 'lang lang east', 'maryknoll', 'modella', 'monomeith', 'mount burnett',
  'nangana', 'nar nar goon', 'nar nar goon north', 'officer', 'officer south', 'pakenham', 'pakenham south',
  'pakenham upper', 'ripplebrook', 'rythdale', 'tonimbuk', 'toomuc valley', 'tynong', 'tynong north',
  'vervale', 'yannathan',
]);
const isServiceAreaSuburb = (s) => !!s && SERVICE_AREA_SUBURBS.has(String(s).trim().toLowerCase());

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function smallint(v) { const n = typeof v === 'number' ? v : Number(v); return Number.isInteger(n) ? n : null; }
function titleCaseSuburb(s) {
  if (s == null) return null;
  const out = String(s).trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')).join(' ');
  return out || null;
}
function agentNameOf(it) {
  const names = (it.agents ?? []).map((a) => [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim()).filter(Boolean);
  return names.length ? names.join(', ') : null;
}
function imageOf(it) { return it.heroImageUrl || it.images?.[0]?.url || null; }
// "$580 per week" / "$620 pw" / "$520 - $560 pw" → 580 / 620 / 520 (lowest), or null
function parseWeeklyRent(display) {
  if (!display) return null;
  const amts = [...String(display).matchAll(/\$\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
  return amts.length ? Math.min(...amts) : null;
}
function soldDate(it) { return typeof it.soldAt === 'string' ? it.soldAt.split(' ')[0].split('T')[0] : null; }

// ── Per-category config ───────────────────────────────────────────────────────

const CATEGORIES = {
  sold: {
    table: 'property_sales',
    conflict: 'raw_address,sale_date,sale_price,source',
    listingType: 'sold',
    map(it) {
      const loc = it.address ?? {};
      const rawAddress = (loc.full ?? '').trim();
      const salePrice = it.isSoldPriceHidden ? null : num(it.soldPrice);
      if (!rawAddress || salePrice == null) return null; // sold needs a price
      return {
        raw_address: rawAddress,
        suburb: titleCaseSuburb(loc.suburb),
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        land_area_sqm: num(it.landSize ?? it.landArea),
        property_type: it.propertyType ?? null,
        bedrooms: smallint(it.features?.bedrooms),
        bathrooms: smallint(it.features?.bathrooms),
        car_spaces: smallint(it.features?.carSpaces),
        sale_price: salePrice,
        sale_date: soldDate(it),
        latitude: num(it.location?.lat),
        longitude: num(it.location?.lon),
        agency_name: it.agency?.name?.trim() || null,
        agent_name: agentNameOf(it),
        listing_url: it.listingUrl?.trim() || null,
        image_url: imageOf(it),
        source: SOURCE,
      };
    },
  },

  'on-market': {
    table: 'property_listings',
    conflict: 'raw_address,source',
    listingType: 'buy',
    map(it) {
      const loc = it.address ?? {};
      const rawAddress = (loc.full ?? '').trim();
      if (!rawAddress) return null;
      const p = it.price ?? {};
      return {
        raw_address: rawAddress,
        suburb: titleCaseSuburb(loc.suburb),
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        display_price: p.display ?? null,
        price_low: num(p.min) ?? num(p.value),
        price_high: num(p.max) ?? num(p.value),
        status: it.status ?? null,
        bedrooms: smallint(it.features?.bedrooms),
        bathrooms: smallint(it.features?.bathrooms),
        car_spaces: smallint(it.features?.carSpaces),
        land_area_sqm: num(it.landSize ?? it.landArea),
        property_type: it.propertyType ?? null,
        latitude: num(it.location?.lat),
        longitude: num(it.location?.lon),
        agency_name: it.agency?.name?.trim() || null,
        agent_name: agentNameOf(it),
        listing_url: it.listingUrl?.trim() || null,
        image_url: imageOf(it),
        source: SOURCE,
      };
    },
  },

  rent: {
    table: 'property_rentals',
    conflict: 'raw_address,source',
    listingType: 'rent',
    map(it) {
      const loc = it.address ?? {};
      const rawAddress = (loc.full ?? '').trim();
      if (!rawAddress) return null;
      const p = it.price ?? {};
      return {
        raw_address: rawAddress,
        suburb: titleCaseSuburb(loc.suburb),
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        display_price: p.display ?? null,
        weekly_rent: num(it.rentPerWeek) ?? num(p.value) ?? num(p.min) ?? parseWeeklyRent(p.display),
        status: it.status ?? null,
        bedrooms: smallint(it.features?.bedrooms),
        bathrooms: smallint(it.features?.bathrooms),
        car_spaces: smallint(it.features?.carSpaces),
        land_area_sqm: num(it.landSize ?? it.landArea),
        property_type: it.propertyType ?? null,
        latitude: num(it.location?.lat),
        longitude: num(it.location?.lon),
        agency_name: it.agency?.name?.trim() || null,
        agent_name: agentNameOf(it),
        listing_url: it.listingUrl?.trim() || null,
        image_url: imageOf(it),
        source: SOURCE,
      };
    },
  },
};

// ── Supabase upsert (PostgREST; merge-duplicates → no dupes on re-run) ─────────

function dedupeByConflict(rows, conflict) {
  const cols = conflict.split(',').map((c) => c.trim());
  const byKey = new Map();
  for (const row of rows) byKey.set(cols.map((c) => String(row[c] ?? '')).join(' '), row);
  return [...byKey.values()];
}

async function upsert(table, conflict, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function ingestDataset(cat, datasetId) {
  const PAGE = 1000;
  let offset = 0, mapped = 0, skipped = 0;
  for (;;) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&offset=${offset}&limit=${PAGE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Apify items HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    const rows = [];
    for (const it of items) {
      const row = cat.map(it);
      if (!row) { skipped++; continue; }
      if (!isServiceAreaSuburb(row.suburb)) { skipped++; continue; }
      rows.push(row);
    }
    const deduped = dedupeByConflict(rows, cat.conflict);
    for (let i = 0; i < deduped.length; i += 500) {
      await upsert(cat.table, cat.conflict, deduped.slice(i, i + 500));
    }
    mapped += deduped.length;
    offset += items.length;
    console.log(`  [${datasetId}] processed ${offset} · mapped ${mapped} · skipped ${skipped}`);
    if (items.length < PAGE) break;
  }
  return { mapped, skipped };
}

// ── Fresh actor run over all suburbs (one run, locations[] = all) ──────────────

async function runActorAndGetDataset(cat) {
  console.log(`Starting view.com.au actor ${ACTOR_ID} over ${SUBURBS.length} suburbs (${cat.listingType})...`);
  const startRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'location',
      locations: SUBURBS,
      listingType: cat.listingType,
      sort: 'date-desc',
      maxListings: Number(process.env.MAXLISTINGS) || 600,
      maxPages: Number(process.env.MAXPAGES) || 1,
      outputFormat: ['json'],
    }),
  });
  if (!startRes.ok) throw new Error(`actor start HTTP ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const { data: run } = await startRes.json();
  console.log(`  run ${run.id} started; polling...`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const pRes = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`);
    if (!pRes.ok) throw new Error(`poll HTTP ${pRes.status}`);
    const { data: cur } = await pRes.json();
    console.log(`  status=${cur.status}`);
    if (cur.status === 'SUCCEEDED') {
      const meta = await (await fetch(`https://api.apify.com/v2/datasets/${cur.defaultDatasetId}?token=${APIFY_TOKEN}`)).json();
      console.log(`  ✓ ${meta.data?.itemCount ?? '?'} items in dataset ${cur.defaultDatasetId}`);
      return cur.defaultDatasetId;
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(cur.status)) throw new Error(`actor run ${cur.status}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [categoryArg, ...rest] = process.argv.slice(2);
const cat = CATEGORIES[categoryArg];

if (!cat) {
  console.error('Usage: node scripts/ingest-view-apify.mjs <sold|on-market|rent> <datasetId...> | --run');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

(async () => {
  let datasetIds = rest.filter((a) => a !== '--run');
  if (rest.includes('--run')) {
    if (!APIFY_TOKEN) { console.error('Missing APIFY_API_TOKEN for --run'); process.exit(1); }
    datasetIds = [await runActorAndGetDataset(cat)];
  }
  if (!datasetIds.length) {
    console.error('Provide one or more <datasetId>, or pass --run to scrape fresh.');
    process.exit(1);
  }

  let totalMapped = 0, totalSkipped = 0;
  for (const id of datasetIds) {
    console.log(`Ingesting ${categoryArg} dataset ${id} → ${cat.table}...`);
    const { mapped, skipped } = await ingestDataset(cat, id);
    totalMapped += mapped; totalSkipped += skipped;
  }
  console.log(`\nDone. Upserted ${totalMapped} rows into ${cat.table}, skipped ${totalSkipped}.`);
})().catch((err) => { console.error('Ingest failed:', err); process.exit(1); });
