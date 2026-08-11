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

// Fetch suburbs concurrently (was serial → 45-min timeout cancellations). Kept
// modest: Web Unlocker returns 0-byte challenge pages when hit too hard, so 4-wide
// with a generous per-page retry budget (below) beats 6-wide with a tight one.
// Worst case ≈ 29 suburbs / 4 × (6×90s) is still well under the 45-min job cap.
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY) || 4;

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
const titleCase = (s) => s ? String(s).trim().split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ') : null;
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
  if (category === 'sold') {
    const sale_price = parsePrice(m.price);
    if (sale_price == null) return null; // sold needs a price (skips "Price Withheld")
    return { ...common, sale_price, sale_date: parseSaleDate(tag) };
  }
  if (category === 'rent') {
    const nowIso = new Date().toISOString();
    const amts = dollarAmts(m.price);
    return {
      ...common,
      display_price: m.price ?? null,
      weekly_rent: amts.length ? Math.min(...amts) : null, // mirrors parseWeeklyRent's "lowest amount" convention
      status: tag,
      last_seen_at: nowIso,
      active: true,
    };
  }
  const { low, high } = priceRange(m.price);
  return { ...common, display_price: m.price ?? null, price_low: low, price_high: high, status: tag };
}

export function extractListings(html) {
  const mm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!mm) return [];
  let d; try { d = JSON.parse(mm[1]); } catch { return []; }
  const lm = d?.props?.pageProps?.componentProps?.listingsMap;
  return lm && typeof lm === 'object' ? Object.values(lm) : [];
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

// Expire rent rows not re-seen on a full, unblocked run — otherwise a leased/withdrawn
// property stays `active=true` forever (upsert only ever refreshes rows still on Domain).
// Scoped to the full SERVICE_AREA (not just the 29 slugs) since a search page can surface
// in-area listings from a neighbouring suburb — same scope `inArea` uses to accept rows in.
// Only called for category='rent' on a full-suburb run where every suburb fetched OK (see
// main()). Gating on "zero suburbs failed" rather than "not every suburb failed" matters: a
// run where most suburbs succeed but a few transiently fail must NOT sweep expiry across the
// suburbs it didn't actually re-scrape, or a still-live rental in a failed suburb gets wrongly
// deactivated. Pure gate so this rule is testable without mocking the full scrape pipeline.
export function shouldExpireRentals({ category, blockedCount, slugsEnv, suburbCount }) {
  return category === 'rent' && blockedCount === 0 && !slugsEnv && suburbCount === SUBURB_SLUGS.length;
}

// Scoped to source='domain-web-unlocker' — other feeds (e.g. ingest-view-apify.mjs) also
// upsert into property_rentals, and this run must only ever expire rows it owns.
export async function expireUnseenRentals(sinceIso) {
  const suburbs = [...SERVICE_AREA].map(titleCase);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/property_rentals?suburb=in.(${suburbs.map(s => `"${s}"`).join(',')})&state=eq.VIC&source=eq.${SOURCE}&active=eq.true&last_seen_at=lt.${encodeURIComponent(sinceIso)}`,
    {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ active: false }),
    },
  );
  if (!res.ok) { console.error(`  expire rentals error ${res.status}: ${(await res.text()).slice(0, 200)}`); return 0; }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

async function main() {
  const startedAt = Date.now();
  const category = process.argv[2] || 'sold';
  const maxSuburbs = Number(process.argv[3]) || SUBURB_SLUGS.length;
  const cfg = CATEGORY[category];
  if (!cfg) { console.error('category must be sold|on-market|rent'); process.exit(1); }
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!WU_TOKEN) { console.error('Missing BRIGHTDATA_WEB_UNLOCKER_TOKEN'); process.exit(1); }
  // SLUGS=a,b,c env overrides the suburb set (e.g. to re-run failed suburbs).
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  console.log(`\n=== ${category} via Web Unlocker (${slugs.length} suburbs) ===`);

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
      const html = await fetchPage(url);
      const nodes = extractListings(html);
      const mapped = nodes.map(n=>mapListing(category, n)).filter(Boolean).filter(r=>inArea(r.suburb));
      console.log(`  ${slug}: ${nodes.length} listings → ${mapped.length} in-area`);
      return { slug, mapped };
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
  const upserted = await upsert(cfg.table, cfg.conflict, rows);
  console.log(`Upserted ${upserted} rows. Blocked: ${blockedSlugs.length}, empty: ${emptySlugs.length}, fetched-ok: ${fetchedOk}.`);

  // Only expire rent rows after a full run where every suburb fetched OK — a restricted
  // SLUGS re-run, a maxSuburbs-limited run, or ANY per-suburb fetch failure (not just a
  // fully blocked run) must never wrongly expire rentals in suburbs it didn't re-scrape.
  if (shouldExpireRentals({ category, blockedCount: blockedSlugs.length, slugsEnv: process.env.SLUGS, suburbCount: slugs.length })) {
    const expired = await expireUnseenRentals(new Date(startedAt).toISOString());
    console.log(`Expired ${expired} rentals not re-seen this run.`);
  }

  const status = deriveStatus({ blocked, items: upserted });
  const newestRowAt = await fetchNewestRowAt(sbCfg, cfg.table);
  await writeFeedHealth(sbCfg, { category, source_used: SOURCE, items: upserted, newest_row_at: newestRowAt, status });

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const summary = `category=${category} status=${status} items=${upserted} fetched_ok=${fetchedOk}/${slugs.length} blocked=${blockedSlugs.length} empty=${emptySlugs.length} duration=${durationS}s`;
  console.log(summary);
  if (blocked) {
    await pingFail(HEALTHCHECK_UUID, `BLOCKED ${summary}`);
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
