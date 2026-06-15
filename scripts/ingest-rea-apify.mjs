#!/usr/bin/env node
// ============================================================
// Ingest realestate.com.au via the Apify actor `one-api/realestate-com-au-scraper`
// → Supabase. An ADDITIONAL morning feed alongside the Domain Web Unlocker scrape;
// gives a second, independent REA source for Casey/Cardinia (resilience + coverage).
//
// Trialled 2026-06-15: rich fields incl. coordinates, ~$0.003/result, no blocking.
//
//   on-market → property_listings   dedup (raw_address, source)
//
// SOLD IS DEFERRED ON PURPOSE: this actor's Sold channel returns the sold price +
// attributes but NO sold DATE. property_sales dedups on
// (raw_address, sale_date, sale_price, source); a null sale_date is treated as
// DISTINCT by Postgres, so every daily run would INSERT duplicate sold rows, and
// comps need the date for recency weighting anyway. Wiring REA sold needs either a
// sold-date source or a dedup-index decision — tracked as follow-up, not built here.
//
// Usage:
//   node scripts/ingest-rea-apify.mjs on-market [maxSuburbs]
//
// Env (from .env.local or process.env): NEXT_PUBLIC_SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, APIFY_API_TOKEN.
// Optional tuning env: REA_RESULT_COUNT (default 25), REA_PAGES (default 1),
//   SLUGS (comma-separated suburb slugs to override the full set).
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
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'one-api~realestate-com-au-scraper';
const SOURCE = 'rea-apify-one-api';
const RESULT_COUNT = Number(process.env.REA_RESULT_COUNT) || 25;
const PAGES = Number(process.env.REA_PAGES) || 1;

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
if (!APIFY_TOKEN) { console.error('Missing APIFY_API_TOKEN'); process.exit(1); }

// City of Casey + Shire of Cardinia ONLY — slugs are {suburb}-vic-{postcode}.
const SUBURB_SLUGS = [
  'berwick-vic-3806', 'narre-warren-vic-3805', 'narre-warren-south-vic-3805', 'cranbourne-vic-3977',
  'cranbourne-east-vic-3977', 'cranbourne-north-vic-3977', 'cranbourne-west-vic-3977', 'hallam-vic-3803',
  'hampton-park-vic-3976', 'doveton-vic-3177', 'endeavour-hills-vic-3802', 'lynbrook-vic-3975',
  'lyndhurst-vic-3975', 'clyde-vic-3978', 'clyde-north-vic-3978',
  'pakenham-vic-3810', 'officer-vic-3809', 'beaconsfield-vic-3807', 'beaconsfield-upper-vic-3808',
  'emerald-vic-3782', 'cockatoo-vic-3781', 'gembrook-vic-3783', 'koo-wee-rup-vic-3981',
  'nar-nar-goon-vic-3812', 'bunyip-vic-3815', 'garfield-vic-3814', 'tynong-vic-3813',
  'cardinia-vic-3978', 'lang-lang-vic-3984',
];

// Service-area guard — drop anything a search surfaces outside Casey/Cardinia.
const SERVICE_AREA = new Set([
  'berwick','blind bight','botanic ridge','cannons creek','clyde','clyde north','cranbourne','cranbourne east',
  'cranbourne north','cranbourne south','cranbourne west','devon meadows','doveton','endeavour hills','eumemmerring',
  'five ways','hallam','hampton park','harkaway','junction village','lynbrook','lyndhurst','lysterfield south',
  'narre warren','narre warren east','narre warren north','narre warren south','pearcedale','sandhurst','skye',
  'tooradin','warneet','athlone','avonsleigh','bayles','beaconsfield','beaconsfield upper','bunyip','bunyip north',
  'caldermeade','cardinia','catani','clematis','cockatoo','cora lynn','dalmore','dewhurst','emerald','garfield',
  'garfield north','gembrook','guys hill','heath hill','iona','koo wee rup','koo wee rup north','lang lang',
  'lang lang east','maryknoll','modella','monomeith','mount burnett','nangana','nar nar goon','nar nar goon north',
  'officer','officer south','pakenham','pakenham south','pakenham upper','ripplebrook','rythdale','tonimbuk',
  'toomuc valley','tynong','tynong north','vervale','yannathan',
]);
const inArea = (s) => !!s && SERVICE_AREA.has(String(s).trim().toLowerCase());

const titleCase = (s) => s ? String(s).trim().split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ') : null;
const dollarAmts = (d) => [...String(d||'').matchAll(/\$\s?([\d,]+)/g)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>0);
const priceRange = (d) => { const a=dollarAmts(d); return a.length?{low:Math.min(...a),high:Math.max(...a)}:{low:null,high:null}; };
const num = (v) => { const n=Number(v); return Number.isFinite(n)?n:null; };
const smallint = (v) => { const n=Number(v); return Number.isInteger(n)?n:null; };

/** 'narre-warren-south-vic-3805' → 'Narre Warren South, VIC 3805' (actor search input). */
function slugToSearchInput(slug) {
  const parts = slug.split('-');
  const postcode = parts.pop();
  const state = parts.pop().toUpperCase();
  const suburb = titleCase(parts.join(' '));
  return `${suburb}, ${state} ${postcode}`;
}

// One actor item (Title-Case keys) → a property_listings row, or null to skip.
function mapOnMarket(x) {
  const street = x['Street'];
  const suburb = titleCase(x['Suburb']);
  if (!street || !suburb) return null;
  const postcode = x['Postcode'] != null ? String(x['Postcode']) : null;
  const raw_address = `${street}, ${suburb} ${(x['State']||'VIC').toUpperCase()} ${postcode||''}`.trim();
  const { low, high } = priceRange(x['Price']);
  const photos = Array.isArray(x['Photos']) ? x['Photos'] : null;
  return {
    raw_address,
    suburb,
    state: (x['State']||'VIC').toUpperCase(),
    postcode,
    land_area_sqm: null, // not provided by this actor's output
    property_type: x['Property Type'] ?? null,
    bedrooms: smallint(x['Beds']),
    bathrooms: smallint(x['Baths']),
    car_spaces: smallint(x['Parking']),
    latitude: num(x['Latitude']),
    longitude: num(x['Longitude']),
    agency_name: x['Agency Name'] ?? null,
    agent_name: x['Agent Name'] ?? null,
    listing_url: x['Listing URL'] ?? null,
    image_url: photos && photos[0] ? photos[0] : null,
    display_price: x['Price'] ?? null,
    price_low: low,
    price_high: high,
    status: x['Status'] ?? null,
    source: SOURCE,
  };
}

// ─── Apify run + dataset paging ──────────────────────────────────────────────
async function startRun(input) {
  const res = await fetch(`${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}&waitForFinish=60`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Apify run start failed (${res.status}): ${(await res.text()).slice(0,200)}`);
  return (await res.json()).data;
}

async function getRun(runId) {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Apify run poll failed (${res.status})`);
  return (await res.json()).data;
}

async function waitForRun(run) {
  let r = run;
  const deadline = Date.now() + 30 * 60_000; // 30-min cap
  while (r.status === 'RUNNING' || r.status === 'READY') {
    if (Date.now() > deadline) throw new Error('Apify run exceeded 30-min wait');
    await new Promise(res => setTimeout(res, 5000));
    r = await getRun(r.id);
  }
  return r;
}

async function pageDataset(datasetId) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&offset=${offset}&limit=1000`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    items.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return items;
}

// ─── Supabase upsert ─────────────────────────────────────────────────────────
function dedupe(rows, conflict) {
  const cols = conflict.split(',').map(c=>c.trim());
  const by = new Map();
  for (const r of rows) by.set(cols.map(c=>String(r[c]??'')).join(' '), r);
  return [...by.values()];
}

async function upsert(table, conflict, rows) {
  const deduped = dedupe(rows, conflict);
  let ok = 0;
  for (let i=0;i<deduped.length;i+=500) {
    const chunk = deduped.slice(i,i+500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method:'POST',
      headers:{ apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,missing=default,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) console.error(`  upsert ${table} chunk error ${res.status}: ${(await res.text()).slice(0,200)}`);
    else ok += chunk.length;
  }
  return ok;
}

async function main() {
  const category = process.argv[2] || 'on-market';
  if (category !== 'on-market') {
    console.error(`Only 'on-market' is supported. Sold is deferred (this actor has no sold date — see header).`);
    process.exit(1);
  }
  const maxSuburbs = Number(process.argv[3]) || SUBURB_SLUGS.length;
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  const searchInputs = slugs.map(slugToSearchInput);

  console.log(`\n=== REA on-market via Apify ${ACTOR_ID} (${searchInputs.length} suburbs, ${RESULT_COUNT}/pg × ${PAGES}pg) ===`);

  const input = {
    search_inputs: searchInputs,
    searchType: 'For_Sale',
    surroundingSuburbs: false,
    pages: PAGES,
    resultCount: RESULT_COUNT,
  };

  console.log('Starting actor run...');
  const started = await startRun(input);
  const run = await waitForRun(started);
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}: ${run.statusMessage||''}`);
  console.log(`Run ${run.id} SUCCEEDED (cost $${(run.usageTotalUsd ?? 0).toFixed(4)}). Fetching dataset ${run.defaultDatasetId}...`);

  const items = await pageDataset(run.defaultDatasetId);
  const rows = items.map(mapOnMarket).filter(Boolean).filter(r => inArea(r.suburb));
  console.log(`Dataset: ${items.length} items → ${rows.length} in-area on-market rows.`);

  const upserted = await upsert('property_listings', 'raw_address,source', rows);
  console.log(`Upserted ${upserted} rows into property_listings (source=${SOURCE}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
