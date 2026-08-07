#!/usr/bin/env node
// ============================================================
// Bulk backfill of per-property REA sale-history timelines → property_sales
// via the Apify actor `abotapi/realestate-au-scraper` with price-history
// enrichment (plan 2026-08-06-001, U2).
//
// Enumerates distinct known Casey/Cardinia addresses from property_sales +
// property_listings, batches them to the actor, maps each returned property's
// sale-type timeline events to property_sales rows (source='rea-history-apify'),
// and upserts with onConflict raw_address,sale_date,sale_price,source +
// ignore-duplicates so re-runs are idempotent.
//
// Resumable: progress persists to scripts/.backfill-sale-history-state.json
// after each batch. `--reset` clears it.
//
// Usage:
//   node scripts/backfill-sale-history-apify.mjs [--limit N] [--dry-run] [--reset]
//
// Env (from .env.local or process.env): NEXT_PUBLIC_SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, APIFY_API_TOKEN.
// ============================================================
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const ACTOR_ID = 'abotapi~realestate-au-scraper';
const SOURCE = 'rea-history-apify';
const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE) || 100; // addresses per actor run
const STATE_FILE = join(__dirname, '.backfill-sale-history-state.json');

// ─── Service-area guard (same set as scripts/ingest-rea-apify.mjs) ───────────
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

// ─── Address slug (replicates src/lib/utils/address.ts parseAddress+toSlug;
//     scripts can't import TS — if that file changes, change this) ────────────
const STREET_TYPE_MAP = {
  st: 'Street', str: 'Street', street: 'Street', rd: 'Road', road: 'Road',
  ave: 'Avenue', avenue: 'Avenue', dr: 'Drive', drive: 'Drive',
  cres: 'Crescent', crescent: 'Crescent', ct: 'Court', court: 'Court',
  pl: 'Place', place: 'Place', ln: 'Lane', lane: 'Lane', cct: 'Circuit', circuit: 'Circuit',
  tce: 'Terrace', terrace: 'Terrace', pde: 'Parade', parade: 'Parade',
  hwy: 'Highway', highway: 'Highway', blvd: 'Boulevard', boulevard: 'Boulevard',
  cl: 'Close', close: 'Close', way: 'Way', gr: 'Grove', grove: 'Grove',
  esp: 'Esplanade', esplanade: 'Esplanade', cr: 'Crescent', prom: 'Promenade', promenade: 'Promenade',
};
const AUSTRALIAN_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

function parseAddress(raw) {
  const cleaned = raw.trim().replace(/\s+/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let unit;
  let remaining = cleaned;
  const unitPrefixMatch = remaining.match(/^unit\s+(\w+)\s+/i);
  if (unitPrefixMatch) {
    unit = unitPrefixMatch[1];
    remaining = remaining.slice(unitPrefixMatch[0].length);
  } else {
    const slashUnitMatch = remaining.match(/^(\d+)\s*\/\s*/);
    if (slashUnitMatch) {
      unit = slashUnitMatch[1];
      remaining = remaining.slice(slashUnitMatch[0].length);
    }
  }
  const tokens = remaining.split(/\s+/).filter(Boolean);
  let postcode = '';
  if (tokens.length > 0 && /^\d{4}$/.test(tokens[tokens.length - 1])) postcode = tokens.pop();
  let state = '';
  if (tokens.length > 0) {
    const candidateState = tokens[tokens.length - 1].toUpperCase();
    if (AUSTRALIAN_STATES.includes(candidateState)) { state = candidateState; tokens.pop(); }
  }
  let streetNumber = '';
  if (tokens.length > 0 && /^\d+[a-zA-Z]?$/.test(tokens[0])) streetNumber = tokens.shift();
  let streetTypeIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (STREET_TYPE_MAP[tokens[i].toLowerCase()]) { streetTypeIndex = i; break; }
  }
  let streetName = '', streetType = '', suburb = '';
  if (streetTypeIndex >= 0) {
    streetName = tokens.slice(0, streetTypeIndex).join(' ');
    streetType = STREET_TYPE_MAP[tokens[streetTypeIndex].toLowerCase()] ?? tokens[streetTypeIndex];
    suburb = tokens.slice(streetTypeIndex + 1).join(' ');
  } else if (tokens.length >= 2) {
    streetName = tokens.slice(0, -1).join(' ');
    suburb = tokens[tokens.length - 1];
  } else {
    streetName = tokens.join(' ');
  }
  return { unit, streetNumber, streetName, streetType, suburb, state, postcode };
}

function toSlug(a) {
  return [a.unit, a.streetNumber, a.streetName, a.streetType, a.suburb, a.state, a.postcode]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function slugForRawAddress(raw) {
  try {
    const slug = toSlug(parseAddress(raw));
    return slug || null;
  } catch {
    return null;
  }
}

// ─── Actor input ─────────────────────────────────────────────────────────────
/**
 * EXECUTION-TIME UNKNOWN: the abotapi/realestate-au-scraper input schema has
 * not been validated against a live run. This is a plausible default shape —
 * the exact field names (searchInputs vs startUrls/queries, includePriceHistory
 * vs enrichment flag, limit name) MUST be validated in the U0-gated smoke run
 * (--limit 20) before a full run.
 */
export function buildActorInput(addresses) {
  return {
    searchInputs: addresses,
    includePriceHistory: true,
    limit: addresses.length,
  };
}

// ─── Mapping ─────────────────────────────────────────────────────────────────
const titleCase = (s) => s ? String(s).trim().split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ') : null;
const smallint = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

// Plausibility band for AU residential sale prices.
const PRICE_MIN = 10_000;
const PRICE_MAX = 20_000_000;
const inBand = (n) => Number.isFinite(n) && n >= PRICE_MIN && n <= PRICE_MAX;

/**
 * Plausible sale price from a number or a "$650,000" / "$650k" / "$1.2m"
 * string. The ENTIRE string (after stripping $ , and whitespace) must be a
 * plain number or number+k/m suffix — ranges like "$400k-$450k" → null.
 * Rejects anything outside [10_000, 20_000_000].
 */
function parsePrice(v) {
  if (typeof v === 'number') return inBand(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[$,\s]/g, '');
  let n = NaN;
  if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
  else {
    const m = s.match(/^(\d+(?:\.\d+)?)([km])$/i);
    if (m) n = Number(m[1]) * (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000);
  }
  return inBand(n) ? n : null;
}

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const isoDate = (y, mo, d) => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * Explicit-format date → 'YYYY-MM-DD', else null (mirrors parseFullSaleDate
 * in src/lib/jobs/persist-sale-history.ts). Accepts ISO prefix, "D Mon YYYY",
 * DD/MM/YYYY (AU day-first). Bare years and free-form strings → null.
 */
function parseSaleDate(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/); // 4 May 2019
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? isoDate(+m[3], mo, +m[1]) : null;
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY (AU)
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  return null;
}

export { parsePrice, parseSaleDate };

const SALE_RE = /\bsold\b|\bsale\b/i;
const NON_SALE_RE = /lease|rent|withdraw|listed|listing|auction\s*schedule/i;

function isSaleEvent(e) {
  const type = String(e?.type ?? e?.eventType ?? e?.category ?? '');
  return SALE_RE.test(type) && !NON_SALE_RE.test(type);
}

/**
 * One actor item (a property with a priceHistory timeline) → property_sales
 * rows. Tolerant of field-name variance; skips anything unusable. Returns []
 * rather than throwing on malformed input.
 */
export function mapItem(item) {
  if (!item || typeof item !== 'object') return [];
  const addr = item.address ?? {};
  const raw_address = (typeof addr === 'string' ? addr : addr.display ?? addr.full ?? addr.text ?? item.fullAddress) || null;
  const suburb = titleCase(typeof addr === 'object' ? addr.suburb ?? item.suburb : item.suburb);
  if (!raw_address || !inArea(suburb)) return [];
  // Guard against actor address/suburb mismatch: if the raw address string
  // itself parses to a suburb, that suburb must also be in-area.
  try {
    const parsedSuburb = parseAddress(raw_address).suburb;
    if (parsedSuburb && !inArea(parsedSuburb)) return [];
  } catch { /* unparseable → keep declared-suburb behaviour */ }
  const address_slug = slugForRawAddress(raw_address);
  if (!address_slug) return [];
  const postcode = (typeof addr === 'object' ? addr.postcode ?? item.postcode : item.postcode) ?? null;
  const events = item.priceHistory ?? item.history ?? item.timeline;
  if (!Array.isArray(events)) return [];

  const rows = [];
  for (const e of events) {
    if (!e || typeof e !== 'object' || !isSaleEvent(e)) continue;
    const sale_date = parseSaleDate(e.date ?? e.eventDate ?? e.soldDate);
    if (!sale_date) continue; // dedup key needs a date
    const sale_price = parsePrice(e.price ?? e.amount ?? e.value);
    if (!sale_price) continue; // NULL price would break dedup (Postgres NULLs are distinct)
    rows.push({
      raw_address,
      address_slug,
      suburb,
      state: 'VIC',
      postcode: postcode != null ? String(postcode) : null,
      bedrooms: smallint(item.bedrooms ?? item.beds),
      bathrooms: smallint(item.bathrooms ?? item.baths),
      car_spaces: smallint(item.carSpaces ?? item.parking ?? item.cars),
      property_type: item.propertyType ?? null,
      listing_url: item.url ?? item.listingUrl ?? null,
      image_url: item.image ?? item.mainImage ?? null,
      sale_price,
      sale_date,
      source: SOURCE,
      raw_data: e,
    });
  }
  return rows;
}

// ─── Cursor state ────────────────────────────────────────────────────────────
export function loadState(file = STATE_FILE) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`State file ${file} exists but is unreadable/corrupt (${e.message}) — treating as fresh start.`);
    return null;
  }
}

export function saveState(file = STATE_FILE, state) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file); // atomic: never leaves a half-written state file
}

export function resetState(file = STATE_FILE) {
  try { unlinkSync(file); } catch { /* already gone */ }
}

// ─── Apify run + dataset paging (mirrors scripts/ingest-rea-apify.mjs) ───────
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

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/** Retry a transiently-failing async fn: 3 attempts, 2s backoff. */
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < 3) { console.warn(`  ${label} attempt ${attempt} failed (${e.message}) — retrying in 2s`); await sleep(2000); }
    }
  }
  throw lastErr;
}

async function getRun(runId) {
  return withRetry(async () => {
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${APIFY_TOKEN}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Apify run poll failed (${res.status})`);
    return (await res.json()).data;
  }, 'run poll');
}

async function waitForRun(run) {
  let r = run;
  const deadline = Date.now() + 30 * 60_000; // 30-min cap per batch
  while (r.status === 'RUNNING' || r.status === 'READY') {
    if (Date.now() > deadline) {
      // Best-effort abort so the actor stops billing before we bail.
      try {
        await fetch(`${APIFY_BASE}/actor-runs/${r.id}/abort?token=${APIFY_TOKEN}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
      } catch (e) { console.warn(`  abort of run ${r.id} failed: ${e.message}`); }
      throw new Error('Apify run exceeded 30-min wait');
    }
    await sleep(5000);
    r = await getRun(r.id);
  }
  return r;
}

async function pageDataset(datasetId) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const chunk = await withRetry(async () => {
      const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&offset=${offset}&limit=1000`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
      return res.json();
    }, 'dataset fetch');
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    items.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return items;
}

// ─── Supabase (REST; scripts can't import src/lib/db TS) ─────────────────────
async function fetchDistinctAddresses() {
  // Paged reads over both tables; dedupe on raw_address in-process.
  const by = new Map();
  for (const table of ['property_sales', 'property_listings']) {
    // Exclude this script's own output so the address universe stays frozen
    // across resumes (otherwise every run would invalidate the cursor digest).
    const sourceFilter = table === 'property_sales' ? `&source=neq.${SOURCE}` : '';
    for (let offset = 0; ; offset += 1000) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=raw_address,suburb,postcode${sourceFilter}&order=raw_address&offset=${offset}&limit=1000`;
      const res = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      if (!res.ok) throw new Error(`Fetch ${table} failed (${res.status}): ${(await res.text()).slice(0,200)}`);
      const rows = await res.json();
      for (const r of rows) {
        if (r.raw_address && inArea(r.suburb) && !by.has(r.raw_address)) by.set(r.raw_address, r);
      }
      if (rows.length < 1000) break;
    }
  }
  return [...by.values()];
}

// Upsert with ignore-duplicates on the property_sales dedup key
// (mirrors insertPropertySales in src/lib/db/queries.ts:931), chunked 500.
const CONFLICT = 'raw_address,sale_date,sale_price,source';

function dedupe(rows) {
  const cols = CONFLICT.split(',');
  const by = new Map();
  for (const r of rows) by.set(cols.map(c => String(r[c] ?? '')).join(' '), r);
  return [...by.values()];
}

async function insertSales(rows) {
  const deduped = dedupe(rows);
  let ok = 0;
  const failed = [];
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    let inserted = false;
    for (let attempt = 1; attempt <= 3 && !inserted; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/property_sales?on_conflict=${CONFLICT}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,missing=default,return=minimal',
        },
        body: JSON.stringify(chunk),
      }).catch((e) => ({ ok: false, status: 'fetch', text: async () => e.message }));
      if (res.ok) { ok += chunk.length; inserted = true; }
      else {
        console.error(`  insert chunk error ${res.status} (attempt ${attempt}/3): ${(await res.text()).slice(0,200)}`);
        if (attempt < 3) await sleep(2000);
      }
    }
    if (!inserted) failed.push(i);
  }
  // Throw so main() stops BEFORE saveState advances the cursor past lost rows.
  if (failed.length) throw new Error(`insertSales: ${failed.length} chunk(s) failed after 3 attempts (offsets ${failed.join(', ')})`);
  return ok;
}

// ─── Main ────────────────────────────────────────────────────────────────────
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limit = Number(argValue('--limit')) || null;
  if (process.argv.includes('--reset')) {
    resetState(STATE_FILE);
    console.log('State cleared.');
  }
  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
  if (!APIFY_TOKEN) { console.error('Missing APIFY_API_TOKEN'); process.exit(1); }

  console.log('Enumerating distinct in-area addresses from property_sales + property_listings...');
  let addresses = await fetchDistinctAddresses();
  addresses.sort((a, b) => a.raw_address.localeCompare(b.raw_address)); // stable order → resumable batches
  if (limit) addresses = addresses.slice(0, limit);
  const batches = [];
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) batches.push(addresses.slice(i, i + BATCH_SIZE));

  // Frozen-universe snapshot: digest of the sorted address list. The
  // enumeration excludes this script's own output (source filter above), so
  // the digest only changes when the upstream universe genuinely changes.
  const addressDigest = createHash('sha256')
    .update(addresses.map(a => a.raw_address).join('\n'))
    .digest('hex');

  const prev = loadState(STATE_FILE);
  let startBatch = 0;
  const totals = { inserted: 0, skippedEvents: 0, resolvedAddresses: 0, submittedAddresses: 0 };
  if (prev && prev.addressDigest === addressDigest) {
    startBatch = prev.nextBatch ?? 0;
    Object.assign(totals, prev.totals ?? {});
    console.log(`Resuming from batch ${startBatch}/${batches.length}.`);
  } else if (prev) {
    console.log('Address universe changed since last run — starting from batch 0.');
  }

  console.log(`${addresses.length} addresses in ${batches.length} batches of ≤${BATCH_SIZE}${dryRun ? ' (dry-run)' : ''}.`);

  for (let b = startBatch; b < batches.length; b++) {
    const batch = batches[b];
    const searchStrings = batch.map(a => a.raw_address);
    console.log(`\nBatch ${b + 1}/${batches.length}: ${batch.length} addresses → actor ${ACTOR_ID}...`);
    const started = await startRun(buildActorInput(searchStrings));
    const run = await waitForRun(started);
    if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}: ${run.statusMessage || ''}`);
    const items = await pageDataset(run.defaultDatasetId);
    const mapped = items.map(mapItem);
    const rows = mapped.flat();
    const itemsWithRows = mapped.filter(r => r.length > 0).length;
    // Resolution = distinct address_slugs that came back with data. Slug-based
    // because the actor may reformat the submitted address string.
    totals.submittedAddresses += batch.length;
    totals.resolvedAddresses += new Set(rows.map(r => r.address_slug)).size;
    console.log(`  ${items.length} items → ${rows.length} sale rows (${itemsWithRows} items yielded rows).`);

    if (dryRun) {
      console.log('  dry-run sample:', JSON.stringify(rows.slice(0, 3), null, 2));
    } else {
      const inserted = await insertSales(rows);
      totals.inserted += inserted;
      console.log(`  Upserted ${inserted} rows (ignore-duplicates).`);
    }
    totals.skippedEvents += Math.max(0, items.length - itemsWithRows);

    if (!dryRun) {
      saveState(STATE_FILE, { nextBatch: b + 1, addressDigest, addressCount: addresses.length, totals, updatedAt: new Date().toISOString() });
    }
  }

  const rate = totals.submittedAddresses
    ? ((totals.resolvedAddresses / totals.submittedAddresses) * 100).toFixed(1)
    : '0.0';
  console.log(`\nDone. submitted=${totals.submittedAddresses} resolved=${totals.resolvedAddresses} (${rate}% resolution) inserted=${totals.inserted} itemsWithoutRows=${totals.skippedEvents}`);
}

// Only run when invoked directly, so the pure helpers stay importable by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
