#!/usr/bin/env node
// ============================================================
// Ingest Domain.com.au via Bright Data Web Unlocker → Supabase.
//
// Fetches each Casey/Cardinia suburb's Domain search page through Web Unlocker
// (managed anti-bot), parses the embedded __NEXT_DATA__ JSON
// (props.pageProps.componentProps.listingsMap), maps each listing to a row, and
// dedup-upserts into property_sales (sold) / property_listings (on-market).
//
// Usage:
//   BRIGHTDATA_WEB_UNLOCKER_TOKEN=xxx BRIGHTDATA_WEB_UNLOCKER_ZONE=web_unlocker1 \
//     node scripts/ingest-domain-webunlocker.mjs <sold|on-market> [maxSuburbs]
//
// Supabase creds + (optionally) the Bright Data token are read from .env.local.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pingStart, pingSuccess, pingFail } from './lib/healthcheck.mjs';
import { writeFeedHealth, deriveStatus, fetchNewestRowAt } from './lib/feed-health.mjs';
import { mapPool } from './lib/pool.mjs';
import { paginateUntilShort } from './lib/paginate.mjs';
import { writeFeedBatch, sweepSource, recordRun, assertMigration } from './lib/feed-write.mjs';
import { saleMethodFromText } from './lib/lifecycle-status.mjs';
import { slugToSuburb, titleCase } from './lib/slugs.mjs';
export { slugToSuburb };

// Fetch suburbs concurrently (was serial → 45-min timeout cancellations). Kept
// modest: Web Unlocker returns 0-byte challenge pages when hit too hard, so 4-wide
// with a generous per-page retry budget (below) beats 6-wide with a tight one.
// Worst case ≈ 29 suburbs / 4 × (6×90s) is still well under the 45-min job cap.
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY) || 4;
// KTD9: at most this many search pages per suburb per run through Web Unlocker.
const PAGE_CAP = Number(process.env.PAGE_CAP) || 20;

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
// Each scheduled service (e.g. Railway cron) sets its own Healthchecks.io check UUID.
const HEALTHCHECK_UUID = process.env.HEALTHCHECK_UUID;
const WU_TOKEN = process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN;
const WU_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || 'web_unlocker1';
const SOURCE = 'domain-web-unlocker';

export const SUBURB_SLUGS = [
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
export const inArea = (s) => !!s && SERVICE_AREA.has(String(s).trim().toLowerCase());

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
const parseSaleDate = (t) => { const m=String(t||'').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/); if(!m)return null; const mm=MONTHS[m[2].toLowerCase()]; return mm?`${m[3]}-${mm}-${m[1].padStart(2,'0')}`:null; };
const parsePrice = (d) => { const n=Number(String(d||'').replace(/[^0-9]/g,'')); return Number.isFinite(n)&&n>0?n:null; };
const dollarAmts = (d) => [...String(d||'').matchAll(/\$\s?([\d,]+)/g)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>0);
const priceRange = (d) => { const a=dollarAmts(d); return a.length?{low:Math.min(...a),high:Math.max(...a)}:{low:null,high:null}; };
const num = (v) => typeof v==='number'&&Number.isFinite(v)?v:null;
const smallint = (v) => Number.isInteger(v)?v:null;

// One Domain listingModel → a DB row for the category, or null to skip.
export function mapListing(category, node) {
  const m = node?.listingModel; if (!m) return null;
  const a = m.address || {};
  if (!a.street || !a.suburb) return null;
  const raw_address = `${a.street}, ${titleCase(a.suburb)} ${a.state||'VIC'} ${a.postcode||''}`.trim();
  const f = m.features || {};
  const agents = (m.branding?.agents || []).map(x=>x?.agentName?.trim()).filter(Boolean);
  const common = {
    raw_address,
    suburb: titleCase(a.suburb),
    state: (a.state||'VIC').toUpperCase(),
    postcode: a.postcode ?? null,
    land_area_sqm: f.landSize>0 ? f.landSize : null,
    property_type: f.propertyType ?? null,
    bedrooms: smallint(f.beds),
    bathrooms: smallint(f.baths),
    car_spaces: smallint(f.parking),
    latitude: num(a.lat),
    longitude: num(a.lng),
    agency_name: null, // Domain search JSON exposes agencyId only, no agency name
    agent_name: agents.length ? agents.join(', ') : null,
    listing_url: m.url ? `https://www.domain.com.au${m.url}` : null,
    image_url: Array.isArray(m.images) && m.images[0] ? m.images[0] : null,
    source: SOURCE,
  };
  const tag = m.tags?.tagText ?? null;
  // R8: Domain re-stamps dateListed on edit, so it only counts as a real listed date
  // when it differs from dateUpdated. Keys always present (uniform batch keys).
  const dateListed = m.dateListed ?? null, dateUpdated = m.dateUpdated ?? null;
  const listed = dateListed && dateListed !== dateUpdated
    ? { listed_date: dateListed, listed_date_source: 'domain-search' }
    : { listed_date: null, listed_date_source: null };
  if (category === 'sold') {
    const sale_price = parsePrice(m.price);
    if (sale_price == null) return null; // sold needs a price (skips "Price Withheld")
    return { ...common, sale_price, sale_date: parseSaleDate(tag) };
  }
  if (category === 'rent') {
    const amts = dollarAmts(m.price);
    return {
      ...common,
      ...listed,
      display_price: m.price ?? null,
      weekly_rent: amts.length ? Math.min(...amts) : null, // mirrors parseWeeklyRent's "lowest amount" convention
      status: tag,
    };
  }
  const { low, high } = priceRange(m.price);
  return { ...common, ...listed, display_price: m.price ?? null, price_low: low, price_high: high, status: tag, ...saleMethodFromText(m.price, tag) };
}

export function extractListings(html) {
  const mm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!mm) return [];
  let d; try { d = JSON.parse(mm[1]); } catch { return []; }
  const lm = d?.props?.pageProps?.componentProps?.listingsMap;
  return lm && typeof lm === 'object' ? Object.values(lm) : [];
}

// Page → listing nodes, or throw when the HTML is not a Domain page (soft block served
// as 200). paginateUntilShort turns a throw on page >= 2 into truncated:true instead
// of reading it as end-of-results.
export function listingsPage(html) {
  if (!looksLikeData(html)) throw new Error('not a listings page');
  return extractListings(html);
}

// Body-validation gate: a genuine Domain search page embeds the __NEXT_DATA__
// script. An anti-bot challenge / interstitial returned as HTTP 200 does NOT, so it
// must be treated as a failure to retry — never as a (false) empty-but-successful
// page. This closes the "challenge-page-as-200" silent-success hole.
export function looksLikeData(html) {
  return typeof html === 'string' && /<script id="__NEXT_DATA__"/i.test(html);
}

// Web Unlocker intermittently returns 200 with an EMPTY body or an anti-bot page —
// retry on empty / missing-data-shape (and on transient 429/5xx) with backoff before
// giving up. Throwing means the page was never successfully fetched (→ blocked), as
// distinct from a valid page that simply had no in-area listings (→ empty).
async function fetchPage(url, maxAttempts = 6) {
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WU_TOKEN}` },
        body: JSON.stringify({ zone: WU_ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 1000 && looksLikeData(html)) return html;
        // Bright Data reports account problems as HTTP 200 + empty body +
        // x-brd-err headers (e.g. client_10020 "Account is suspended"). Surface
        // the real reason and stop retrying — it won't clear within this run.
        const brdErr = res.headers.get('x-brd-err-msg') || res.headers.get('x-brd-error');
        if (brdErr) {
          lastErr = `Bright Data: ${brdErr} (${res.headers.get('x-brd-err-code') ?? 'no code'})`;
          break;
        }
        lastErr = looksLikeData(html)
          ? `empty/short body (${html.length}b)`
          : `no __NEXT_DATA__ (challenge/interstitial, ${html.length}b)`;
      } else {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) throw new Error(lastErr);
      }
    } catch (e) {
      lastErr = e.message;
    }
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`Web Unlocker failed after ${maxAttempts} attempts: ${lastErr}`);
}

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

const CATEGORY = { sold:{ path:'sold-listings', table:'property_sales', conflict:'raw_address,sale_date,sale_price,source' },
                   'on-market':{ path:'sale', table:'property_listings', conflict:'raw_address,source' },
                   rent:{ path:'rent', table:'property_rentals', conflict:'raw_address,source' } };

// Sweep (KTD2) only the tables feed-write owns, and never off a blocked run.
export function shouldSweep({ category, blocked }) {
  return category !== 'sold' && !blocked;
}

// Per-suburb coverage for sweepSource: every slug that returned at least one valid
// page → rows seen in that suburb (from any slug's page) and whether pagination hit
// the cap. Failed (blocked) slugs are left out so they are never swept.
export function buildCoverage(perSlug, rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.suburb, (counts.get(r.suburb) || 0) + 1);
  const cov = {};
  for (const r of perSlug) {
    if (r.error) continue;
    const suburb = slugToSuburb(r.slug);
    cov[suburb] = { seen: counts.get(suburb) || 0, truncated: !!r.truncated };
  }
  // Clean run (no slug errored or truncated): in-area rows that surfaced under a
  // neighbouring slug's crawl belong to suburbs we did not crawl — sweep those too.
  if (perSlug.every((r) => !r.error && !r.truncated)) {
    for (const [suburb, seen] of counts) if (!(suburb in cov) && inArea(suburb)) cov[suburb] = { seen, truncated: false };
  }
  return cov;
}

async function main() {
  const startedAt = Date.now();
  const runStart = new Date(startedAt).toISOString();
  const category = process.argv[2] || 'sold';
  const maxSuburbs = Number(process.argv[3]) || SUBURB_SLUGS.length;
  const cfg = CATEGORY[category];
  if (!cfg) { console.error('category must be sold|on-market|rent'); process.exit(1); }
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!WU_TOKEN) { console.error('Missing BRIGHTDATA_WEB_UNLOCKER_TOKEN'); process.exit(1); }
  // SLUGS=a,b,c env overrides the suburb set (e.g. to re-run failed suburbs).
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  console.log(`\n=== ${category} via Web Unlocker (${slugs.length} suburbs) ===`);

  if (category !== 'sold') await assertMigration({ table: cfg.table });
  await pingStart(HEALTHCHECK_UUID);
  const sbCfg = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY };

  const rows = [];
  const blockedSlugs = [];  // fetch failed (challenge/empty after retries) — never got a valid page
  const emptySlugs = [];    // valid page, but no in-area listings (genuine zero-yield)
  let fetchedOk = 0;
  // Fetch suburbs with bounded concurrency (was serial → routinely timed out at
  // the 45-min job cap). Each slug self-contains its error handling so one failure
  // never rejects the pool; aggregation below stays identical to the serial path.
  const perSlug = await mapPool(slugs, FETCH_CONCURRENCY, async (slug) => {
    const url = `https://www.domain.com.au/${cfg.path}/${slug}/`;
    try {
      // Follow ?page=N until a short page (full sweep) or PAGE_CAP (truncated → not swept).
      const { items: nodes, pages, truncated, error } = await paginateUntilShort(
        async (page) => listingsPage(await fetchPage(page === 1 ? url : `${url}?page=${page}`)),
        { cap: PAGE_CAP, key: (n) => n?.listingModel?.url ?? JSON.stringify(n?.listingModel?.address ?? n) },
      );
      const mapped = nodes.map(n=>mapListing(category, n)).filter(Boolean).filter(r=>inArea(r.suburb));
      console.log(`  ${slug}: ${nodes.length} listings over ${pages} page(s) → ${mapped.length} in-area${truncated ? ` (TRUNCATED${error ? `: ${error}` : ''})` : ''}`);
      return { slug, mapped, truncated };
    } catch (e) {
      console.error(`  ${slug}: FAILED ${e.message}`);
      return { slug, error: e.message };
    }
  });
  for (const r of perSlug) {
    if (r.error) { blockedSlugs.push(r.slug); continue; }
    fetchedOk++;
    rows.push(...r.mapped);
    if (r.mapped.length === 0) emptySlugs.push(r.slug);
  }

  // BLOCKED = not a single suburb returned a valid page (all challenge/empty). In
  // that case do NOT treat the run as a real zero-yield day — flag blocked and alert,
  // and (for on-market) never expire live listings off an empty scrape.
  const blocked = fetchedOk === 0;
  console.log(`\nTotal in-area rows: ${rows.length}. Upserting into ${cfg.table}...`);
  // Sold keeps the plain upsert (property_sales has no lifecycle); on-market and rent go
  // through the shared feed-write path (KTD1) which stamps last_seen_at/active/lifecycle.
  let upserted, batch = { seen: 0, newRows: 0, priced: 0 };
  if (category === 'sold') upserted = await upsert(cfg.table, cfg.conflict, rows);
  else { batch = await writeFeedBatch({ table: cfg.table, source: SOURCE, runStart, rows }); upserted = batch.seen; }
  console.log(`Upserted ${upserted} rows (new ${batch.newRows}, priced ${batch.priced}). Blocked: ${blockedSlugs.length}, empty: ${emptySlugs.length}, fetched-ok: ${fetchedOk}.`);

  // Source-scoped miss-counting sweep (KTD2) over the suburbs this run covered
  // completely. Blocked (failed) and truncated slugs are excluded by construction.
  let sweep = { miss1: 0, closed: 0, sweptSuburbs: [], skippedSuburbs: [] };
  if (shouldSweep({ category, blocked })) {
    sweep = await sweepSource({ table: cfg.table, source: SOURCE, runStart, coverage: buildCoverage(perSlug, rows) });
    console.log(`Sweep: miss1=${sweep.miss1} closed=${sweep.closed} swept=${sweep.sweptSuburbs.length} skipped=${sweep.skippedSuburbs.length}`);
  }

  const status = deriveStatus({ blocked, items: upserted });
  const newestRowAt = await fetchNewestRowAt(sbCfg, cfg.table);
  await writeFeedHealth(sbCfg, { category, source_used: SOURCE, items: upserted, newest_row_at: newestRowAt, status });
  await recordRun({
    category, source: SOURCE, mode: 'daily', run_start: runStart, status,
    seen: batch.seen, new_rows: batch.newRows, priced: batch.priced, miss1: sweep.miss1, closed: sweep.closed,
    skipped_suburbs: sweep.skippedSuburbs.length, fetched: 0, failed: blockedSlugs.length,
    notes: { blockedSlugs, skippedSuburbs: sweep.skippedSuburbs, sweptSuburbs: sweep.sweptSuburbs },
  });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const summary = `category=${category} status=${status} items=${upserted} fetched_ok=${fetchedOk}/${slugs.length} blocked=${blockedSlugs.length} empty=${emptySlugs.length} duration=${durationS}s`;
  console.log(summary);
  if (blocked) {
    // Include one per-suburb error so the alert names the real cause (e.g.
    // "Bright Data: Account is suspended...") instead of a bare BLOCKED.
    const firstErr = perSlug.find((r) => r.error)?.error;
    await pingFail(HEALTHCHECK_UUID, `BLOCKED ${summary}${firstErr ? ` | ${firstErr}` : ''}`);
    process.exit(1); // surface a non-zero exit so the scheduler also marks the run failed
  }
  await pingSuccess(HEALTHCHECK_UUID, summary);
}

// Only run when invoked directly (node scripts/ingest-domain-webunlocker.mjs …), so
// the parsing/validation helpers can be imported by tests without firing the scrape.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => {
    console.error(e);
    await pingFail(HEALTHCHECK_UUID, `BROKEN ${e?.message || e}`);
    process.exit(1);
  });
}
