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
// Optional tuning env: REA_RESULT_COUNT (default 10 new / 200 full), REA_PAGES
//   (default 1 new / 3 full), REA_MODE = 'new' (default) | 'full', SLUGS (comma-separated
//   slugs to override the set).
//
// FULL MODE = the weekly verified full sweep (KTD2/KTD9): the actor pages each suburb
// up to pages × resultCount (600) so every suburb reaches a short page; a suburb that
// returns the full 600 is reported truncated and excluded from the miss-count sweep.
// The actor bills per dataset item, not per page, so deep paging of a small suburb is free.
//
// COST: the actor bills US$0.003 per dataset item and has no memory of what we hold,
// so a 'Recommended'-sorted 25/suburb page re-bills ~760 already-known listings daily
// (~4% new). 'new' mode sorts Newest + newListingOnly with a small page so we mostly
// pay for genuinely new listings; 'full' mode (weekly) re-sweeps 25/suburb to catch
// removals and price changes. See docs/reviews (2026-09-19 Apify cost review).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pingStart, pingSuccess, pingFail } from './lib/healthcheck.mjs';
import { writeFeedHealth, deriveStatus, fetchNewestRowAt } from './lib/feed-health.mjs';
import { writeFeedBatch, sweepSource, recordRun, assertMigration } from './lib/feed-write.mjs';
import { saleMethodFromText } from './lib/lifecycle-status.mjs';
import { slugToSuburb, titleCase } from './lib/slugs.mjs';
export { slugToSuburb };

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
const MODE = process.env.REA_MODE === 'full' ? 'full' : 'new';
const RESULT_COUNT = Number(process.env.REA_RESULT_COUNT) || (MODE === 'new' ? 10 : 200);
const PAGES = Number(process.env.REA_PAGES) || (MODE === 'new' ? 1 : 3);
// Each scheduled service (e.g. Railway cron) sets its own Healthchecks.io check UUID.
const HEALTHCHECK_UUID = process.env.HEALTHCHECK_UUID;

// City of Casey + Shire of Cardinia ONLY — slugs are {suburb}-vic-{postcode}.
const SUBURB_SLUGS = [
  'berwick-vic-3806', 'harkaway-vic-3806', 'narre-warren-vic-3805', 'narre-warren-south-vic-3805',
  'narre-warren-north-vic-3804', 'narre-warren-east-vic-3804', 'cranbourne-vic-3977',
  'cranbourne-east-vic-3977', 'cranbourne-north-vic-3977', 'cranbourne-west-vic-3977', 'hallam-vic-3803',
  'hampton-park-vic-3976', 'doveton-vic-3177', 'endeavour-hills-vic-3802', 'lynbrook-vic-3975',
  'lyndhurst-vic-3975', 'clyde-vic-3978', 'clyde-north-vic-3978', 'lysterfield-south-vic-3156',
  'pakenham-vic-3810', 'pakenham-upper-vic-3810', 'officer-vic-3809', 'officer-south-vic-3809',
  'beaconsfield-vic-3807', 'beaconsfield-upper-vic-3808', 'guys-hill-vic-3807', 'dewhurst-vic-3808',
  'emerald-vic-3782', 'cockatoo-vic-3781', 'gembrook-vic-3783', 'koo-wee-rup-vic-3981', 'dalmore-vic-3981',
  'nar-nar-goon-vic-3812', 'maryknoll-vic-3812', 'bunyip-vic-3815', 'bunyip-north-vic-3815', 'garfield-vic-3814', 'garfield-north-vic-3814',
  'tynong-vic-3813', 'tynong-north-vic-3813', 'tonimbuk-vic-3815',
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
export function mapOnMarket(x) {
  const street = x['Street'];
  const suburb = titleCase(x['Suburb']);
  if (!street || !suburb) return null;
  const postcode = x['Postcode'] != null ? String(x['Postcode']) : null;
  const raw_address = `${street}, ${suburb} ${(x['State']||'VIC').toUpperCase()} ${postcode||''}`.trim();
  const { low, high } = priceRange(x['Price']);
  // The actor returns Photos as a single URL string (verified live 2026-08-07);
  // accept an array too in case the shape changes back.
  const photos = Array.isArray(x['Photos'])
    ? x['Photos']
    : typeof x['Photos'] === 'string' && x['Photos']
      ? [x['Photos']]
      : null;
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
    ...saleMethodFromText(x['Price'], x['Status']),
    source: SOURCE,
  };
}

// KTD2: only a full-mode run is a verified full sweep; never sweep off a blocked run.
export function shouldSweep({ mode, blocked }) {
  return mode === 'full' && !blocked;
}

// Per-suburb coverage for sweepSource. One actor run covers every slug, so a suburb is
// complete unless its item count reached the pages × resultCount ceiling (more may exist).
export function buildCoverage(slugs, rows, { pages = PAGES, resultCount = RESULT_COUNT } = {}) {
  const counts = new Map();
  for (const r of rows) counts.set(r.suburb, (counts.get(r.suburb) || 0) + 1);
  const cov = {};
  for (const slug of slugs) {
    const suburb = slugToSuburb(slug);
    const seen = counts.get(suburb) || 0;
    cov[suburb] = { seen, truncated: seen >= pages * resultCount };
  }
  return cov;
}

/** Actor input for the run. 'new' = Newest sort + REA's new-listing filter, small page. */
export function buildInput(searchInputs, { mode = MODE, resultCount, pages } = {}) {
  resultCount ??= mode === 'new' ? 10 : 200;
  pages ??= mode === 'new' ? 1 : 3;
  return {
    search_inputs: searchInputs,
    searchType: 'For_Sale',
    surroundingSuburbs: false,
    pages,
    resultCount,
    sortOrder: 'Newest',
    newListingOnly: mode === 'new',
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

async function main() {
  const startedAt = Date.now();
  const runStart = new Date(startedAt).toISOString();
  const category = process.argv[2] || 'on-market';
  if (category !== 'on-market') {
    console.error(`Only 'on-market' is supported. Sold is deferred (this actor has no sold date — see header).`);
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!APIFY_TOKEN) { console.error('Missing APIFY_API_TOKEN'); process.exit(1); }
  const maxSuburbs = Number(process.argv[3]) || SUBURB_SLUGS.length;
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  const searchInputs = slugs.map(slugToSearchInput);

  console.log(`\n=== REA on-market via Apify ${ACTOR_ID} (${searchInputs.length} suburbs, mode=${MODE}, ${RESULT_COUNT}/pg × ${PAGES}pg) ===`);

  await assertMigration({ table: 'property_listings' });
  await pingStart(HEALTHCHECK_UUID);
  const sbCfg = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY };

  const input = buildInput(searchInputs, { resultCount: RESULT_COUNT, pages: PAGES });

  console.log('Starting actor run...');
  const started = await startRun(input);
  const run = await waitForRun(started);
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}: ${run.statusMessage||''}`);
  console.log(`Run ${run.id} SUCCEEDED (cost $${(run.usageTotalUsd ?? 0).toFixed(4)}). Fetching dataset ${run.defaultDatasetId}...`);

  const items = await pageDataset(run.defaultDatasetId);
  const rows = items.map(mapOnMarket).filter(Boolean).filter(r => inArea(r.suburb));
  console.log(`Dataset: ${items.length} items → ${rows.length} in-area on-market rows.`);

  // Shared feed-write path (KTD1): stamps last_seen_at/active/lifecycle, records price history.
  const batch = await writeFeedBatch({ table: 'property_listings', source: SOURCE, runStart, rows });
  const upserted = batch.seen;
  console.log(`Upserted ${upserted} rows into property_listings (source=${SOURCE}; new ${batch.newRows}, priced ${batch.priced}).`);

  // An empty dataset across ~29 for-sale suburbs is not a real zero-yield day — treat
  // it as blocked so the monitor alerts rather than silently reporting success.
  const blocked = items.length === 0;

  // Miss-counting sweep (KTD2): only the weekly full mode is a verified full sweep.
  let sweep = { miss1: 0, closed: 0, sweptSuburbs: [], skippedSuburbs: [] };
  if (shouldSweep({ mode: MODE, blocked })) {
    sweep = await sweepSource({ table: 'property_listings', source: SOURCE, runStart, coverage: buildCoverage(slugs, rows) });
    console.log(`Sweep: miss1=${sweep.miss1} closed=${sweep.closed} swept=${sweep.sweptSuburbs.length} skipped=${sweep.skippedSuburbs.length}`);
  }

  const status = deriveStatus({ blocked, items: upserted });
  const newestRowAt = await fetchNewestRowAt(sbCfg, 'property_listings');
  await writeFeedHealth(sbCfg, { category: 'on-market', source_used: SOURCE, items: upserted, newest_row_at: newestRowAt, status });
  await recordRun({
    category: 'on-market', source: SOURCE, mode: MODE, run_start: runStart, status,
    seen: batch.seen, new_rows: batch.newRows, priced: batch.priced, miss1: sweep.miss1, closed: sweep.closed,
    skipped_suburbs: sweep.skippedSuburbs.length, fetched: items.length, failed: 0,
    est_cost_usd: run.usageTotalUsd ?? null,
    notes: { apifyRunId: run.id, skippedSuburbs: sweep.skippedSuburbs, sweptSuburbs: sweep.sweptSuburbs },
  });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const summary = `category=on-market source=${SOURCE} status=${status} items=${upserted} dataset=${items.length} duration=${durationS}s`;
  console.log(summary);
  if (blocked) {
    await pingFail(HEALTHCHECK_UUID, `BLOCKED ${summary}`);
    process.exit(1);
  }
  await pingSuccess(HEALTHCHECK_UUID, summary);
}

// Only run when invoked directly, so the mapping helpers stay importable by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => {
    console.error(e);
    await pingFail(HEALTHCHECK_UUID, `BROKEN ${e?.message || e}`);
    process.exit(1);
  });
}
