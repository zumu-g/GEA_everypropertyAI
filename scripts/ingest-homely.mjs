#!/usr/bin/env node
// ============================================================
// Ingest homely.com.au on-market listings via Bright Data Web Unlocker → Supabase.
//
// SUPPLEMENTAL feed. Homely has no anti-bot wall, so it is the one portal still
// reliably fetchable while REA (429) and Domain/view (DataDome 403) are blocked.
//
// Flow (discovery → detail):
//   1. For each Casey/Cardinia suburb, fetch the openly-accessible for-sale index
//      (https://www.homely.com.au/for-sale/{suburb-vic-postcode}) via Web Unlocker.
//   2. Regex the `/homes/{slug}/{id}` detail links out of the index HTML.
//   3. Fetch each detail page, parse its __NEXT_DATA__ (props.pageProps.listing —
//      same shape src/lib/ingest/homely-profile-markdown.ts targets), map → row.
//   4. Dedup-upsert into property_listings on the (raw_address,source) UNIQUE key.
//
// DEDUP / SUPPLEMENT semantics: rows are tagged source='homely'. The upsert
// conflict key (raw_address,source) + in-batch de-dupe guarantee NO duplicate
// homely rows, and homely never overwrites a Domain/REA row for the same address
// (different source) — exactly how domain-web-unlocker and rea-apify already
// coexist. The read/API layer collapses by address across sources.
//
// Usage:
//   BRIGHTDATA_WEB_UNLOCKER_TOKEN=xxx BRIGHTDATA_WEB_UNLOCKER_ZONE=web_unlocker1 \
//     node scripts/ingest-homely.mjs [maxSuburbs]
//
// Env knobs: SLUGS=a,b,c (override suburb set), MAX_PER_SUBURB=N (cap detail
// fetches per suburb), INDEX_CONCURRENCY / DETAIL_CONCURRENCY (parallel fetch caps).
// Supabase creds + the Bright Data token are read from .env.local when present.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pingStart, pingSuccess, pingFail } from './lib/healthcheck.mjs';
import { writeFeedHealth, deriveStatus, fetchNewestRowAt } from './lib/feed-health.mjs';
import { mapPool } from './lib/pool.mjs';

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
const HEALTHCHECK_UUID = process.env.HEALTHCHECK_UUID;
const WU_TOKEN = process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN;
const WU_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || 'web_unlocker1';
const SOURCE = 'homely';
const MAX_PER_SUBURB = Number(process.env.MAX_PER_SUBURB) || Infinity;
// Concurrent fetches (was serial → would blow the 45-min job cap like the Domain
// feed did). Kept modest: Web Unlocker returns 0-byte challenge pages when hit too
// hard, so favour a smaller pool + a generous per-page retry budget (fetchPage below).
const INDEX_CONCURRENCY = Number(process.env.INDEX_CONCURRENCY) || 4;
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY) || 5;
const TABLE = 'property_listings';
const CONFLICT = 'raw_address,source';

// Homely suburb-index slugs ({suburb}-{state}-{postcode}) — same Casey/Cardinia set
// as the Domain feed. Homely's index path is /for-sale/{slug}.
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
const num = (v) => typeof v==='number'&&Number.isFinite(v)?v:null;
const smallint = (v) => Number.isInteger(v)?v:null;
const str = (v) => (typeof v==='string'&&v.trim())?v.trim():null;
const dollarAmts = (d) => [...String(d||'').matchAll(/\$\s*([\d,]+)(?:\s*([kKmM]))?/g)].map(m=>{
  let n=Number(m[1].replace(/,/g,'')); const s=(m[2]||'').toLowerCase();
  if(s==='k')n*=1_000; else if(s==='m')n*=1_000_000; return n;
}).filter(n=>Number.isFinite(n)&&n>=50_000&&n<=50_000_000);
const priceRange = (d) => { const a=dollarAmts(d); return a.length?{low:Math.min(...a),high:Math.max(...a)}:{low:null,high:null}; };

// __NEXT_DATA__ → parsed JSON object (or null). Same script tag Homely embeds.
export function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// A genuine Homely page (index or detail) embeds __NEXT_DATA__. An anti-bot
// challenge / interstitial returned as HTTP 200 does NOT — treat as failure to retry.
export function looksLikeData(html) {
  return typeof html === 'string' && /<script id="__NEXT_DATA__"/i.test(html);
}

// Parse `/homes/{slug}/{id}` detail links out of an index page's HTML (deduped).
export function parseDetailLinks(html) {
  const seen = new Set();
  const out = [];
  for (const m of String(html).matchAll(/\/homes\/([a-z0-9-]+)\/(\d+)/gi)) {
    const path = `/homes/${m[1]}/${m[2]}`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(`https://www.homely.com.au${path}`);
  }
  return out;
}

// Photo URLs from a detail listing node (prefer the default-variant URI).
function photoUrls(listing) {
  const photos = listing?.media?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.map(p => str(p?.webDefaultURI) ?? str(p?.webHeroURI)).filter(Boolean);
}

// One Homely detail __NEXT_DATA__ → a property_listings row, or null to skip.
// Mirrors src/lib/ingest/homely-profile-markdown.ts (props.pageProps.listing).
export function mapDetail(html, detailUrl) {
  const data = parseNextData(html);
  const listing = data?.props?.pageProps?.listing;
  if (!listing || typeof listing !== 'object') return null; // shell / 404

  // Skip sold/leased records that surface in a for-sale index — this feed is on-market only.
  if (listing.saleDetails?.soldDetails?.soldOn) return null;

  const a = listing.address || {};
  const raw_address = str(a.longAddress) ?? str(a.shortAddress);
  if (!raw_address) return null;

  const f = listing.features || {};
  const priceText = str(listing.priceDetails?.longDescription) ?? str(listing.priceDetails?.shortDescription);
  const { low, high } = priceRange(priceText);
  const photos = photoUrls(listing);
  const agents = Array.isArray(listing.agents) ? listing.agents : [];
  const agent0 = agents.find(x => x && str(x.name));

  return {
    raw_address,
    suburb: titleCase(a.suburb),
    state: (str(a.stateCode) ?? str(a.state) ?? 'VIC').toUpperCase(),
    postcode: a.postcode ?? null,
    land_area_sqm: num(listing.landFeatures?.areaSqm),
    property_type: str(listing.propertyType) ?? str(listing.propertyTypeDescription) ?? null,
    bedrooms: smallint(f.bedrooms),
    bathrooms: smallint(f.bathrooms),
    car_spaces: smallint(f.cars),
    latitude: num(a.latitude),
    longitude: num(a.longitude),
    agency_name: str(listing.office?.fullName),
    agent_name: agent0 ? str(agent0.name) : null,
    listing_url: detailUrl,
    image_url: photos[0] ?? null,
    display_price: priceText,
    price_low: low,
    price_high: high,
    status: str(listing.statusType),
    source: SOURCE,
  };
}

// Web Unlocker fetch with retry/backoff (mirrors the Domain runner). Throwing
// means the page was never successfully fetched (→ blocked), as distinct from a
// valid page that simply had no in-area listings (→ empty).
async function fetchPage(url, maxAttempts = 6) {
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WU_TOKEN}`,
          // Return as soon as the SSR data element is present, instead of waiting
          // for network-idle. Homely keeps connections open (analytics/long-poll),
          // so the page never reaches network-idle and Web Unlocker would otherwise
          // time out (networkidle_event_timeout → empty 200 → false "blocked").
          // The data we parse lives in <script id="__NEXT_DATA__"> in the initial HTML.
          'x-unblock-expect': '#__NEXT_DATA__',
        },
        body: JSON.stringify({ zone: WU_ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 1000 && looksLikeData(html)) return html;
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

async function upsert(rows) {
  const deduped = dedupe(rows, CONFLICT);
  let ok = 0;
  for (let i=0;i<deduped.length;i+=500) {
    const chunk = deduped.slice(i,i+500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=${CONFLICT}`, {
      method:'POST',
      headers:{ apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,missing=default,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) console.error(`  upsert ${TABLE} chunk error ${res.status}: ${(await res.text()).slice(0,200)}`);
    else ok += chunk.length;
  }
  return ok;
}

async function main() {
  const startedAt = Date.now();
  // OWN feed_health category. Homely is a SUPPLEMENTAL on-market feed that runs
  // last (:51, after Domain :23 and REA :37). feed_health upserts on_conflict=category,
  // so writing 'on-market' here would clobber the core feed's status — a blocked/zero
  // homely run (common, it's best-effort) would flip the healthy Domain/REA on-market
  // status to 'blocked' and fire a false digest alarm. A distinct category keeps the
  // core 'on-market' row owned by Domain/REA; the digest only escalates EXPECTED
  // categories (sold,on-market), so this row is recorded but never alarms.
  const category = 'on-market-homely';
  const maxSuburbs = Number(process.argv[2]) || SUBURB_SLUGS.length;
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!WU_TOKEN) { console.error('Missing BRIGHTDATA_WEB_UNLOCKER_TOKEN'); process.exit(1); }
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  console.log(`\n=== homely on-market via Web Unlocker (${slugs.length} suburbs) ===`);

  await pingStart(HEALTHCHECK_UUID);
  const sbCfg = { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY };

  const blockedSlugs = [];        // index fetch failed (challenge/empty after retries)
  let detailOk = 0, detailFail = 0;

  // ── Phase 1: fetch every suburb's for-sale index concurrently, collect detail
  // links. Globally de-dup URLs so a property listed across multiple indexes is
  // fetched once.
  const indexResults = await mapPool(slugs, INDEX_CONCURRENCY, async (slug) => {
    const indexUrl = `https://www.homely.com.au/for-sale/${slug}`;
    try {
      const html = await fetchPage(indexUrl);
      const links = parseDetailLinks(html).slice(0, MAX_PER_SUBURB);
      console.log(`  ${slug}: ${links.length} detail links`);
      return { slug, links };
    } catch (e) {
      console.error(`  ${slug}: INDEX FAILED ${e.message}`);
      return { slug, error: e.message };
    }
  });

  let indexOk = 0;
  const seenDetail = new Set();
  const detailUrls = [];
  for (const r of indexResults) {
    if (r.error) { blockedSlugs.push(r.slug); continue; }
    indexOk++;
    for (const u of r.links) {
      if (seenDetail.has(u)) continue;
      seenDetail.add(u);
      detailUrls.push(u);
    }
  }

  // ── Phase 2: fetch + map each unique detail page concurrently. Area-guarded.
  console.log(`\nFetching ${detailUrls.length} unique detail pages...`);
  const detailResults = await mapPool(detailUrls, DETAIL_CONCURRENCY, async (url) => {
    try {
      const detailHtml = await fetchPage(url);
      const row = mapDetail(detailHtml, url);
      return { ok: true, row };
    } catch (e) {
      console.error(`    ${url}: detail FAILED ${e.message}`);
      return { ok: false };
    }
  });

  const rows = [];
  for (const r of detailResults) {
    if (!r.ok) { detailFail++; continue; }
    detailOk++;
    if (r.row && inArea(r.row.suburb)) rows.push(r.row);
  }
  // BLOCKED = not a single suburb index returned a valid page (all challenge/empty).
  // Do NOT treat that as a real zero-yield day — flag blocked and alert.
  const blocked = indexOk === 0;
  console.log(`\nTotal in-area rows: ${rows.length}. Upserting into ${TABLE}...`);
  const upserted = await upsert(rows);
  console.log(`Upserted ${upserted} rows. Index ok: ${indexOk}/${slugs.length}, detail ok/fail: ${detailOk}/${detailFail}, blocked: ${blockedSlugs.length}.`);

  const status = deriveStatus({ blocked, items: upserted });
  const newestRowAt = await fetchNewestRowAt(sbCfg, TABLE);
  await writeFeedHealth(sbCfg, { category, source_used: SOURCE, items: upserted, newest_row_at: newestRowAt, status });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const summary = `category=${category} status=${status} items=${upserted} index_ok=${indexOk}/${slugs.length} detail_ok=${detailOk} detail_fail=${detailFail} blocked=${blockedSlugs.length} duration=${durationS}s`;
  console.log(summary);
  if (blocked) {
    await pingFail(HEALTHCHECK_UUID, `BLOCKED ${summary}`);
    process.exit(1);
  }
  await pingSuccess(HEALTHCHECK_UUID, summary);
}

// Only run when invoked directly, so the parsing helpers can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => {
    console.error(e);
    await pingFail(HEALTHCHECK_UUID, `BROKEN ${e?.message || e}`);
    process.exit(1);
  });
}
