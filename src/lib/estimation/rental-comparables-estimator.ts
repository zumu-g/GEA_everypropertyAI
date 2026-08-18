/**
 * Comparables-based WEEKLY RENT range (CMA/AVM for rentals).
 *
 * Mirror of comparables-estimator.ts (sales) but for asking rents:
 *  1. Time-adjust each comparable rent to today using 12-month suburb median
 *     rent growth (falls back to a suburb PRICE-growth proxy when the rent
 *     series is unavailable — flagged, lowers confidence).
 *  2. Weight by similarity: distance, type, beds (heaviest for rent), baths,
 *     land (light), recency (fast decay — rentals are perishable).
 *  3. Central estimate via RENT-PER-BEDROOM normalisation (rent scales tightly
 *     with bedroom count), falling back to raw weighted-median rent when beds
 *     are unknown.
 *  4. Range + confidence from dispersion (weighted MAD) and effective count.
 *  5. Cross-checks: subject's own recent lease, suburb median rent, and
 *     yield-implied rent (sale estimate × gross yield) for internal consistency.
 *
 * Pure (no DB / network) — fully unit-testable. estimate-rental-service.ts
 * gathers the comparables and calls in here.
 */

import type { PriceEstimateResult } from './price-estimator';
import { weightedMedian, typeBucket, monthsSince, timeAdjust } from './comparables-estimator';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RentalComparable {
  rawAddress: string;
  suburb?: string;
  weeklyRent: number;
  /** Listing as-of date (property_rentals.created_at) — used for time-adjust + recency. */
  asOf: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  carSpaces?: number | null;
  landAreaSqm?: number | null;
  propertyType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number | null;
  /** Listing photo — display passthrough only, ignored by weighting. */
  imageUrl?: string | null;
  source?: string;
}

export interface RentalSubject {
  latitude?: number | null;
  longitude?: number | null;
  suburb: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  landAreaSqm?: number;
  /** Subject's own most-recent lease — cross-check. */
  priorRent?: { weeklyRent: number; date: string };
  /** Headline sale estimate (mid) — enables the yield cross-check. */
  saleEstimateMid?: number;
  /** Scraped third-party rent estimates (e.g. Allhomes) — cross-checks only. */
  externalRentEstimates?: Array<{ source: string; value: number }>;
}

export interface RentMarketInput {
  /** 12-month suburb median-rent growth %, for the subject's segment. */
  annualRentGrowth?: number;
  /** Suburb price annual-growth % — proxy when rent growth is missing. */
  priceAnnualGrowth?: number;
  /** Current suburb median weekly rent — cross-check. */
  medianRent?: number;
  /** Suburb gross yield % — for the yield cross-check. */
  grossYield?: number;
}

export interface WeightedRentalComp extends RentalComparable {
  adjustedRent: number;
  monthsAgo: number;
  weight: number;
}

export interface RentCrossCheck {
  label: string;
  value: number;
  divergencePct: number;
  flagged: boolean;
}

export interface RentalEstimateResult extends PriceEstimateResult {
  comparablesUsed: WeightedRentalComp[];
  compCount: number;
  crossChecks: RentCrossCheck[];
  usedProxyGrowth: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const MIN_RENT = 100;
export const MAX_RENT = 3000;
export const MIN_COMPS = 3;
export const IDEAL_COMPS = 8;

const WEIGHT_EPSILON = 1e-4;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Similarity weighting (rental-tuned) ───────────────────────────────────────

export function rentalSimilarityWeight(subject: RentalSubject, comp: RentalComparable): number {
  const subjBucket = typeBucket(subject.propertyType);
  const isUnit = subjBucket === 'unit';

  // Distance: tighter decay than sales (σ 1.0km) — rentals cluster densely.
  const wDistance =
    comp.distanceKm == null ? 0.6 : Math.exp(-(comp.distanceKm * comp.distanceKm) / (2 * 1.0 * 1.0));

  const compBucket = typeBucket(comp.propertyType);
  let wType: number;
  if (compBucket === 'unknown' || subjBucket === 'unknown') wType = 0.85;
  else wType = compBucket === subjBucket ? 1.0 : 0.45;

  // Beds drive rent hardest → penalise mismatch more than sales do.
  let wBeds = 1.0;
  if (subject.bedrooms != null && comp.bedrooms != null) {
    const diff = Math.abs(comp.bedrooms - subject.bedrooms);
    wBeds = diff === 0 ? 1.0 : diff === 1 ? 0.7 : 0.35;
  }

  let wBaths = 1.0;
  if (subject.bathrooms != null && comp.bathrooms != null) {
    const diff = Math.abs(comp.bathrooms - subject.bathrooms);
    wBaths = diff === 0 ? 1.0 : diff === 1 ? 0.92 : 0.8;
  }

  // Land barely affects rent → very light, houses only.
  let wLand = 1.0;
  if (!isUnit && subject.landAreaSqm && comp.landAreaSqm && comp.landAreaSqm > 0) {
    const ratio = comp.landAreaSqm / subject.landAreaSqm;
    wLand = Math.exp(-Math.abs(Math.log(ratio)) * 0.3);
  }

  // Recency: rentals perish fast — decay over ~9 months.
  const wRecency = Math.exp(-monthsSince(comp.asOf) / 9);

  return Math.max(WEIGHT_EPSILON, wDistance * wType * wBeds * wBaths * wLand * wRecency);
}

// ── Main entry point ───────────────────────────────────────────────────────────

export function estimateRentFromComparables(
  subject: RentalSubject,
  comps: RentalComparable[],
  market: RentMarketInput | null,
  now: Date = new Date(),
): RentalEstimateResult | null {
  // Growth: prefer real 12-month rent growth; else proxy from price growth.
  let annualGrowth = market?.annualRentGrowth;
  let usedProxyGrowth = false;
  if (annualGrowth == null) {
    annualGrowth = market?.priceAnnualGrowth ?? 0;
    usedProxyGrowth = market?.priceAnnualGrowth != null;
  }
  const monthlyGrowth = annualGrowth / 12 / 100;

  // Step A — clean & time-adjust.
  const cleaned: WeightedRentalComp[] = [];
  for (const c of comps) {
    if (!c.asOf) continue;
    if (!(c.weeklyRent > MIN_RENT && c.weeklyRent <= MAX_RENT)) continue;
    const monthsAgo = monthsSince(c.asOf, now);
    const adjustedRent = timeAdjust(c.weeklyRent, monthsAgo, monthlyGrowth);
    const weight = rentalSimilarityWeight(subject, c);
    cleaned.push({ ...c, monthsAgo, adjustedRent, weight });
  }

  if (cleaned.length < MIN_COMPS) return null;
  cleaned.sort((a, b) => b.weight - a.weight);

  const weights = cleaned.map((c) => c.weight);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const sumW2 = weights.reduce((s, w) => s + w * w, 0);

  // Step C — central estimate via $/bedroom normalisation when usable.
  const compsWithBeds = cleaned.filter((c) => c.bedrooms != null && c.bedrooms > 0).length;
  const usePerBed = subject.bedrooms != null && subject.bedrooms > 0 && compsWithBeds >= cleaned.length / 2;

  // impliedRent_i = the comp's signal expressed as a rent for the SUBJECT.
  const impliedRent = cleaned.map((c) =>
    usePerBed ? (c.adjustedRent / Math.max(c.bedrooms ?? subject.bedrooms ?? 1, 1)) * (subject.bedrooms as number) : c.adjustedRent,
  );

  // Whole dollars: a weighted median of time-adjusted rents is fractional
  // ($386.666…), which is meaningless for a weekly rent figure. Round up.
  const rentMid = Math.ceil(weightedMedian(impliedRent, weights));

  // Step D — dispersion, effective count, band.
  const absDev = impliedRent.map((v) => Math.abs(v - rentMid));
  const wMAD = weightedMedian(absDev, weights);
  const relDispersion = rentMid > 0 ? wMAD / rentMid : 0.2;
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : cleaned.length;

  const baseBand = clamp(relDispersion * 100 * 1.349, 6, 28);
  const countFactor = clamp(Math.sqrt(IDEAL_COMPS / nEff), 0.7, 1.6);
  let band = clamp(Math.round(baseBand * countFactor), 5, 30);

  const wDistVals = cleaned.map((c) => c.distanceKm ?? 3);
  const avgWeightedDistance = sumW > 0 ? wDistVals.reduce((s, d, i) => s + d * weights[i], 0) / sumW : 3;
  const avgWeightedMonths = sumW > 0 ? cleaned.reduce((s, c, i) => s + c.monthsAgo * weights[i], 0) / sumW : 0;

  let confidence =
    100 -
    relDispersion * 180 -
    Math.max(0, IDEAL_COMPS - nEff) * 4 -
    avgWeightedDistance * 4 -
    (avgWeightedMonths / 12) * 6 -
    (usedProxyGrowth ? 8 : 0);
  confidence = clamp(Math.round(confidence), 5, 92);

  // Step E — cross-checks.
  const crossChecks: RentCrossCheck[] = [];
  const pushCheck = (label: string, value: number | undefined, threshold: number) => {
    if (!value || value <= 0) return;
    const divergence = Math.abs(value - rentMid) / rentMid;
    const flagged = divergence > threshold;
    crossChecks.push({ label, value: Math.round(value), divergencePct: Math.round(divergence * 1000) / 10, flagged });
    if (flagged) {
      band = Math.min(Math.round(band * 1.25), 30);
      confidence = Math.max(confidence - 10, 5);
    }
  };

  if (subject.priorRent?.weeklyRent && subject.priorRent.date) {
    const m = monthsSince(subject.priorRent.date, now);
    if (m <= 12) pushCheck('Own recent rent (adjusted)', timeAdjust(subject.priorRent.weeklyRent, m, monthlyGrowth), 0.15);
  }
  pushCheck('Suburb median rent', market?.medianRent, 0.2);
  for (const ext of subject.externalRentEstimates ?? []) {
    pushCheck(`${ext.source} rent estimate`, ext.value, 0.15);
  }
  if (subject.saleEstimateMid && market?.grossYield) {
    pushCheck('Yield-implied rent', (subject.saleEstimateMid * (market.grossYield / 100)) / 52, 0.25);
  }

  const rentLow = Math.round(rentMid * (1 - band / 100));
  const rentHigh = Math.round(rentMid * (1 + band / 100));

  const corroborating = crossChecks.filter((c) => !c.flagged).map((c) => c.label);
  const diverging = crossChecks.filter((c) => c.flagged);
  const maxDistance = Math.max(0, ...cleaned.map((c) => c.distanceKm ?? 0));
  const methodology =
    `Based on ${cleaned.length} comparable rentals` +
    (maxDistance > 0 ? ` within ${maxDistance.toFixed(1)}km` : ' in the suburb') +
    (usePerBed ? ', normalised per bedroom' : '') +
    (annualGrowth ? `, time-adjusted ${usedProxyGrowth ? 'using price-growth proxy ' : ''}${annualGrowth.toFixed(1)}% p.a.` : '') +
    `. Weighted-median asking rent, ±${band}%.` +
    (corroborating.length ? ` ${corroborating.join(', ')} corroborate.` : '') +
    (diverging.length ? ` ${diverging.map((c) => `${c.label} diverges ${c.divergencePct}%`).join('; ')}.` : '') +
    ' Figures are asking rents.';

  return {
    priceLow: rentLow,
    priceMid: rentMid,
    priceHigh: rentHigh,
    confidenceBand: band,
    confidenceScore: confidence,
    confidenceLevel: confidence >= 75 ? 'high' : confidence >= 45 ? 'medium' : 'low',
    priceSource: 'rent-comparables',
    methodology,
    comparablesUsed: cleaned,
    compCount: cleaned.length,
    crossChecks,
    usedProxyGrowth,
  };
}
