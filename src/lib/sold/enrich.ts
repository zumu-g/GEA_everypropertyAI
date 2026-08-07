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

// ---------------------------------------------------------------------------
// Cross-source dedupe: one real sale can exist as vic-vg + rea-history-apify +
// profile-crawl rows with dates differing by days and prices slightly. Group
// rows for the same property whose sale_dates are within 90 days and prices
// within 10% (or either price null), and keep one row per group by source
// precedence.
// ---------------------------------------------------------------------------

const DEDUPE_WINDOW_DAYS = 90;
const DEDUPE_PRICE_TOLERANCE = 0.1;

/** Lower = more authoritative. Unknown sources rank last. */
function sourcePrecedence(source: string): number {
  switch (source) {
    case 'vic-vg': return 0;
    case 'domain-apify':
    case 'domain-web-unlocker': return 1;
    case 'rea-history-apify': return 2;
    case 'view-apify':
    case 'homely': return 3;
    case 'profile-crawl': return 4;
    default: return 5;
  }
}

/** Non-null count of the fields that make a row more useful to consumers. */
function rowRichness(r: PropertySaleRecord): number {
  return (r.bedrooms != null ? 1 : 0) + (r.bathrooms != null ? 1 : 0) + (r.listing_url ? 1 : 0);
}

function sameSale(a: PropertySaleRecord, b: PropertySaleRecord): boolean {
  const aMs = dayMs(a.sale_date);
  const bMs = dayMs(b.sale_date);
  if (aMs === null || bMs === null) return false;
  if (Math.abs(aMs - bMs) > DEDUPE_WINDOW_DAYS * 86_400_000) return false;
  const ap = a.sale_price;
  const bp = b.sale_price;
  if (typeof ap === 'number' && typeof bp === 'number') {
    return Math.abs(ap - bp) <= DEDUPE_PRICE_TOLERANCE * Math.max(ap, bp);
  }
  return true; // either price null → treat as the same sale
}

/** True when `a` should represent the group over `b`. */
function betterRow(a: PropertySaleRecord, b: PropertySaleRecord): boolean {
  const pa = sourcePrecedence(a.source);
  const pb = sourcePrecedence(b.source);
  if (pa !== pb) return pa < pb;
  const ra = rowRichness(a);
  const rb = rowRichness(b);
  if (ra !== rb) return ra > rb;
  return (a.sale_date ?? '') > (b.sale_date ?? '');
}

/**
 * Collapse near-duplicate rows of the same sale across sources. Rows are
 * grouped by address_slug (fallback: normalised raw_address); within an
 * address, rows whose sale_dates are within 90 days and prices within 10%
 * (or either price null) are one sale — kept row chosen by source precedence
 * (vic-vg > domain > rea-history-apify > view/homely > profile-crawl), ties
 * broken by richness (beds/baths/listing_url) then newest sale_date.
 * Preserves the input's relative row order. Pure — exported for tests.
 */
export function dedupeSalesAcrossSources(
  rows: readonly PropertySaleRecord[]
): PropertySaleRecord[] {
  // address key → clusters of rows considered the same sale
  const byAddress = new Map<string, PropertySaleRecord[][]>();
  const keep = new Map<PropertySaleRecord[], PropertySaleRecord>();
  const order: PropertySaleRecord[][] = [];

  for (const row of rows) {
    const key =
      row.address_slug || row.raw_address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let clusters = byAddress.get(key);
    if (!clusters) {
      clusters = [];
      byAddress.set(key, clusters);
    }
    const cluster = clusters.find((c) => c.some((r) => sameSale(r, row)));
    if (cluster) {
      cluster.push(row);
      const current = keep.get(cluster)!;
      if (betterRow(row, current)) keep.set(cluster, row);
    } else {
      const fresh = [row];
      clusters.push(fresh);
      keep.set(fresh, row);
      order.push(fresh);
    }
  }

  return order.map((c) => keep.get(c)!);
}

/**
 * Fetch-and-merge wrapper for routes: exactly two batched lookups for the
 * whole page of rows (profiles + listing dates), then the pure merge. Rows are
 * first deduped across sources (see dedupeSalesAcrossSources) so both
 * /api/sold-sales and /api/vendor-report return one row per real sale.
 */
export async function enrichSoldRowsFromDb(
  inputRows: readonly PropertySaleRecord[]
): Promise<EnrichedSoldResult[]> {
  const rows = dedupeSalesAcrossSources(inputRows);
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
