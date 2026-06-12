/**
 * Shared sold-row enrichment for /api/sold-sales and /api/vendor-report.
 *
 * Takes raw `property_sales` rows and produces the camelCase JSON shape both
 * endpoints return, with the CMA enrichment fields:
 *
 *  - landAreaSqm:    0/negative treated as missing, profile fills blanks
 *  - buildingAreaSqm: sold record → cached profile → null
 *  - bedrooms/bathrooms/carSpaces: sold record → cached profile → null
 *  - firstListedDate: own listed_date → property_listings join (by slug) → null
 *  - daysOnMarket:   saleDate − firstListedDate, only when both exist and ≥ 0
 *
 * Precedence is strict "profile fills blanks": a non-null sold-record value is
 * never overridden, and nothing is ever fabricated — no source ⇒ null.
 * Profile key fallback mirrors src/app/api/street-details/route.ts
 * (landAreaSqm ?? landArea, buildingAreaSqm ?? buildingArea, garages ?? carSpaces).
 *
 * The listings join receives ALL candidate listed_dates per slug (an address
 * can have multiple campaigns) and selects the latest date that is ≤ sale_date;
 * when every candidate post-dates the sale, the join contributes nothing.
 */

import {
  getCachedProfilesBySlugs,
  getListedDatesBySlugs,
  type PropertySaleRecord,
} from '@/lib/db/queries';
import type { MergedPropertyProfile } from '@/types/property';
import { sqmOrNull } from '@/lib/utils/area';

export interface EnrichedSoldResult {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  salePrice: number | null;
  saleDate: string | null;
  settlementDate: string | null;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  firstListedDate: string | null;
  daysOnMarket: number | null;
  latitude: number | null;
  longitude: number | null;
  agencyName: string | null;
  agentName: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  source: string;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** "YYYY-MM-DD" (or ISO timestamp) → epoch ms at UTC midnight, or null. */
function dayMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/** Epoch ms → "YYYY-MM-DD". */
function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Select the campaign that most plausibly led to this sale: the latest
 * candidate listed_date that does not post-date the sale. Candidates that all
 * post-date the sale yield null (cross-listing noise, not the sold campaign).
 * With no sale_date we cannot attribute a campaign — return null rather than guess.
 */
export function selectFirstListedDate(
  saleDate: string | null | undefined,
  candidates: readonly string[] | undefined
): string | null {
  if (!candidates?.length) return null;
  const saleMs = dayMs(saleDate);
  if (saleMs === null) return null;
  let best: number | null = null;
  for (const c of candidates) {
    const t = dayMs(c);
    if (t === null || t > saleMs) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : ymd(best);
}

/** Whole days between listed and sold; null when either is missing or diff < 0. */
export function deriveDaysOnMarket(
  saleDate: string | null,
  firstListedDate: string | null
): number | null {
  const saleMs = dayMs(saleDate);
  const listedMs = dayMs(firstListedDate);
  if (saleMs === null || listedMs === null) return null;
  const days = Math.round((saleMs - listedMs) / 86_400_000);
  return days >= 0 ? days : null;
}

/**
 * Map one property_sales row to the enriched JSON shape.
 * `profile` and `listedDateCandidates` are looked up by the row's address_slug
 * by the caller (null/undefined when the row has no slug or no match).
 */
export function toEnrichedSoldResult(
  s: PropertySaleRecord,
  profile?: MergedPropertyProfile | null,
  listedDateCandidates?: readonly string[]
): EnrichedSoldResult {
  const data = (profile?.data ?? {}) as Record<string, unknown>;

  const landAreaSqm =
    sqmOrNull(s.land_area_sqm) ?? sqmOrNull(asNumber(data.landAreaSqm) ?? asNumber(data.landArea));
  const buildingAreaSqm =
    sqmOrNull(s.building_area_sqm) ??
    sqmOrNull(asNumber(data.buildingAreaSqm) ?? asNumber(data.buildingArea));

  const ownListed = s.listed_date ? (dayMs(s.listed_date) !== null ? ymd(dayMs(s.listed_date)!) : null) : null;
  const firstListedDate =
    ownListed ?? selectFirstListedDate(s.sale_date ?? null, listedDateCandidates);

  return {
    rawAddress: s.raw_address,
    suburb: s.suburb ?? null,
    postcode: s.postcode ?? null,
    salePrice: s.sale_price ?? null,
    saleDate: s.sale_date ?? null,
    settlementDate: s.settlement_date ?? null,
    landAreaSqm,
    buildingAreaSqm,
    propertyType: s.property_type ?? null,
    bedrooms: s.bedrooms ?? asNumber(data.bedrooms),
    bathrooms: s.bathrooms ?? asNumber(data.bathrooms),
    carSpaces: s.car_spaces ?? asNumber(data.garages) ?? asNumber(data.carSpaces),
    firstListedDate,
    daysOnMarket: deriveDaysOnMarket(s.sale_date ?? null, firstListedDate),
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    agencyName: s.agency_name ?? null,
    agentName: s.agent_name ?? null,
    listingUrl: s.listing_url ?? null,
    imageUrl: s.image_url ?? null,
    source: s.source,
  };
}

/**
 * Fetch-and-merge wrapper for routes: exactly two batched lookups for the
 * whole page of rows (profiles + listing dates), then the pure merge.
 */
export async function enrichSoldRowsFromDb(
  rows: readonly PropertySaleRecord[]
): Promise<EnrichedSoldResult[]> {
  const slugs = [...new Set(rows.map((s) => s.address_slug).filter((v): v is string => !!v))];
  const [profiles, listedDates] = await Promise.all([
    getCachedProfilesBySlugs(slugs),
    getListedDatesBySlugs(slugs),
  ]);
  return enrichSoldRows(rows, profiles, listedDates);
}

/** Pure batch merge: rows + lookup maps in, enriched rows out. */
export function enrichSoldRows(
  rows: readonly PropertySaleRecord[],
  profiles: ReadonlyMap<string, MergedPropertyProfile>,
  listedDates: ReadonlyMap<string, readonly string[]>
): EnrichedSoldResult[] {
  return rows.map((s) => {
    const slug = s.address_slug;
    return toEnrichedSoldResult(
      s,
      slug ? profiles.get(slug) ?? null : null,
      slug ? listedDates.get(slug) : undefined
    );
  });
}
