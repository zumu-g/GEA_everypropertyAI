#!/usr/bin/env node
// ============================================================
// One-off go-live step (U3): retire property_listings rows whose source has no
// scheduled sweep. 'domain-apify' (dormant webhook path) and 'gea-legacy-db' are
// never crawled again, so their rows would stay active=true forever and inflate
// every "on the market now" count. Sets active=false, removed_at=now,
// lifecycle_status='withdrawn' on the active rows of those sources and writes one
// feed_runs row with the count. Idempotent: a re-run finds nothing active.
//
// Usage:
//   node scripts/retire-unswept-sources.mjs          # dry run: prints the count
//   node scripts/retire-unswept-sources.mjs --apply  # executes
//
// Supabase creds read from .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { recordRun } from './lib/feed-write.mjs';

export const UNSWEPT_SOURCES = ['domain-apify', 'gea-legacy-db'];
export const TABLE = 'property_listings';

/** PostgREST filter for the rows to retire: active rows of an unswept source. */
export function retireFilter(sources = UNSWEPT_SOURCES) {
  return `source=in.(${sources.map((s) => `"${s}"`).join(',')})&active=eq.true`;
}

/** The PATCH body applied to those rows. */
export function retirePatch(nowIso) {
  return { active: false, removed_at: nowIso, lifecycle_status: 'withdrawn' };
}

/**
 * Count the active unswept rows; with apply, PATCH them closed and record one feed_runs row.
 * fetch/env injectable so tests use a fake (mirrors reconcile-lifecycle.mjs).
 * @returns {Promise<{ total: number, closed: number }>}
 */
export async function retire({ apply = false, fetch = globalThis.fetch, env = process.env, now = new Date() } = {}) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('[retire] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const runStart = now.toISOString();
  const url = `${base}/rest/v1/${TABLE}?${encodeURI(retireFilter())}`;

  const countRes = await fetch(`${url}&select=id`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(60_000) });
  if (!countRes.ok) throw new Error(`count failed ${countRes.status}: ${(await countRes.text()).slice(0, 200)}`);
  const total = Number((countRes.headers.get('content-range') || '').split('/')[1]) || 0;
  console.log(`${apply ? 'Retiring' : 'DRY RUN — would retire'} ${total} active ${TABLE} rows of source in (${UNSWEPT_SOURCES.join(', ')})`);
  if (!apply) return { total, closed: 0 };

  const res = await fetch(url, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(retirePatch(runStart)), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`patch failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const closed = (await res.json()).length;
  await recordRun({
    category: 'on-market', source: UNSWEPT_SOURCES.join('+'), mode: 'retire', run_start: runStart, status: 'ok',
    closed, notes: { reason: 'go-live retirement of unswept sources', sources: UNSWEPT_SOURCES },
  }, { fetch, env });
  console.log(`Retired ${closed} rows; feed_runs row written.`);
  return { total, closed };
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
  await retire({ apply: process.argv.includes('--apply') });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
