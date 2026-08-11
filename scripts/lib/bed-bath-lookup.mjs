// ============================================================
// Bed/bath backfill lookup — shared by scripts/backfill-sale-beds-from-listings.mjs
// (one-off backfill) and scripts/ingest-domain-apify.mjs (CLI ingest path).
//
// Domain's sold-listings Apify actor never returns bedrooms/bathrooms for
// sold items (confirmed 2026-08-03 comparables-estimate investigation —
// raw_data carries nothing to re-parse either), so most property_sales rows
// have null beds/baths. A matching property_listings or property_rentals row
// for the same address often does carry them.
//
// TS equivalent (used by the live ingest route): findBedBathMatches in
// src/lib/db/queries.ts. Scripts are plain .mjs and cannot import TS, so this
// is a duplicate — same convention as normaliseAreaSqm in
// scripts/backfill-sold-areas-dates.mjs vs src/lib/utils/area.ts. Keep the
// matching logic (listings preferred, most-recently-seen wins on collision)
// in sync between the two.
// ============================================================

const normaliseAddressKey = (raw) => String(raw ?? '').trim().toLowerCase();

/**
 * Batch-resolve bed/bath matches for a set of {rawAddress, suburb} targets,
 * scoped to the relevant suburbs. property_listings is preferred over
 * property_rentals; within a table, the most-recently-seen row wins on a
 * normalised-address collision (e.g. a relisted property).
 *
 * @param {string} supabaseUrl
 * @param {string} serviceKey
 * @param {Array<{rawAddress: string, suburb?: string}>} targets
 * @returns {Promise<Map<string, {bedrooms?: number, bathrooms?: number, car_spaces?: number}>>}
 *   keyed by rawAddress.trim().toLowerCase()
 */
export async function findBedBathMatches(supabaseUrl, serviceKey, targets) {
  const result = new Map();
  if (!supabaseUrl || !serviceKey || targets.length === 0) return result;

  const suburbs = [...new Set(targets.map((t) => t.suburb).filter(Boolean))];
  if (suburbs.length === 0) return result;

  const targetKeys = new Set(targets.map((t) => normaliseAddressKey(t.rawAddress)));
  const resolvedFrom = new Map(); // key -> table name
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  for (const table of ['property_listings', 'property_rentals']) {
    const suburbFilter = `suburb=in.(${suburbs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')})`;
    const url = `${supabaseUrl}/rest/v1/${table}?${suburbFilter}&bedrooms=not.is.null&select=raw_address,bedrooms,bathrooms,car_spaces,last_seen_at&limit=5000`;
    let rows;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error(`[findBedBathMatches] ${table} query HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      rows = await res.json();
    } catch (err) {
      console.error(`[findBedBathMatches] ${table} query failed:`, err.message);
      continue;
    }

    for (const row of rows ?? []) {
      const key = normaliseAddressKey(row.raw_address);
      if (!targetKeys.has(key)) continue;
      const currentSource = resolvedFrom.get(key);
      if (currentSource && currentSource !== table) continue; // higher-priority table already matched
      const existing = result.get(key);
      if (existing && (row.last_seen_at ?? '') <= (existing.lastSeenAt ?? '')) continue; // not newer within this table
      result.set(key, {
        bedrooms: row.bedrooms ?? undefined,
        bathrooms: row.bathrooms ?? undefined,
        car_spaces: row.car_spaces ?? undefined,
        lastSeenAt: row.last_seen_at ?? undefined,
      });
      resolvedFrom.set(key, table);
    }
  }

  return result;
}

export { normaliseAddressKey };
