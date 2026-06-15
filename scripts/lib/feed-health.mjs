// ============================================================
// feed_health writer for the scheduled ingest scripts (migration 007).
//
// Upserts one row per category after each run so /api/cron/feed-freshness and
// /api/admin/crawl-status can answer "did this feed run, did it get data, and is it
// ok / blocked / broken?". Mirrors src/lib/db/queries.ts writeFeedHealth(), but via
// raw PostgREST fetch since the .mjs scripts have no Supabase JS client.
//
// Fail-soft: a feed_health write must never crash the ingest run — errors are logged
// and swallowed.
//
// Status semantics:
//   ok      — run completed (items may be 0 for a genuine zero-yield day)
//   blocked — all sources/pages returned anti-bot/empty responses (no real data)
//   broken  — an unexpected error aborted the run
// ============================================================

/**
 * Upsert a feed_health row. Reads Supabase creds from the passed config (so the
 * caller controls env loading). Never throws.
 *
 * @param {{ supabaseUrl: string, serviceKey: string }} cfg
 * @param {{ category: 'sold'|'on-market'|'rent', source_used?: string, items: number,
 *           newest_row_at?: string|null, status: 'ok'|'blocked'|'broken' }} h
 * @returns {Promise<boolean>} true on a successful write
 */
export async function writeFeedHealth(cfg, h) {
  const { supabaseUrl, serviceKey } = cfg || {};
  if (!supabaseUrl || !serviceKey) {
    console.error('[feed-health] missing Supabase creds — skipping write');
    return false;
  }
  const nowIso = new Date().toISOString();
  const row = {
    category: h.category,
    last_run_at: nowIso,
    source_used: h.source_used ?? null,
    items: Number.isFinite(h.items) ? h.items : 0,
    newest_row_at: h.newest_row_at ?? null,
    status: h.status,
    updated_at: nowIso,
  };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/feed_health?on_conflict=category`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[feed-health] upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[feed-health]', e.message);
    return false;
  }
}

/** Pick the status from a run outcome: blocked overrides items; items>=0 → ok. */
export function deriveStatus({ blocked, items }) {
  if (blocked) return 'blocked';
  return 'ok';
}

/**
 * Fetch the newest created_at from a feed table (for feed_health.newest_row_at).
 * Never throws — returns null on any error so it can't break the run.
 *
 * @param {{ supabaseUrl: string, serviceKey: string }} cfg
 * @param {string} table
 * @returns {Promise<string|null>}
 */
export async function fetchNewestRowAt(cfg, table) {
  const { supabaseUrl, serviceKey } = cfg || {};
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/${table}?select=created_at&order=created_at.desc&limit=1`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data[0]?.created_at ? data[0].created_at : null;
  } catch {
    return null;
  }
}
