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
const WU_TOKEN = process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN;
const WU_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || 'web_unlocker1';
const SOURCE = 'domain-web-unlocker';

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
if (!WU_TOKEN) { console.error('Missing BRIGHTDATA_WEB_UNLOCKER_TOKEN'); process.exit(1); }

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

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
const titleCase = (s) => s ? String(s).trim().split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ') : null;
const parseSaleDate = (t) => { const m=String(t||'').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/); if(!m)return null; const mm=MONTHS[m[2].toLowerCase()]; return mm?`${m[3]}-${mm}-${m[1].padStart(2,'0')}`:null; };
const parsePrice = (d) => { const n=Number(String(d||'').replace(/[^0-9]/g,'')); return Number.isFinite(n)&&n>0?n:null; };
const dollarAmts = (d) => [...String(d||'').matchAll(/\$\s?([\d,]+)/g)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>0);
const priceRange = (d) => { const a=dollarAmts(d); return a.length?{low:Math.min(...a),high:Math.max(...a)}:{low:null,high:null}; };
const num = (v) => typeof v==='number'&&Number.isFinite(v)?v:null;
const smallint = (v) => Number.isInteger(v)?v:null;

// One Domain listingModel → a DB row for the category, or null to skip.
function mapListing(category, node) {
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
  const { low, high } = priceRange(m.price);
  return { ...common, display_price: m.price ?? null, price_low: low, price_high: high, status: tag };
}

function extractListings(html) {
  const mm = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!mm) return [];
  let d; try { d = JSON.parse(mm[1]); } catch { return []; }
  const lm = d?.props?.pageProps?.componentProps?.listingsMap;
  return lm && typeof lm === 'object' ? Object.values(lm) : [];
}

// Web Unlocker intermittently returns 200 with an EMPTY body — retry on empty
// (and on transient 429/5xx) with backoff before giving up.
async function fetchPage(url, maxAttempts = 8) {
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WU_TOKEN}` },
        body: JSON.stringify({ zone: WU_ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 1000) return html;
        lastErr = `empty/short body (${html.length}b)`;
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
                   'on-market':{ path:'sale', table:'property_listings', conflict:'raw_address,source' } };

async function main() {
  const category = process.argv[2] || 'sold';
  const maxSuburbs = Number(process.argv[3]) || SUBURB_SLUGS.length;
  const cfg = CATEGORY[category];
  if (!cfg) { console.error('category must be sold|on-market'); process.exit(1); }
  // SLUGS=a,b,c env overrides the suburb set (e.g. to re-run failed suburbs).
  const slugs = process.env.SLUGS ? process.env.SLUGS.split(',').map(s=>s.trim()).filter(Boolean) : SUBURB_SLUGS.slice(0, maxSuburbs);
  console.log(`\n=== ${category} via Web Unlocker (${slugs.length} suburbs) ===`);

  const rows = [];
  let zeroYield = [];
  for (const slug of slugs) {
    const url = `https://www.domain.com.au/${cfg.path}/${slug}/`;
    try {
      const html = await fetchPage(url);
      const nodes = extractListings(html);
      const mapped = nodes.map(n=>mapListing(category, n)).filter(Boolean).filter(r=>inArea(r.suburb));
      rows.push(...mapped);
      console.log(`  ${slug}: ${nodes.length} listings → ${mapped.length} in-area`);
      if (mapped.length === 0) zeroYield.push(slug);
    } catch (e) {
      console.error(`  ${slug}: FAILED ${e.message}`);
      zeroYield.push(slug);
    }
  }

  console.log(`\nTotal in-area rows: ${rows.length}. Upserting into ${cfg.table}...`);
  const upserted = await upsert(cfg.table, cfg.conflict, rows);
  console.log(`Upserted ${upserted} rows. Zero-yield suburbs: ${zeroYield.length ? zeroYield.join(', ') : 'none'}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
