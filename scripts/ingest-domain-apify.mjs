#!/usr/bin/env node
// ============================================================
// Ingest Domain.com.au Apify data into Supabase — category-aware.
//
// Maps the Domain scraper's listing schema → the right table and bulk-upserts
// with a per-category dedup key (resolution=merge-duplicates, so re-runs update
// in place and NEVER create duplicates). Pages through the dataset so large runs
// (28k+ items) don't have to be held in memory at once.
//
//   sold      → property_sales      dedup (raw_address, sale_date, sale_price, source)
//   on-market → property_listings   dedup (raw_address, source)
//   rent      → property_rentals    dedup (raw_address, source)
//
// Usage:
//   # reuse an existing Apify dataset:
//   node scripts/ingest-domain-apify.mjs <category> <datasetId> [<datasetId> ...]
//   # or trigger a fresh actor run over the suburb list, then ingest its dataset:
//   node scripts/ingest-domain-apify.mjs <category> --run
//
//   <category> = sold | on-market | rent
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   APIFY_API_TOKEN.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no dep) ─ only fills missing process.env keys.
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
const SOURCE = 'domain-apify';
const ACTOR_ID = '0EXe0hsmDKWLI3JF9';

// Casey / Cardinia / Bass Coast / West Gippsland — slugs are {suburb}-vic-{postcode}.
const SUBURB_SLUGS = [
  'berwick-vic-3806', 'narre-warren-vic-3805', 'narre-warren-south-vic-3805', 'cranbourne-vic-3977',
  'cranbourne-east-vic-3977', 'cranbourne-north-vic-3977', 'cranbourne-west-vic-3977', 'hallam-vic-3803',
  'hampton-park-vic-3976', 'doveton-vic-3177', 'endeavour-hills-vic-3802', 'lynbrook-vic-3975',
  'lyndhurst-vic-3975', 'clyde-vic-3978', 'clyde-north-vic-3978', 'pakenham-vic-3810', 'officer-vic-3809',
  'beaconsfield-vic-3807', 'beaconsfield-upper-vic-3808', 'emerald-vic-3782', 'cockatoo-vic-3781',
  'gembrook-vic-3783', 'koo-wee-rup-vic-3981', 'nar-nar-goon-vic-3812', 'bunyip-vic-3815', 'garfield-vic-3814',
  'tynong-vic-3813', 'cardinia-vic-3978', 'nyora-vic-3987', 'lang-lang-vic-3984', 'loch-vic-3945',
  'poowong-vic-3988', 'korumburra-vic-3950', 'drouin-vic-3818', 'warragul-vic-3820', 'longwarry-vic-3816',
];

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "Sold by private treaty 07 Oct 2020" → "2020-10-07" (or null). */
function parseSaleDate(tagText) {
  if (!tagText) return null;
  const m = String(tagText).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

/** "$245,000" → 245000 (or null when not a clean number). */
function parsePrice(display) {
  if (!display) return null;
  const digits = String(display).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pull every "$1,234,000" amount out of a string → array of numbers. */
function dollarAmounts(display) {
  if (!display) return [];
  const out = [];
  for (const m of String(display).matchAll(/\$\s?([\d,]+)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** "$930,000 - $970,000" → {low,high}; single amount → low=high; none → nulls. */
function parsePriceRange(display) {
  const amts = dollarAmounts(display);
  if (amts.length === 0) return { low: null, high: null };
  return { low: Math.min(...amts), high: Math.max(...amts) };
}

/** "$550 per week" / "$520 - $560 pw" → 550 / 520 (first/low amount), or null. */
function parseWeeklyRent(display) {
  const amts = dollarAmounts(display);
  return amts.length ? Math.min(...amts) : null;
}

function num(v) { return typeof v === 'number' ? v : null; }
function smallint(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

// ── Per-category config ───────────────────────────────────────────────────────

const CATEGORIES = {
  sold: {
    table: 'property_sales',
    conflict: 'raw_address,sale_date,sale_price,source',
    urlFor: (slug) => `https://www.domain.com.au/sold-listings/${slug}/`,
    map(it) {
      const loc = it.location ?? {};
      const prop = it.property ?? {};
      const rawAddress = (loc.display_address ?? '').trim();
      const salePrice = parsePrice(it.pricing?.display_price);
      if (!rawAddress || salePrice == null) return null; // sold needs a price
      return {
        raw_address: rawAddress,
        suburb: loc.suburb ?? null,
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        land_area_sqm: num(prop.land_size),
        property_type: prop.property_type ?? null,
        sale_price: salePrice,
        sale_date: parseSaleDate(it.listing?.tags?.tag_text),
        latitude: num(loc.latitude),
        longitude: num(loc.longitude),
        source: SOURCE,
      };
    },
  },

  'on-market': {
    table: 'property_listings',
    conflict: 'raw_address,source',
    urlFor: (slug) => `https://www.domain.com.au/sale/${slug}/`,
    map(it) {
      const loc = it.location ?? {};
      const prop = it.property ?? {};
      const rawAddress = (loc.display_address ?? '').trim();
      if (!rawAddress) return null;
      const display = it.pricing?.display_price ?? null;
      const { low, high } = parsePriceRange(display);
      return {
        raw_address: rawAddress,
        suburb: loc.suburb ?? null,
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        display_price: display,
        price_low: low,
        price_high: high,
        status: it.listing?.tags?.tag_text ?? null,
        bedrooms: smallint(prop.bedrooms),
        bathrooms: smallint(prop.bathrooms),
        car_spaces: smallint(prop.parking),
        land_area_sqm: num(prop.land_size),
        property_type: prop.property_type ?? null,
        latitude: num(loc.latitude),
        longitude: num(loc.longitude),
        source: SOURCE,
      };
    },
  },

  rent: {
    table: 'property_rentals',
    conflict: 'raw_address,source',
    urlFor: (slug) => `https://www.domain.com.au/rent/${slug}/`,
    map(it) {
      const loc = it.location ?? {};
      const prop = it.property ?? {};
      const rawAddress = (loc.display_address ?? '').trim();
      if (!rawAddress) return null;
      const display = it.pricing?.display_price ?? null;
      return {
        raw_address: rawAddress,
        suburb: loc.suburb ?? null,
        state: (loc.state ?? 'VIC').toUpperCase(),
        postcode: loc.postcode ?? null,
        display_price: display,
        weekly_rent: parseWeeklyRent(display),
        status: it.listing?.tags?.tag_text ?? null,
        bedrooms: smallint(prop.bedrooms),
        bathrooms: smallint(prop.bathrooms),
        car_spaces: smallint(prop.parking),
        land_area_sqm: num(prop.land_size),
        property_type: prop.property_type ?? null,
        latitude: num(loc.latitude),
        longitude: num(loc.longitude),
        source: SOURCE,
      };
    },
  },
};

// ── Supabase upsert (PostgREST; merge-duplicates → no dupes on re-run) ─────────

async function upsert(table, conflict, rows) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`upsert ${table} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function ingestDataset(cat, datasetId) {
  const PAGE = 1000;
  let offset = 0;
  let mapped = 0;
  let skipped = 0;
  for (;;) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&offset=${offset}&limit=${PAGE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Apify items HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    const rows = [];
    for (const it of items) {
      const row = cat.map(it);
      if (row) rows.push(row);
      else skipped++;
    }
    if (rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        await upsert(cat.table, cat.conflict, rows.slice(i, i + 500));
      }
      mapped += rows.length;
    }
    offset += items.length;
    console.log(`  [${datasetId}] processed ${offset} · mapped ${mapped} · skipped ${skipped}`);
    if (items.length < PAGE) break;
  }
  return { mapped, skipped };
}

// ── Fresh actor run over the suburb list, then ingest its default dataset ──────

async function runActorAndGetDataset(cat) {
  const startUrls = SUBURB_SLUGS.map((slug) => ({ url: cat.urlFor(slug) }));
  console.log(`Starting Apify actor ${ACTOR_ID} over ${startUrls.length} suburb URLs...`);
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrls, maxItems: 5000 }),
    },
  );
  if (!startRes.ok) throw new Error(`actor start HTTP ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const { data: run } = await startRes.json();
  const runId = run.id;
  console.log(`  run ${runId} started; polling...`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const pRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    if (!pRes.ok) throw new Error(`poll HTTP ${pRes.status}`);
    const { data: cur } = await pRes.json();
    console.log(`  status=${cur.status}`);
    if (cur.status === 'SUCCEEDED') return cur.defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(cur.status)) {
      throw new Error(`actor run ${cur.status}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [categoryArg, ...rest] = process.argv.slice(2);
const cat = CATEGORIES[categoryArg];

if (!cat) {
  console.error('Usage: node scripts/ingest-domain-apify.mjs <sold|on-market|rent> <datasetId...> | --run');
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

  let totalMapped = 0;
  let totalSkipped = 0;
  for (const id of datasetIds) {
    console.log(`Ingesting ${categoryArg} dataset ${id} → ${cat.table}...`);
    const { mapped, skipped } = await ingestDataset(cat, id);
    totalMapped += mapped;
    totalSkipped += skipped;
  }
  console.log(`\nDone. Upserted ${totalMapped} rows into ${cat.table}, skipped ${totalSkipped}.`);
})().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
