/**
 * External-feature batch enrichment (migration 009 + plan U3).
 *
 * Populates `property_features` (keyed by address_slug) with slow-changing
 * location signals the AVM trains on, sourced from the existing verifiable
 * Victorian providers:
 *   - planning zone/overlays + LGA  → enrichment/planning.ts (ArcGIS, no key)
 *   - nearest train station + km    → enrichment/transport.ts (Nominatim)
 *
 * Designed for offline/batch use (these signals change slowly), not per-request.
 * Each source is wrapped independently so one failing does NOT block the other
 * or fail the row (plan U3, R3). The remaining U3 signals (SEIFA, Vicmap parcel,
 * school catchments) are deferred until their sources are confirmed.
 */

import type { PlanningData } from '@/lib/enrichment/planning';
import type { NearbyTransport } from '@/lib/enrichment/transport';
import { fetchPlanningData } from '@/lib/enrichment/planning';
import { fetchNearbyTransport } from '@/lib/enrichment/transport';
import {
  selectFeatureEnrichmentCandidates,
  getFreshFeatureSlugs,
  upsertPropertyFeatures,
  type PropertyFeatureRow,
} from '@/lib/db/queries';

export const FEATURE_SOURCE = 'vic-planning+nominatim';

export interface FeatureEnrichmentResult {
  scanned: number;
  skippedFresh: number;
  enriched: number;
}

/**
 * Assemble a property_features row from already-fetched source outputs. Pure —
 * no I/O. Null/empty source results simply leave their columns absent (never
 * written as 0/''), so a partial enrichment is still a valid row.
 */
export function buildFeatureRow(
  slug: string,
  planning: PlanningData | null,
  transport: NearbyTransport[],
  fetchedAtIso: string
): PropertyFeatureRow {
  const row: PropertyFeatureRow = { address_slug: slug, source: FEATURE_SOURCE, fetched_at: fetchedAtIso };

  if (planning) {
    if (planning.zone?.code) row.planning_zone_code = planning.zone.code;
    if (planning.zone?.name) row.planning_zone_name = planning.zone.name;
    if (planning.council) row.planning_lga = planning.council;
    if (planning.overlays && planning.overlays.length > 0) row.planning_overlays = planning.overlays;
  }

  // Nearest train station = closest train-type stop (transport is distance-sorted).
  const station = transport.find((t) => t.type === 'train') ?? transport[0];
  if (station) {
    row.nearest_station_name = station.name;
    row.nearest_station_km = station.distanceKm;
  }

  return row;
}

/**
 * Fetch all live sources for one point and assemble its feature row. Each source
 * is isolated: a throw/empty from one leaves its columns absent without failing
 * the row (R3).
 */
export async function enrichFeaturesForPoint(
  slug: string,
  lat: number,
  lng: number,
  state: string,
  fetchedAtIso: string
): Promise<PropertyFeatureRow> {
  const [planning, transport] = await Promise.all([
    fetchPlanningData(lat, lng, state).catch((e) => {
      console.warn(`[feature-enrichment] planning failed for ${slug}:`, e);
      return null;
    }),
    fetchNearbyTransport(lat, lng).catch((e) => {
      console.warn(`[feature-enrichment] transport failed for ${slug}:`, e);
      return [] as NearbyTransport[];
    }),
  ]);

  return buildFeatureRow(slug, planning, transport, fetchedAtIso);
}

/**
 * Batch-enrich features for sold addresses. Paginates candidates, dedupes by
 * slug, skips slugs already enriched within `ttlMs`, fetches the rest (capped
 * concurrency), and upserts. Idempotent and fail-soft.
 */
export async function runFeatureEnrichment(
  opts: { maxRows?: number; pageSize?: number; ttlMs?: number; concurrency?: number } = {}
): Promise<FeatureEnrichmentResult> {
  const maxRows = opts.maxRows ?? 5_000;
  const PAGE = opts.pageSize ?? 500;
  const ttlMs = opts.ttlMs ?? 90 * 24 * 60 * 60 * 1000; // 90d — these change slowly
  const concurrency = opts.concurrency ?? 4; // gentle on Nominatim's 1 req/s limit

  let scanned = 0;
  let skippedFresh = 0;
  let enriched = 0;
  const seen = new Set<string>();

  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const candidates = await selectFeatureEnrichmentCandidates(offset, PAGE);
    if (candidates.length === 0) break;
    scanned += candidates.length;

    // Dedupe slugs within and across pages.
    const unique = new Map<string, { latitude: number; longitude: number; state: string }>();
    for (const c of candidates) {
      if (seen.has(c.address_slug) || unique.has(c.address_slug)) continue;
      unique.set(c.address_slug, { latitude: c.latitude, longitude: c.longitude, state: c.state });
    }

    const fresh = await getFreshFeatureSlugs([...unique.keys()], ttlMs);
    const todo = [...unique.entries()].filter(([slug]) => !fresh.has(slug));
    skippedFresh += unique.size - todo.length;
    for (const [slug] of unique) seen.add(slug);

    // Enrich in capped batches to respect the geo providers' rate limits.
    const fetchedAtIso = new Date().toISOString();
    for (let i = 0; i < todo.length; i += concurrency) {
      const batch = todo.slice(i, i + concurrency);
      const rows = await Promise.all(
        batch.map(([slug, p]) => enrichFeaturesForPoint(slug, p.latitude, p.longitude, p.state, fetchedAtIso)),
      );
      enriched += await upsertPropertyFeatures(rows);
    }

    if (candidates.length < PAGE) break;
  }

  return { scanned, skippedFresh, enriched };
}
