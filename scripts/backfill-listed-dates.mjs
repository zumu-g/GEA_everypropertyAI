#!/usr/bin/env node
// ============================================================
// REA listed-date probe and backfill (plan U6, R8/R10, caps per KTD9).
//
// The daily REA search feed (scripts/ingest-rea-apify.mjs) carries no listed date.
// This script asks the same Apify actor (`one-api/realestate-com-au-scraper`) for
// per-property detail in property_inputs mode — one billed item (US$0.003) per
// listing URL — and finds out whether that detail exposes a listed / first-seen
// date. It runs in two phases so a negative answer costs 20 items, not 1,500:
//
//   1. Probe: 20 active REA rows with a null listed_date in the five priority
//      suburbs. No date-like key in the returned items → print the keys, write a
//      feed_runs row (status 'probe-negative') and exit 0 without further spend.
//   2. Backfill: continue in batches up to BACKFILL_MAX_ITEMS (default 1,500,
//      probe included), PATCHing listed_date + listed_date_source='rea-detail' only
//      where listed_date is still null. One feed_runs row records fetched / dated /
//      failed / est_cost_usd.
//
// Run after two full REA sweeps so the selection is the live market only.
//
// EXECUTION-TIME UNKNOWN: the actor's property_inputs key name and the returned
// date key (if any) have not been seen live. findListedDate is deliberately loose
// about key names; the probe exists to answer this.
//
// Usage:
//   node scripts/backfill-listed-dates.mjs [--dry-run]
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_API_TOKEN,
//   BACKFILL_MAX_ITEMS (default 1500), BACKFILL_BATCH_SIZE (default 100).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { recordRun } from './lib/feed-write.mjs';

export const CATEGORY = 'listed-date-backfill';
export const SOURCE = 'rea-apify-one-api';
export const DATE_SOURCE = 'rea-detail';
export const PROBE_SIZE = 20;
export const COST_PER_ITEM_USD = 0.003;
export const SUBURBS = ['Berwick', 'Officer', 'Clyde North', 'Narre Warren', 'Pakenham'];
const ACTOR_ID = 'one-api~realestate-com-au-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const PAGE = 1000;

// ─── Pure helpers (tested) ───────────────────────────────────────────────────

/** PostgREST query for the candidate rows; `page` selects a 1,000-row slice. */
export function selectFilter(page = 0) {
  const suburbs = encodeURIComponent(SUBURBS.map((s) => `"${s}"`).join(','));
  return `property_listings?select=id,listing_url,raw_address,suburb&source=eq.${SOURCE}&active=eq.true&listed_date=is.null`
    + `&state=eq.VIC&suburb=in.(${suburbs})&listing_url=not.is.null&order=id&limit=${PAGE}&offset=${page * PAGE}`;
}

const DATE_KEY_RE = /listed|datelisted|firstseen|first_seen|dateposted|listingdate/i;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Explicit-format date string → 'YYYY-MM-DD', else null (ISO prefix, "10 Jan 2026", DD/MM/YYYY). */
function parseDate(v) {
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10); // epoch ms
  if (typeof v !== 'string') return null;
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; return mo ? iso(+m[3], mo, +m[1]) : null; }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

/**
 * First listed / first-seen date found on an actor item, as 'YYYY-MM-DD', or null.
 * Keys are matched case-insensitively; nested plain objects are searched two levels deep.
 */
export function findListedDate(item, depth = 0) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || depth > 2) return null;
  for (const [k, v] of Object.entries(item)) {
    if (DATE_KEY_RE.test(k.replace(/\s/g, ''))) { const d = parseDate(v); if (d) return d; }
  }
  for (const v of Object.values(item)) { const d = findListedDate(v, depth + 1); if (d) return d; }
  return null;
}

/** Probe first, then batches up to `max` items in total; `remaining` is what the cap leaves. */
export function planBatches(rows, { max = 1500, batch = 100 } = {}) {
  const probe = rows.slice(0, PROBE_SIZE);
  const rest = rows.slice(PROBE_SIZE, Math.max(PROBE_SIZE, max));
  const batches = [];
  for (let i = 0; i < rest.length; i += batch) batches.push(rest.slice(i, i + batch));
  return { probe, batches, remaining: Math.max(0, rows.length - probe.length - rest.length) };
}

// ─── IO ──────────────────────────────────────────────────────────────────────
function client({ fetch = globalThis.fetch, env = process.env }) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY, token = env.APIFY_API_TOKEN;
  if (!base || !key) throw new Error('[listed-dates] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!token) throw new Error('[listed-dates] missing APIFY_API_TOKEN');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (url, init = {}, label) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`[listed-dates] ${label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => []);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async candidates() {
      const out = [];
      for (let p = 0; ; p++) {
        const rows = await call(`${base}/rest/v1/${selectFilter(p)}`, { headers }, 'select');
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    patch: (id, body) => call(`${base}/rest/v1/property_listings?id=eq.${encodeURIComponent(id)}&listed_date=is.null`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body) }, 'patch'),
    /** Start a property_inputs run, wait for it, return its dataset items. */
    async detail(urls) {
      let run = (await call(`${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}&waitForFinish=60`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property_inputs: urls }) }, 'run start')).data;
      const deadline = Date.now() + 30 * 60_000;
      while (run.status === 'RUNNING' || run.status === 'READY') {
        if (Date.now() > deadline) throw new Error('[listed-dates] Apify run exceeded 30-min wait');
        await sleep(5000);
        run = (await call(`${APIFY_BASE}/actor-runs/${run.id}?token=${token}`, {}, 'run poll')).data;
      }
      if (run.status !== 'SUCCEEDED') throw new Error(`[listed-dates] Apify run ${run.id} ended ${run.status}: ${run.statusMessage || ''}`);
      const items = [];
      for (let offset = 0; ; offset += PAGE) {
        const chunk = await call(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&clean=true&offset=${offset}&limit=${PAGE}`, {}, 'dataset');
        if (!Array.isArray(chunk) || !chunk.length) break;
        items.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      return items;
    },
  };
}

/** Match returned items back to rows by listing URL (falls back to positional order). */
function matchItems(rows, items) {
  const byUrl = new Map();
  for (const it of items) {
    const u = Object.entries(it).find(([k, v]) => /url/i.test(k) && typeof v === 'string' && v.includes('realestate.com.au'))?.[1];
    if (u) byUrl.set(u.replace(/\/$/, ''), it);
  }
  return rows.map((r, i) => [r, byUrl.get(r.listing_url.replace(/\/$/, '')) ?? (byUrl.size ? null : items[i] ?? null)]);
}

/**
 * @param {{ fetch?: typeof fetch, env?: object, runStart?: string, dryRun?: boolean, maxItems?: number, batchSize?: number }} p
 */
export async function backfill({ fetch, env = process.env, runStart = new Date().toISOString(), dryRun = false,
  maxItems = Number(env.BACKFILL_MAX_ITEMS) || 1500, batchSize = Number(env.BACKFILL_BATCH_SIZE) || 100 } = {}) {
  const db = client({ fetch, env });
  const rows = await db.candidates();
  const plan = planBatches(rows, { max: maxItems, batch: batchSize });
  const bySuburb = Object.fromEntries(SUBURBS.map((s) => [s, rows.filter((r) => r.suburb === s).length]));
  console.log(`[listed-dates] candidates=${rows.length} ${JSON.stringify(bySuburb)} probe=${plan.probe.length} batches=${plan.batches.length}x≤${batchSize} cap=${maxItems} remaining=${plan.remaining}`);
  if (dryRun) { console.log('[listed-dates] dry-run — no actor run, no writes'); return { status: 'dry-run', candidates: rows.length, ...plan, probe: plan.probe.length, batches: plan.batches.length }; }
  if (!plan.probe.length) { console.log('[listed-dates] nothing to do'); return { status: 'empty', candidates: 0, fetched: 0, dated: 0, failed: 0, remaining: 0 }; }

  const totals = { fetched: 0, dated: 0, failed: 0 };
  const done = (status, notes) => recordRun({ category: CATEGORY, source: SOURCE, mode: 'property_inputs', run_start: runStart, status,
    ...totals, est_cost_usd: +(totals.fetched * COST_PER_ITEM_USD).toFixed(4), notes: { candidates: rows.length, remaining: plan.remaining, ...notes } }, { fetch, env });

  const runBatch = async (batch) => {
    const items = await db.detail(batch.map((r) => r.listing_url));
    totals.fetched += batch.length;
    let dated = 0;
    for (const [r, it] of matchItems(batch, items)) {
      const d = findListedDate(it);
      if (!d) { totals.failed++; continue; }
      await db.patch(r.id, { listed_date: d, listed_date_source: DATE_SOURCE });
      dated++;
    }
    totals.dated += dated;
    return { items, dated };
  };

  // Phase 1: probe.
  const probe = await runBatch(plan.probe);
  if (!probe.dated) {
    const keys = [...new Set(probe.items.flatMap((it) => Object.keys(it || {})))];
    console.log(`[listed-dates] PROBE NEGATIVE — no listed/first-seen date in ${probe.items.length} items. Keys: ${keys.join(', ')}`);
    await done('probe-negative', { keys });
    return { status: 'probe-negative', candidates: rows.length, ...totals, remaining: rows.length - totals.fetched, keys };
  }
  console.log(`[listed-dates] probe positive: ${probe.dated}/${plan.probe.length} dated — continuing`);

  // Phase 2: capped batches.
  for (const [i, batch] of plan.batches.entries()) {
    const { dated } = await runBatch(batch);
    console.log(`[listed-dates] batch ${i + 1}/${plan.batches.length}: ${dated}/${batch.length} dated (fetched=${totals.fetched} est $${(totals.fetched * COST_PER_ITEM_USD).toFixed(2)})`);
  }
  if (plan.remaining) console.log(`[listed-dates] cap ${maxItems} reached — ${plan.remaining} rows left for another run`);
  await done('ok', {});
  return { status: 'ok', candidates: rows.length, ...totals, remaining: plan.remaining };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env.local in CI */ }
  backfill({ dryRun: process.argv.includes('--dry-run') }).catch((e) => { console.error(e); process.exit(1); });
}
