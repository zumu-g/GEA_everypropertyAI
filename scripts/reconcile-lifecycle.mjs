#!/usr/bin/env node
// ============================================================
// Nightly sold reconciliation (U4, R5/R21). Closed listings that match a recorded
// sale become lifecycle_status='sold', so withdrawn counts are not inflated by sales.
//
// Candidates:
//   (a) property_sales rows created since the last successful run (watermark from
//       the latest 'lifecycle-reconcile' feed_runs row; default 400 days back), and
//   (b) property_listings with lifecycle_status in (withdrawn, under_offer, sold)
//       removed or last seen within the last 400 days.
// Match: same address_slug, sale_date on/after the listing's basis date
// (listed_date ?? campaign_started_at ?? created_at) and no more than 400 days
// after it. On a match: PATCH lifecycle_status='sold' by id; removed_at untouched.
// An active listing is never reclassified. Raw PostgREST via fetch, like
// scripts/lib/feed-write.mjs; fetch/env injectable so tests use a fake.
//
// Usage: node scripts/reconcile-lifecycle.mjs [--dry-run]
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HEALTHCHECK_UUID (optional)
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { recordRun } from './lib/feed-write.mjs';
import { pingStart, pingSuccess, pingFail } from './lib/healthcheck.mjs';

export const CATEGORY = 'lifecycle-reconcile';
export const WINDOW_DAYS = 400;
const PAGE = 1000;
const MAX_PAGES = 50; // ponytail: 50k rows/run cap; raise or window by suburb if it ever trips
const URL_BUDGET = 6000;
const CLOSED = ['withdrawn', 'under_offer', 'sold'];
const DAY_MS = 86_400_000;

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** Listing's days-on-market basis, as YYYY-MM-DD. */
export function basisDate(listing) {
  return ymd(listing.listed_date ?? listing.campaign_started_at ?? listing.created_at);
}

/**
 * Pure matcher: earliest sale on the same slug with basis <= sale_date <= basis + 400d.
 * Returns null for an active listing or when nothing matches.
 */
export function pickSale(listing, sales) {
  if (!listing?.address_slug || !CLOSED.includes(listing.lifecycle_status)) return null;
  const basis = Date.parse(basisDate(listing));
  const eligible = sales.filter((s) => s.address_slug === listing.address_slug && s.sale_date
    && Date.parse(s.sale_date) >= basis && Date.parse(s.sale_date) <= basis + WINDOW_DAYS * DAY_MS);
  eligible.sort((a, b) => Date.parse(a.sale_date) - Date.parse(b.sale_date));
  return eligible[0] ?? null;
}

const SALE_COLS = 'id,address_slug,sale_date';
const LISTING_COLS = 'id,address_slug,lifecycle_status,listed_date,campaign_started_at,created_at';
const page = (n) => `limit=${PAGE}&offset=${n * PAGE}`;

export function salesSinceQuery(sinceIso, pageNo) {
  return `property_sales?select=${SALE_COLS}&address_slug=not.is.null&sale_date=not.is.null&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc,id.asc&${page(pageNo)}`;
}
export function closedListingsQuery(cutoffIso, pageNo) {
  const c = encodeURIComponent(cutoffIso);
  return `property_listings?select=${LISTING_COLS}&address_slug=not.is.null&lifecycle_status=in.(${CLOSED.join(',')})&or=(removed_at.gte.${c},last_seen_at.gte.${c})&order=id.asc&${page(pageNo)}`;
}

/** PostgREST in.(...) values, quoted + encoded, chunked by URL length (as feed-write.mjs). */
function inChunks(values) {
  const enc = [...new Set(values)].map((v) => encodeURIComponent(`"${String(v).replace(/"/g, '\\"')}"`));
  const chunks = []; let cur = [], len = 0;
  for (const e of enc) {
    if (cur.length && len + e.length > URL_BUDGET) { chunks.push(cur); cur = []; len = 0; }
    cur.push(e); len += e.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => `in.(${c.join(',')})`);
}

function client({ fetch = globalThis.fetch, env = process.env }) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('[reconcile] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`[reconcile] ${init.method || 'GET'} ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => []);
  };
  return {
    get: (path) => call(path),
    async getAll(queryFor) {
      const out = [];
      for (let p = 0; p < MAX_PAGES; p++) {
        const rows = await call(queryFor(p));
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
      console.warn(`[reconcile] page cap ${MAX_PAGES}x${PAGE} hit — remainder picked up next run`);
      return out;
    },
    patch: (path, body) => call(path, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } }),
  };
}

/**
 * @param {{ fetch?: typeof fetch, env?: object, runStart?: string, dryRun?: boolean }} p
 * @returns {Promise<{ candidates: number, matched: number, sales: number, since: string }>}
 */
export async function reconcile({ fetch, env, runStart = new Date().toISOString(), dryRun = false } = {}) {
  const db = client({ fetch, env });
  const cutoff = new Date(Date.parse(runStart) - WINDOW_DAYS * DAY_MS).toISOString();
  const [last] = await db.get(`feed_runs?select=run_start&category=eq.${CATEGORY}&status=eq.ok&order=run_start.desc&limit=1`);
  const since = last?.run_start ?? cutoff;

  const [newSales, closedListings] = await Promise.all([
    db.getAll((p) => salesSinceQuery(since, p)),
    db.getAll((p) => closedListingsQuery(cutoff, p)),
  ]);
  // Cross-fill: closed listings for the new sales' slugs, and sales for the closed listings' slugs.
  const listings = new Map(closedListings.map((r) => [r.id, r]));
  for (const f of inChunks(newSales.map((s) => s.address_slug))) {
    for (const r of await db.get(`property_listings?select=${LISTING_COLS}&lifecycle_status=in.(${CLOSED.join(',')})&address_slug=${f}`)) listings.set(r.id, r);
  }
  const sales = new Map(newSales.map((s) => [s.id, s]));
  for (const f of inChunks(closedListings.map((l) => l.address_slug))) {
    for (const s of await db.get(`property_sales?select=${SALE_COLS}&sale_date=not.is.null&address_slug=${f}`)) sales.set(s.id, s);
  }
  const bySlug = new Map();
  for (const s of sales.values()) (bySlug.get(s.address_slug) ?? bySlug.set(s.address_slug, []).get(s.address_slug)).push(s);

  const toSold = [];
  for (const l of listings.values()) {
    const sale = pickSale(l, bySlug.get(l.address_slug) ?? []);
    if (sale && l.lifecycle_status !== 'sold') toSold.push({ id: l.id, slug: l.address_slug, was: l.lifecycle_status, sale_date: sale.sale_date });
  }
  const out = { candidates: listings.size, sales: sales.size, matched: toSold.length, since };
  console.log(`[reconcile] since=${since} candidates=${out.candidates} sales=${out.sales} matched=${out.matched}${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) { for (const t of toSold) console.log(`  ${t.was} → sold  ${t.slug}  sale ${t.sale_date}`); return out; }

  let patched = 0;
  for (const f of inChunks(toSold.map((t) => t.id))) {
    patched += (await db.patch(`property_listings?id=${f}&lifecycle_status=neq.active`, { lifecycle_status: 'sold' })).length;
  }
  await recordRun({ category: CATEGORY, source: 'reconcile', run_start: runStart, status: 'ok', seen: out.candidates, closed: patched,
    notes: { sales: out.sales, matched: out.matched, patched, since } }, { fetch, env });
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env.local in CI */ }
  const uuid = process.env.HEALTHCHECK_UUID;
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');
  await pingStart(uuid);
  try {
    const out = await reconcile({ dryRun });
    await pingSuccess(uuid, `candidates=${out.candidates} matched=${out.matched}`);
  } catch (e) {
    console.error(e);
    await pingFail(uuid, `BROKEN ${e?.message || e}`);
    process.exit(1);
  }
}
