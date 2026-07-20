/**
 * Comparables-based valuation (CMA / AVM core).
 *
 * Produces a property's estimated price range from RECENT SALES OF NEARBY
 * COMPARABLE PROPERTIES — the signal the legacy `calculateEnrichedPriceEstimate`
 * (price-estimator.ts) ignores. This module is PURE (no DB / no network) so it
 * is fully unit-testable; the server-side `estimate-service.ts` gathers the
 * comparables and calls in here.
 *
 * Method (see plan curried-sleeping-castle.md):
 *  1. Time-adjust each comp to today via suburb annual-growth compounding
 *     (same formula + clamp as price-estimator.ts).
 *  2. Weight each comp by similarity: distance, type, beds, baths, land, recency.
 *     Missing attribute → factor 1.0 (never excluded for a NULL).
 *  3. Central estimate = weighted median of adjusted prices (robust to small-n
 *     and dirty Valuer-General rows; regression rejected — land/beds/baths are
 *     too often NULL).
 *  4. Range + confidence from comp DISPERSION (weighted MAD) AND effective count
 *     (Kish) — not a fixed ±%.
 *  5. Cross-checks (own prior sale, active listing, suburb median) flag
 *     divergence → widen band, lower confidence.
 */

import type { PriceEstimateResult, MarketDataInput } from './price-estimator';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComparableSale {
  rawAddress: string;
  suburb?: string;
  salePrice: number;
  saleDate: string; // ISO / YYYY-MM-DD
  bedrooms?: number | null;
  bathrooms?: number | null;
  carSpaces?: number | null;
  landAreaSqm?: number | null;
  propertyType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Great-circle distance from the subject, set by the caller when both have coords. */
  distanceKm?: number | null;
  source?: string;
}

export interface ComparableSubject {
  latitude?: number | null;
  longitude?: number | null;
  suburb: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  landAreaSqm?: number;
  /** Subject's own most-recent sale — used as a cross-check, not a comp. */
  priorSale?: { price: number; date: string };
  /** Active listing guide — used as a cross-check. */
  activeListing?: { priceLow?: number; priceHigh?: number; priceMid?: number };
}

export interface WeightedComp extends ComparableSale {
  adjustedPrice: number;
  monthsAgo: number;
  weight: number;
}

export interface CrossCheck {
  label: string;
  value: number;
  divergencePct: number;
  flagged: boolean;
}

export interface ComparablesEstimateResult extends PriceEstimateResult {
  comparablesUsed: WeightedComp[];
  compCount: number;
  crossChecks: CrossCheck[];
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_PLAUSIBLE_SALE_PRICE = 50_000_000;
export const MIN_PLAUSIBLE_SALE_PRICE = 50_000;
export const MIN_COMPS = 3;
export const IDEAL_COMPS = 8;

const GROWTH_CLAMP_LO = 0.33;
const GROWTH_CLAMP_HI = 3.0;
const WEIGHT_EPSILON = 1e-4;

// ── Property-type bucketing ───────────────────────────────────────────────────

const UNIT_TYPES = ['apartment', 'unit', 'studio', 'flat'];
const HOUSE_TYPES = ['house', 'townhouse', 'villa', 'duplex', 'terrace', 'semi'];

type TypeBucket = 'unit' | 'house' | 'land' | 'unknown';

/**
 * Explicit-string land detection only (never inferred from missing
 * beds/baths/building area — VG sold records routinely lack attributes for
 * real houses, so attribute-absence is not a safe land signal). Matches
 * "vacant land", "residential land"/"residentialLand", "new land"/"NewLand",
 * bare "land", and "development site". Excludes house-and-land PACKAGES
 * ("New House & Land" / "NewHouseLand") — those are houses, not vacant blocks.
 */
export function isVacantLandType(propertyType?: string | null): boolean {
  if (!propertyType) return false;
  const t = propertyType.toLowerCase();
  if (t.includes('house')) return false; // house-and-land package, not vacant land
  return t.includes('vacant') || t.includes('land') || t.includes('development site');
}

export function typeBucket(propertyType?: string | null): TypeBucket {
  if (!propertyType) return 'unknown';
  const t = propertyType.toLowerCase();
  if (UNIT_TYPES.some((u) => t.includes(u))) return 'unit';
  if (HOUSE_TYPES.some((h) => t.includes(h))) return 'house';
  if (isVacantLandType(propertyType)) return 'land';
  return 'unknown';
}

// ── Date / growth helpers (mirror price-estimator.ts) ─────────────────────────

/** Whole calendar months between `date` and now (>= 0). Matches price-estimator.ts. */
export function monthsSince(date: string, now: Date = new Date()): number {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

/** Time-adjust a sale price to today using compounded monthly growth, clamped. */
export function timeAdjust(price: number, monthsAgo: number, monthlyGrowth: number): number {
  const adj = price * Math.pow(1 + monthlyGrowth, monthsAgo);
  return Math.round(Math.max(price * GROWTH_CLAMP_LO, Math.min(price * GROWTH_CLAMP_HI, adj)));
}

// ── Similarity weighting ───────────────────────────────────────────────────────

/**
 * Multiplicative similarity weight in (0, 1]. Each factor defaults to 1.0 when
 * the relevant attribute is missing on either side (never penalise a NULL).
 */
export function similarityWeight(subject: ComparableSubject, comp: ComparableSale): number {
  const subjBucket = typeBucket(subject.propertyType);
  const isUnit = subjBucket === 'unit';

  // Distance: Gaussian decay (sigma 1.5km). Suburb-only comp (no distance) → 0.6.
  const wDistance =
    comp.distanceKm == null
      ? 0.6
      : Math.exp(-(comp.distanceKm * comp.distanceKm) / (2 * 1.5 * 1.5));

  // Property type bucket.
  const compBucket = typeBucket(comp.propertyType);
  let wType: number;
  if (compBucket === 'unknown' || subjBucket === 'unknown') wType = 0.85;
  else wType = compBucket === subjBucket ? 1.0 : 0.45;

  // Bedrooms.
  let wBeds = 1.0;
  if (subject.bedrooms != null && comp.bedrooms != null) {
    const diff = Math.abs(comp.bedrooms - subject.bedrooms);
    wBeds = diff === 0 ? 1.0 : diff === 1 ? 0.75 : 0.4;
  }

  // Bathrooms.
  let wBaths = 1.0;
  if (subject.bathrooms != null && comp.bathrooms != null) {
    const diff = Math.abs(comp.bathrooms - subject.bathrooms);
    wBaths = diff === 0 ? 1.0 : diff === 1 ? 0.9 : 0.75;
  }

  // Land (houses and vacant land), symmetric in log-space. Land subjects have
  // no beds/baths/building area to differentiate comps, so land-area
  // similarity is weighted more steeply (KTD4) — it's the dominant signal.
  let wLand = 1.0;
  if (!isUnit && subject.landAreaSqm && comp.landAreaSqm && comp.landAreaSqm > 0) {
    const ratio = comp.landAreaSqm / subject.landAreaSqm;
    const steepness = subjBucket === 'land' ? 2.0 : 0.7;
    wLand = Math.exp(-Math.abs(Math.log(ratio)) * steepness);
  }

  // Recency.
  const monthsAgo = monthsSince(comp.saleDate);
  const wRecency = Math.exp(-monthsAgo / 18);

  const w = wDistance * wType * wBeds * wBaths * wLand * wRecency;
  return Math.max(WEIGHT_EPSILON, w);
}

// ── Weighted statistics ───────────────────────────────────────────────────────

/** Weighted median of `values` with matching `weights` (both non-empty, same length). */
export function weightedMedian(values: number[], weights: number[]): number {
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] }))
    .sort((a, b) => a.v - b.v);
  const total = pairs.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return pairs[Math.floor(pairs.length / 2)].v;
  const half = total / 2;
  let cum = 0;
  for (let i = 0; i < pairs.length; i++) {
    cum += pairs[i].w;
    if (cum > half) return pairs[i].v;
    if (cum === half) {
      // Exact tie — average with the next distinct value if present.
      return i + 1 < pairs.length ? Math.round((pairs[i].v + pairs[i + 1].v) / 2) : pairs[i].v;
    }
  }
  return pairs[pairs.length - 1].v;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Main entry point ───────────────────────────────────────────────────────────

export function estimateFromComparables(
  subject: ComparableSubject,
  comps: ComparableSale[],
  marketData: MarketDataInput | null,
  now: Date = new Date(),
): ComparablesEstimateResult | null {
  const subjBucket = typeBucket(subject.propertyType);
  const isUnit = subjBucket === 'unit';
  const segment = isUnit ? marketData?.units : marketData?.houses;
  const annualGrowth = segment?.annualGrowth ?? 0;
  const monthlyGrowth = annualGrowth / 12 / 100;
  const suburbMedian = segment?.medianPrice;

  // Step A — clean & time-adjust.
  const cleaned: WeightedComp[] = [];
  for (const c of comps) {
    if (!c.saleDate) continue;
    if (!(c.salePrice > MIN_PLAUSIBLE_SALE_PRICE && c.salePrice <= MAX_PLAUSIBLE_SALE_PRICE)) continue;
    const monthsAgo = monthsSince(c.saleDate, now);
    const adjustedPrice = timeAdjust(c.salePrice, monthsAgo, monthlyGrowth);
    const weight = similarityWeight(subject, c);
    cleaned.push({ ...c, monthsAgo, adjustedPrice, weight });
  }

  if (cleaned.length < MIN_COMPS) return null;

  cleaned.sort((a, b) => b.weight - a.weight);

  const values = cleaned.map((c) => c.adjustedPrice);
  const weights = cleaned.map((c) => c.weight);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const sumW2 = weights.reduce((s, w) => s + w * w, 0);

  // Step C — central estimate (weighted median).
  const priceMid = weightedMedian(values, weights);

  // Step D — dispersion, effective count, band.
  const absDev = cleaned.map((c) => Math.abs(c.adjustedPrice - priceMid));
  const wMAD = weightedMedian(absDev, weights);
  const relDispersion = priceMid > 0 ? wMAD / priceMid : 0.2;
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : cleaned.length;

  const baseBand = clamp(relDispersion * 100 * 1.349, 6, 28);
  const countFactor = clamp(Math.sqrt(IDEAL_COMPS / nEff), 0.7, 1.6);
  let band = clamp(Math.round(baseBand * countFactor), 5, 30);

  // Confidence: penalise dispersion, low effective count, distance, staleness.
  const wDistVals = cleaned.map((c) => c.distanceKm ?? 3); // null coord ≈ 3km penalty
  const avgWeightedDistance = sumW > 0 ? wDistVals.reduce((s, d, i) => s + d * weights[i], 0) / sumW : 3;
  const avgWeightedMonths = sumW > 0 ? cleaned.reduce((s, c, i) => s + c.monthsAgo * weights[i], 0) / sumW : 0;

  let confidence =
    100 -
    relDispersion * 180 -
    Math.max(0, IDEAL_COMPS - nEff) * 4 -
    avgWeightedDistance * 4 -
    (avgWeightedMonths / 12) * 6;
  confidence = clamp(Math.round(confidence), 5, 92);

  // Step E — cross-checks (divergence flags).
  const crossChecks: CrossCheck[] = [];
  const pushCheck = (label: string, value: number | undefined, threshold: number) => {
    if (!value || value <= 0) return;
    const divergence = Math.abs(value - priceMid) / priceMid;
    const flagged = divergence > threshold;
    crossChecks.push({ label, value, divergencePct: Math.round(divergence * 1000) / 10, flagged });
    if (flagged) {
      band = Math.min(Math.round(band * 1.25), 30);
      confidence = Math.max(confidence - 10, 5);
    }
  };

  if (subject.priorSale?.price && subject.priorSale.date) {
    const m = monthsSince(subject.priorSale.date, now);
    pushCheck('Prior sale (adjusted)', timeAdjust(subject.priorSale.price, m, monthlyGrowth), 0.15);
  }
  const listingMid =
    subject.activeListing?.priceMid ??
    (subject.activeListing?.priceLow && subject.activeListing?.priceHigh
      ? Math.round((subject.activeListing.priceLow + subject.activeListing.priceHigh) / 2)
      : undefined);
  pushCheck('Listing guide', listingMid, 0.15);
  pushCheck('Suburb median', suburbMedian, 0.25);

  const priceLow = Math.round(priceMid * (1 - band / 100));
  const priceHigh = Math.round(priceMid * (1 + band / 100));

  const corroborating = crossChecks.filter((c) => !c.flagged).map((c) => c.label);
  const diverging = crossChecks.filter((c) => c.flagged);
  const checkNote =
    crossChecks.length > 0
      ? ` ${corroborating.length ? `${corroborating.join(', ')} corroborate${corroborating.length === 1 ? 's' : ''}.` : ''}` +
        `${diverging.length ? ` ${diverging.map((c) => `${c.label} diverges ${c.divergencePct > 0 ? '' : ''}${c.divergencePct}%`).join('; ')}.` : ''}`
      : '';

  const maxDistance = Math.max(0, ...cleaned.map((c) => c.distanceKm ?? 0));
  const compNoun = subjBucket === 'land' ? 'comparable vacant-land sales' : 'comparable sales';
  const methodology =
    `Based on ${cleaned.length} ${compNoun}` +
    (maxDistance > 0 ? ` within ${maxDistance.toFixed(1)}km` : ' in the suburb') +
    (annualGrowth ? `, time-adjusted using ${annualGrowth.toFixed(1)}% p.a. suburb growth` : '') +
    `. Weighted-median estimate, ±${band}%.` +
    checkNote;

  return {
    priceLow,
    priceMid,
    priceHigh,
    confidenceBand: band,
    confidenceScore: confidence,
    confidenceLevel: confidence >= 75 ? 'high' : confidence >= 45 ? 'medium' : 'low',
    priceSource: 'comparables',
    methodology,
    comparablesUsed: cleaned,
    compCount: cleaned.length,
    crossChecks,
  };
}
