/**
 * AVM attribute backfill (migration 008 + plan U2).
 *
 * Floor area, year built and features are already captured by the per-property
 * extraction/merge pipeline and stored in `property_cache` (a MergedPropertyProfile
 * per address_slug). They never reach the `property_sales`/`property_listings`/
 * `property_rentals` rows the AVM trains on, because those rows come from the
 * Domain feed and the merger only writes to the cache.
 *
 * This job closes that gap: for rows missing `building_area_sqm`, look up the
 * cached profile by `address_slug` and copy across building area, year built,
 * features and per-field confidence where the cache has them.
 *
 * Idempotent: rows already populated are skipped (candidate query filters on
 * NULL building_area_sqm), and the same run can be re-executed safely.
 */

import type { MergedPropertyProfile } from '@/types/property';
import {
  selectAvmBackfillCandidates,
  updateRowById,
  getCachedProfilesBySlugs,
  type AvmBackfillTable,
} from '@/lib/db/queries';

export interface AvmBackfillResult {
  table: AvmBackfillTable;
  scanned: number;
  updated: number;
}

/**
 * Build the column patch for a row from its cached profile. Pure — no I/O.
 *
 * Reads defensively across the two naming conventions in the codebase: the
 * merger keys merged scalars as `buildingArea`/`yearBuilt`, while the extraction
 * schema uses `buildingAreaSqm`. We accept either so a value is never missed.
 * Returns an empty object when the profile carries nothing useful.
 */
export function buildAvmPatch(profile: MergedPropertyProfile | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!profile) return patch;
  const d = (profile.data ?? {}) as Record<string, unknown>;

  const ba = d.buildingArea ?? d.buildingAreaSqm;
  if (typeof ba === 'number' && Number.isFinite(ba) && ba > 0) patch.building_area_sqm = ba;

  const yb = d.yearBuilt;
  if (typeof yb === 'number' && Number.isInteger(yb) && yb >= 1800 && yb <= 2100) patch.year_built = yb;

  const feats = d.features;
  if (Array.isArray(feats) && feats.length > 0) patch.features = feats;

  const conf = profile.fieldConfidences;
  if (conf && typeof conf === 'object' && Object.keys(conf).length > 0) patch.field_confidence = conf;

  return patch;
}

/**
 * Backfill one table from the cache. Paginates candidates, batches the cache
 * lookup by slug, and patches each row. Fail-soft per row.
 */
export async function backfillAvmAttributesFromCache(
  table: AvmBackfillTable,
  opts: { maxRows?: number; pageSize?: number } = {}
): Promise<AvmBackfillResult> {
  const maxRows = opts.maxRows ?? 10_000;
  const PAGE = opts.pageSize ?? 500;
  let scanned = 0;
  let updated = 0;

  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const rows = await selectAvmBackfillCandidates(table, offset, PAGE);
    if (rows.length === 0) break;
    scanned += rows.length;

    const slugs = [...new Set(rows.map((r) => r.address_slug))];
    const profiles = await getCachedProfilesBySlugs(slugs);

    for (const row of rows) {
      const patch = buildAvmPatch(profiles.get(row.address_slug));
      if (Object.keys(patch).length === 0) continue;
      if (await updateRowById(table, row.id, patch)) updated++;
    }

    if (rows.length < PAGE) break;
  }

  return { table, scanned, updated };
}
