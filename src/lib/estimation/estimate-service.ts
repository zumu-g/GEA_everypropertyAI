/**
 * Server-side estimate orchestration. Gathers comparable sales from the DB
 * (radius/time ladder, then suburb fallback), runs the pure comparables
 * estimator, and falls back to the legacy suburb-median cascade when comps are
 * too sparse. Import `getEstimate` directly from server code (API route,
 * proposal, vendor-report) — no internal HTTP hop.
 */

import {
  getRowsNearby,
  haversineKm,
  getSalesForSuburb,
  type PropertySaleRecord,
} from '@/lib/db/queries';
import { fetchSuburbMarketData } from '@/lib/enrichment/market-data';
import { parseAddress, toSlug } from '@/lib/utils/address';
import {
  calculateEnrichedPriceEstimate,
  type PriceEstimateInput,
  type PriceEstimateResult,
  type MarketDataInput,
} from './price-estimator';
import {
  estimateFromComparables,
  typeBucket,
  MIN_COMPS,
  IDEAL_COMPS,
  MIN_PLAUSIBLE_SALE_PRICE,
  MAX_PLAUSIBLE_SALE_PRICE,
  type ComparableSale,
  type ComparableSubject,
  type ComparablesEstimateResult,
} from './comparables-estimator';

export interface EstimateSubjectInput {
  latitude?: number | null;
  longitude?: number | null;
  suburb: string;
  state?: string;
  postcode?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  landAreaSqm?: number;
  priorSale?: { price: number; date: string };
  activeListing?: { priceLow?: number; priceHigh?: number; priceMid?: number };
  excludeAddress?: string;
  /** Richer signals for the legacy fallback (sale/rental history, listing price). */
  fallbackInput?: PriceEstimateInput;
}

const RADIUS_LADDER_KM = [1, 2, 5];
const MAX_WINDOW_MONTHS = 36;
const SUBURB_WINDOW_DAYS = 1095; // 36 months (limitDays is in DAYS)

function priceSane(p?: number): p is number {
  return typeof p === 'number' && p > MIN_PLAUSIBLE_SALE_PRICE && p <= MAX_PLAUSIBLE_SALE_PRICE;
}

function withinMonths(saleDate: string | undefined, months: number, now: Date): boolean {
  if (!saleDate) return false;
  const d = new Date(saleDate);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  return d >= cutoff;
}

/** Type + bed prefilter. Allows unknowns; only hard-excludes a clear mismatch. */
function passesPrefilter(subject: EstimateSubjectInput, r: PropertySaleRecord): boolean {
  const sb = typeBucket(subject.propertyType);
  const cb = typeBucket(r.property_type);
  if (sb !== 'unknown' && cb !== 'unknown' && sb !== cb) return false;
  if (subject.bedrooms != null && r.bedrooms != null && Math.abs(r.bedrooms - subject.bedrooms) >= 2) {
    return false;
  }
  return true;
}

function toComparable(r: PropertySaleRecord, distanceKm: number | null): ComparableSale {
  return {
    rawAddress: r.raw_address,
    suburb: r.suburb,
    salePrice: r.sale_price as number,
    saleDate: r.sale_date as string,
    bedrooms: r.bedrooms ?? null,
    bathrooms: r.bathrooms ?? null,
    carSpaces: r.car_spaces ?? null,
    landAreaSqm: r.land_area_sqm ?? null,
    propertyType: r.property_type ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    distanceKm,
    source: r.source,
  };
}

/**
 * Normalised dedup key for a comparable's address — different sources format
 * the same address differently ("12 Smith St, Berwick VIC 3806" vs
 * "12 SMITH STREET BERWICK"), so key on the parsed-address slug (mirrors
 * src/app/api/comparable-sales/route.ts), falling back to the lowercased raw
 * string when parsing yields nothing. State/postcode are dropped from the key —
 * sources inconsistently include them ("… Berwick VIC 3806" vs "… BERWICK")
 * and the comp pool is already geographically constrained, so street+suburb
 * identifies the property.
 */
function compKey(rawAddress: string): string {
  const parsed = parseAddress(rawAddress);
  const slug = toSlug({ ...parsed, state: '', postcode: '' });
  return slug || rawAddress.trim().toLowerCase();
}

/** Keep the most-recent sale per address (slug-normalised across sources). */
function addComp(map: Map<string, ComparableSale>, c: ComparableSale, excludeAddress?: string) {
  const key = compKey(c.rawAddress);
  if (excludeAddress && key === compKey(excludeAddress)) return;
  const existing = map.get(key);
  if (!existing || (c.saleDate > existing.saleDate)) map.set(key, c);
}

/**
 * When the subject's bedrooms/land size are unknown, comparables can't be
 * matched on them — the comp pool skews to the suburb's typical stock and the
 * estimate can land well off. Lower confidence and say so, rather than
 * presenting a confident number.
 */
function applyAttributeGapPenalty<T extends PriceEstimateResult>(
  result: T,
  subject: EstimateSubjectInput
): T {
  const missing: string[] = [];
  if (subject.bedrooms == null) missing.push('bedroom count');
  if (subject.landAreaSqm == null) missing.push('land size');
  if (missing.length === 0) return result;

  result.confidenceScore = Math.max(5, result.confidenceScore - missing.length * 15);
  result.confidenceLevel =
    result.confidenceScore >= 75 ? 'high' : result.confidenceScore >= 45 ? 'medium' : 'low';
  result.methodology += ` Note: the property's ${missing.join(' and ')} ${
    missing.length > 1 ? 'are' : 'is'
  } unknown, so comparables could not be matched on ${
    missing.length > 1 ? 'them' : 'it'
  } — add property details to refine this estimate.`;
  return result;
}

export async function getEstimate(
  subject: EstimateSubjectInput,
  now: Date = new Date(),
): Promise<ComparablesEstimateResult | PriceEstimateResult | null> {
  const state = (subject.state ?? 'VIC').toUpperCase();
  const hasGeo =
    typeof subject.latitude === 'number' &&
    Number.isFinite(subject.latitude) &&
    typeof subject.longitude === 'number' &&
    Number.isFinite(subject.longitude);

  const marketData = (await fetchSuburbMarketData(
    subject.suburb,
    state,
    subject.postcode ?? '',
  )) as MarketDataInput | null;

  const comps = new Map<string, ComparableSale>();

  // ── Radius/time ladder (geo) ────────────────────────────────────────────────
  if (hasGeo) {
    const lat = subject.latitude as number;
    const lng = subject.longitude as number;
    for (const radius of RADIUS_LADDER_KM) {
      const box = await getRowsNearby<PropertySaleRecord>('property_sales', lat, lng, radius, 500);
      for (const r of box) {
        if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
        const dist = haversineKm(lat, lng, r.latitude, r.longitude);
        if (dist > radius) continue;
        if (!priceSane(r.sale_price)) continue;
        if (!withinMonths(r.sale_date, MAX_WINDOW_MONTHS, now)) continue;
        if (!passesPrefilter(subject, r)) continue;
        addComp(comps, toComparable(r, dist), subject.excludeAddress);
      }
      // Stop widening once we have enough recent (<=24mo) comps.
      const recentEnough = [...comps.values()].filter((c) => withinMonths(c.saleDate, 24, now)).length;
      if (recentEnough >= IDEAL_COMPS) break;
    }
  }

  // ── Suburb fallback (no coords, or still sparse) ─────────────────────────────
  if (comps.size < MIN_COMPS) {
    const vg = await getSalesForSuburb(subject.suburb, state, SUBURB_WINDOW_DAYS, 200);
    for (const r of vg) {
      if (!priceSane(r.sale_price)) continue;
      if (!r.sale_date) continue;
      if (!passesPrefilter(subject, r)) continue;
      addComp(comps, toComparable(r, null), subject.excludeAddress);
    }
  }

  const compList = [...comps.values()];
  const comparableSubject: ComparableSubject = {
    latitude: subject.latitude,
    longitude: subject.longitude,
    suburb: subject.suburb,
    propertyType: subject.propertyType,
    bedrooms: subject.bedrooms,
    bathrooms: subject.bathrooms,
    landAreaSqm: subject.landAreaSqm,
    priorSale: subject.priorSale,
    activeListing: subject.activeListing,
  };

  if (compList.length >= MIN_COMPS) {
    const result = estimateFromComparables(comparableSubject, compList, marketData, now);
    if (result) return applyAttributeGapPenalty(result, subject);
  }

  // ── Legacy fallback (suburb median + growth), with lowered confidence ─────────
  const fallbackInput: PriceEstimateInput =
    subject.fallbackInput ?? {
      propertyType: subject.propertyType,
      bedrooms: subject.bedrooms,
      bathrooms: subject.bathrooms,
      landAreaSqm: subject.landAreaSqm,
      priceFrom: subject.activeListing?.priceLow,
      priceTo: subject.activeListing?.priceHigh,
      priceNumeric: subject.activeListing?.priceMid,
      saleHistory: subject.priorSale ? [{ price: subject.priorSale.price, date: subject.priorSale.date }] : [],
    };

  const fallback = calculateEnrichedPriceEstimate(fallbackInput, marketData);
  if (fallback) {
    fallback.confidenceScore = Math.max(5, fallback.confidenceScore - 10);
    fallback.confidenceLevel =
      fallback.confidenceScore >= 75 ? 'high' : fallback.confidenceScore >= 45 ? 'medium' : 'low';
    fallback.methodology += ' (Insufficient comparable sales nearby; suburb-based estimate.)';
    // KTD5: the suburb-median cascade is a dwelling-price fallback — for a
    // vacant-land subject with too few land comps, a house/unit median is not
    // representative of land value. Floor confidence to 'low' and say so,
    // rather than presenting a confident dwelling-derived figure.
    if (typeBucket(subject.propertyType) === 'land') {
      fallback.confidenceScore = Math.min(fallback.confidenceScore, 20);
      fallback.confidenceLevel = 'low';
      fallback.methodology +=
        ' Insufficient vacant-land sales nearby; suburb dwelling medians are not representative of land value.';
    }
    return applyAttributeGapPenalty(fallback, subject);
  }

  return null;
}
