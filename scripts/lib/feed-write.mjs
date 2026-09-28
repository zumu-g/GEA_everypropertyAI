// ============================================================
// Shared feed-write path for the on-market and rental ingest scripts (KTD1).
//
// One module owns: stamping lifecycle fields on every upsert payload (R3, R7, R25),
// reopening closed rows that are seen again (R24), recording price history on first
// sight and on parsed-price change (KTD4, R11, R22), the source-scoped miss-counting
// sweep (KTD2, R4, R5) and the per-run feed_runs row. Raw PostgREST via fetch, like
// feed-health.mjs — no Supabase client, no Next.js imports. `fetch` and `env` are
// injectable so the tests run against a fake PostgREST.
//
// PostgREST notes that shape this code:
//   * Bulk upsert requires every object to carry the same keys; with
//     Prefer: missing=default a key missing from one object is written as DEFAULT
//     (which would reset campaign_started_at to now()). So every lifecycle column is
//     sent explicitly on every row.
//   * PATCH cannot express miss_count = miss_count + 1, so the sweep is three
//     filtered PATCHes: close rows already at miss >= 1 (sold / not sold), then mark
//     miss 1 on rows still at 0. Closing first keeps a row from taking two steps in
//     one run.
//   * `in.(...)` values are double-quoted and URL-encoded (addresses carry commas
//     and parentheses) and chunked to keep URLs under ~6 KB.
// ============================================================

import { lifecycleFromSource, saleMethodFromText, parsePriceRange, normaliseDisplay } from './lifecycle-status.mjs';

const UPSERT_CHUNK = 500;
const URL_BUDGET = 6000;
const MISS_GATE_HOURS = 20;

const TABLE_META = {
  property_listings: { historyName: 'listings', closeCol: 'removed_at', saleMethod: true },
  property_rentals: { historyName: 'rentals', closeCol: 'leased_at', saleMethod: false },
};

export function client({ fetch = globalThis.fetch, env = process.env } = {}) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('[feed-write] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const res = await fetch(`${base}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`[feed-write] GET ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
    async post(path, body, prefer) {
      const res = await fetch(`${base}/rest/v1/${path}`, { method: 'POST', headers: { ...headers, Prefer: prefer }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`[feed-write] POST ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
    async patch(path, body) {
      const res = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`[feed-write] PATCH ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const rows = await res.json().catch(() => []);
      return Array.isArray(rows) ? rows : [];
    },
    raw: fetch, base, headers,
  };
}

/** PostgREST `in.(...)` filter values: quoted (commas/parens safe) and URL-encoded, chunked by URL length. */
export function inChunks(values) {
  const enc = values.map((v) => encodeURIComponent(`"${String(v).replace(/"/g, '\\"')}"`));
  const chunks = []; let cur = [], len = 0;
  for (const e of enc) {
    if (cur.length && len + e.length > URL_BUDGET) { chunks.push(cur); cur = []; len = 0; }
    cur.push(e); len += e.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => `in.(${c.join(',')})`);
}

async function selectByAddress(db, path, addresses) {
  const out = [];
  for (const filter of inChunks(addresses)) out.push(...await db.get(`${path}&raw_address=${filter}`));
  return out;
}

const parsedFor = (meta, row) => meta.saleMethod
  ? parsePriceRange(row.display_price)
  : { low: row.weekly_rent ?? null, high: row.weekly_rent ?? null };

const numOrNull = (v) => (v == null ? null : Number(v));

/**
 * Stamp lifecycle fields, reopen closed rows, upsert, and record price history.
 *
 * @param {{ table: 'property_listings'|'property_rentals', source: string, runStart: string,
 *           rows: object[], fetch?: typeof fetch, env?: object }} p
 *   rows: mapped feed rows (raw_address, display_price, status, listing_url, price_low/high or
 *   weekly_rent, ...). A row may pre-set lifecycle_status (e.g. Homely soldOn → 'sold').
 * @returns {Promise<{ seen: number, newRows: number, reopened: number, priced: number }>}
 */
export async function writeFeedBatch({ table, source, runStart, rows, fetch, env }) {
  const meta = TABLE_META[table];
  if (!meta) throw new Error(`[feed-write] unsupported table ${table}`);
  const db = client({ fetch, env });
  const now = new Date(runStart);

  // Dedupe on identity (raw_address, source) — the upsert cannot hit one row twice in a batch.
  const byAddr = new Map();
  for (const r of rows) if (r?.raw_address) byAddr.set(r.raw_address, { ...r, source });
  const batch = [...byAddr.values()];
  if (!batch.length) return { seen: 0, newRows: 0, reopened: 0, priced: 0 };
  const addresses = batch.map((r) => r.raw_address);

  const existCols = ['raw_address', 'active', 'campaign_started_at', 'listed_date', 'listed_date_source', ...(meta.saleMethod ? ['sale_method', 'auction_date'] : [])].join(',');
  const [existingRows, historyRows] = await Promise.all([
    selectByAddress(db, `${table}?select=${existCols}&source=eq.${encodeURIComponent(source)}`, addresses),
    // Every history row for the batch, newest first; first per address is the latest observation.
    // ponytail: pulls all rows per identity (a handful each); a latest-per-identity view if this grows.
    selectByAddress(db, `listing_price_history?select=raw_address,display_price,price_low,price_high&table_name=eq.${meta.historyName}&source=eq.${encodeURIComponent(source)}&order=observed_at.desc`, addresses),
  ]);
  const existing = new Map(existingRows.map((r) => [r.raw_address, r]));
  const latest = new Map();
  for (const h of historyRows) if (!latest.has(h.raw_address)) latest.set(h.raw_address, h);

  let newRows = 0, reopened = 0;
  const payloads = [];
  const history = [];
  for (const row of batch) {
    const prev = existing.get(row.raw_address);
    const isNew = !prev;
    const reopen = !!prev && prev.active === false;
    if (isNew) newRows++;
    if (reopen) reopened++;

    const lifecycle_status = row.lifecycle_status ?? lifecycleFromSource(row.status, row);
    const payload = {
      ...row,
      lifecycle_status,
      last_seen_at: runStart,
      active: true,
      miss_count: 0,
      miss_marked_at: null,
      [meta.closeCol]: null,
      // Same campaign keeps its start; new identity or reopen starts at this run (R24).
      campaign_started_at: prev?.active && prev.campaign_started_at ? prev.campaign_started_at : runStart,
    };
    // Never overwrite a stored listed_date with null (a mapper that could not find one this run).
    if (row.listed_date == null && prev?.listed_date != null) {
      payload.listed_date = prev.listed_date;
      payload.listed_date_source = prev.listed_date_source ?? null;
    }
    if (meta.saleMethod) {
      const sm = saleMethodFromText(row.display_price, row.status, now);
      // Once auction, the method sticks for the campaign (KTD3) — not across a reopen.
      if (prev?.active && prev.sale_method === 'auction' && sm.sale_method !== 'auction') {
        sm.sale_method = 'auction'; sm.auction_date = prev.auction_date ?? null;
      }
      Object.assign(payload, sm);
    }
    payloads.push(payload);

    // Price history (KTD4): always on first sight; otherwise diff parsed prices, or text when neither parses.
    const cur = parsedFor(meta, row);
    const last = latest.get(row.raw_address);
    let changed = false;
    if (!last) changed = true;
    else if (lifecycle_status === 'sold' || lifecycle_status === 'under_offer') changed = false;
    else if (cur.low != null || cur.high != null) changed = cur.low !== numOrNull(last.price_low) || cur.high !== numOrNull(last.price_high);
    else if (last.price_low == null && last.price_high == null) changed = normaliseDisplay(row.display_price) !== normaliseDisplay(last.display_price);
    if (changed) {
      history.push({
        table_name: meta.historyName, raw_address: row.raw_address, source, listing_url: row.listing_url ?? null,
        observed_at: runStart, display_price: row.display_price ?? null, price_low: cur.low, price_high: cur.high,
      });
    }
  }

  for (let i = 0; i < payloads.length; i += UPSERT_CHUNK) {
    await db.post(`${table}?on_conflict=raw_address,source`, payloads.slice(i, i + UPSERT_CHUNK), 'resolution=merge-duplicates,missing=default,return=minimal');
  }
  for (let i = 0; i < history.length; i += UPSERT_CHUNK) {
    await db.post('listing_price_history', history.slice(i, i + UPSERT_CHUNK), 'return=minimal');
  }
  return { seen: payloads.length, newRows, reopened, priced: history.length };
}

/**
 * Source-scoped miss-counting sweep (KTD2). Only call after a verified full sweep.
 *
 * @param {{ table: 'property_listings'|'property_rentals', source: string, runStart: string,
 *           coverage: Record<string, { seen: number, truncated?: boolean }>, fetch?: typeof fetch, env?: object }} p
 *   coverage: every suburb the crawl attempted → rows seen there and whether pagination hit the cap.
 * @returns {Promise<{ miss1: number, closed: number, sweptSuburbs: string[],
 *           skippedSuburbs: { suburb: string, reason: 'truncated'|'low-coverage', seen: number, active: number }[] }>}
 */
export async function sweepSource({ table, source, runStart, coverage, fetch, env }) {
  const meta = TABLE_META[table];
  if (!meta) throw new Error(`[feed-write] unsupported table ${table}`);
  if (!source) throw new Error('[feed-write] sweepSource requires a source');
  const db = client({ fetch, env });
  const suburbs = Object.keys(coverage || {});
  const src = `source=eq.${encodeURIComponent(source)}`;

  // Coverage guard: active rows per suburb for this source before the sweep.
  const activeBy = new Map();
  for (const filter of inChunks(suburbs)) {
    for (const r of await db.get(`${table}?select=suburb&${src}&active=eq.true&suburb=${filter}`)) activeBy.set(r.suburb, (activeBy.get(r.suburb) || 0) + 1);
  }
  const sweptSuburbs = [], skippedSuburbs = [];
  for (const suburb of suburbs) {
    const seen = coverage[suburb]?.seen ?? 0, active = activeBy.get(suburb) || 0;
    if (coverage[suburb]?.truncated) skippedSuburbs.push({ suburb, reason: 'truncated', seen, active });
    else if (active > 0 && seen < 0.5 * active) skippedSuburbs.push({ suburb, reason: 'low-coverage', seen, active });
    else sweptSuburbs.push(suburb);
  }
  if (!sweptSuburbs.length) return { miss1: 0, closed: 0, sweptSuburbs, skippedSuburbs };

  const gate = new Date(new Date(runStart).getTime() - MISS_GATE_HOURS * 3600_000).toISOString();
  let miss1 = 0, closed = 0;
  for (const filter of inChunks(sweptSuburbs)) {
    const base = `${table}?${src}&suburb=${filter}&active=eq.true&last_seen_at=lt.${encodeURIComponent(runStart)}`
      + `&or=(miss_marked_at.is.null,miss_marked_at.lt.${encodeURIComponent(gate)})`;
    const close = { active: false, miss_count: 2, miss_marked_at: runStart, [meta.closeCol]: runStart };
    closed += (await db.patch(`${base}&miss_count=gte.1&lifecycle_status=eq.sold`, close)).length;
    closed += (await db.patch(`${base}&miss_count=gte.1&lifecycle_status=neq.sold`, { ...close, lifecycle_status: 'withdrawn' })).length;
    miss1 += (await db.patch(`${base}&miss_count=eq.0`, { miss_count: 1, miss_marked_at: runStart })).length;
  }
  return { miss1, closed, sweptSuburbs, skippedSuburbs };
}

/**
 * Write one feed_runs row. Fail-soft like writeFeedHealth: never throws.
 * @param {object} row feed_runs columns (category, source, mode, run_start, status, counts, notes)
 * @returns {Promise<boolean>}
 */
export async function recordRun(row, { fetch, env } = {}) {
  try {
    const db = client({ fetch, env });
    await db.post('feed_runs', { run_end: new Date().toISOString(), ...row }, 'return=minimal');
    return true;
  } catch (e) {
    console.error('[feed-write] feed_runs write failed:', e.message);
    return false;
  }
}

/** Startup check: the lifecycle columns must exist or the run stops before writing anything. */
export async function assertMigration({ table = 'property_listings', fetch, env, exit = process.exit } = {}) {
  const db = client({ fetch, env });
  try {
    await db.get(`${table}?select=lifecycle_status,miss_count,miss_marked_at,campaign_started_at&limit=1`);
  } catch (e) {
    console.error(`[feed-write] migration 015 not applied — run src/lib/db/migrations/015_listing_lifecycle_price_history_stats.sql (${e.message})`);
    exit(1);
  }
}
