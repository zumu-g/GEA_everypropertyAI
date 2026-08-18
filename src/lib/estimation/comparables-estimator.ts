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
  carSpaces?: number;
  landAreaSqm?: number;
  /** Subject's own most-recent sale — used as a cross-check, not a comp. */
  priorSale?: { price: number; date: string };
  /** Active listing guide — used as a cross-check. */
  activeListing?: { priceLow?: number; priceHigh?: number; priceMid?: number };
  /** Scraped third-party AVM estimates (Allhomes, OnTheHouse) — cross-checks
   * ONLY, never inputs to the median (KTD2, plan 2026-08-18-001). */
  externalEstimates?: Array<{ source: string; value: number }>;
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
/** Minimum land-similar comps the radius ladder must find (when the subject's
 * land size is known) before it's allowed to stop widening — see
 * isLandSimilar and estimate-service.ts's radius/time ladder. */
export const MIN_LAND_SIMILAR_COMPS = 3;

const GROWTH_CLAMP_LO = 0.33;
const GROWTH_CLAMP_HI = 3.0;
/** Fraction of the stated suburb growth applied when time-adjusting. Suburb
 * annual growth is a raw sales-median change (composition-sensitive — new/larger
 * stock selling inflates it beyond like-for-like appreciation), so we apply
 * standard AVM-style conservatism rather than the full rate.
 * See docs/plans/2026-08-18-002-fix-growth-rate-robustness-plan.md. */
export const GROWTH_DAMPENING = 0.7;
/** Annual growth rates beyond this are treated as data artefacts and clamped. */
export const MAX_ANNUAL_GROWTH_PCT = 12;
/** Max total time-adjustment applied to any single COMP (±15%), regardless of
 * age. Does not apply to the subject's own prior-sale/prior-rent cross-checks,
 * where multi-year adjustment is legitimate. */
export const MAX_TOTAL_ADJUST = 0.15;
const WEIGHT_EPSILON = 1e-4;
/** Ratio band matching similarityWeight's land decay inflection zone (see
 * wLand below) — a comp within this band is "close enough in size to
 * matter" for the comp-gathering land-similar-comp guarantee. */
const LAND_SIMILAR_RATIO_LO = 0.6;
const LAND_SIMILAR_RATIO_HI = 1.6;

/** Subjects at/above this land size (~1 acre) trade in a wider acreage market:
 * comp-gathering widens its radius ladder for them (estimate-service.ts) and
 * similarityWeight relaxes its distance decay so a genuine acreage comp 12km
 * away can outweigh a next-door suburban block. */
export const ACREAGE_MIN_SQM = 4046;
/** Distance-decay sigma (km): suburban subjects vs acreage subjects. */
const DISTANCE_SIGMA_KM = 1.5;
const ACREAGE_DISTANCE_SIGMA_KM = 8;

// ── Excess-land uplift (no land-similar comps found anywhere) ────────────────
// When the subject's block is far larger than every comp's, the weighted median
// degenerates to "house on a typical local block" (uniform down-weighting
// cancels out of a weighted median). Model the subject instead as that typical
// dwelling PLUS its excess non-subdividable land at a steeply diminishing
// marginal rate: land component scales as (subjectLand/typicalLand)^ALPHA.
// ponytail: heuristic with calibration knobs — ALPHA 0.3 puts a 20-acre
// Harkaway holding vs ~800m² comps at ~2.5x the base estimate; tune ALPHA/SHARE
// against real acreage sales when a backtest set exists.
/** Share of a typical comp's price attributed to its land. */
export const LAND_VALUE_SHARE = 0.5;
/** Diminishing-returns exponent on the land-size ratio. */
export const EXCESS_LAND_ALPHA = 0.3;
/** Uplift only fires when subject land ≥ this multiple of the typical comp's. */
export const EXCESS_LAND_MIN_RATIO = 2;
/** Ratio cap — beyond this, extra land adds nothing (data-artefact guard). */
export const EXCESS_LAND_MAX_RATIO = 200;

/** Uplifted mid for a subject whose land dwarfs the typical comp block, or
 * null when the ratio doesn't warrant it. Pure, unit-tested. */
export function excessLandUplift(
  priceMid: number,
  subjectLandSqm: number,
  typicalCompLandSqm: number,
): number | null {
  if (!(priceMid > 0) || !(subjectLandSqm > 0) || !(typicalCompLandSqm > 0)) return null;
  const ratio = subjectLandSqm / typicalCompLandSqm;
  if (ratio < EXCESS_LAND_MIN_RATIO) return null;
  const capped = Math.min(ratio, EXCESS_LAND_MAX_RATIO);
  return Math.round(
    priceMid * (1 - LAND_VALUE_SHARE + LAND_VALUE_SHARE * Math.pow(capped, EXCESS_LAND_ALPHA)),
  );
}

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

/**
 * Whether a comp's land size is "similar enough to matter" to a subject of
 * known land size — used by estimate-service.ts's radius/time ladder to
 * guarantee the comp pool isn't structurally skewed toward the area's
 * typical (often larger) block size for a below-typical subject. The ratio
 * band mirrors similarityWeight's land decay inflection zone so "similar" is
 * defined consistently between comp-gathering and comp-weighting.
 */
export function isLandSimilar(
  subjectLand: number | null | undefined,
  compLand: number | null | undefined,
): boolean {
  if (!subjectLand || subjectLand <= 0 || !compLand || compLand <= 0) return false;
  const ratio = compLand / subjectLand;
  return ratio >= LAND_SIMILAR_RATIO_LO && ratio <= LAND_SIMILAR_RATIO_HI;
}

// ── Date / growth helpers (mirror price-estimator.ts) ─────────────────────────

/** Whole calendar months between `date` and now (>= 0). Matches price-estimator.ts. */
export function monthsSince(date: string, now: Date = new Date()): number {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

/**
 * Guard a suburb annual-growth % before it drives time adjustment: clamp
 * extreme rates to ±MAX_ANNUAL_GROWTH_PCT, then (by default) dampen by
 * GROWTH_DAMPENING to discount composition inflation in raw sales medians.
 * Pass dampen=false for rates computed from the subject's own series
 * (e.g. the rental estimator's rent-series growth), which aren't
 * composition-inflated the same way.
 */
export function guardAnnualGrowth(annualGrowthPct: number, dampen = true): number {
  if (!Number.isFinite(annualGrowthPct)) return 0; // NaN from a malformed feed value would otherwise NaN the whole estimate
  const clamped = Math.max(-MAX_ANNUAL_GROWTH_PCT, Math.min(MAX_ANNUAL_GROWTH_PCT, annualGrowthPct));
  return dampen ? clamped * GROWTH_DAMPENING : clamped;
}

/**
 * Time-adjust a sale price to today using compounded monthly growth.
 * When `maxTotalAdjust` is given (comp adjustments), the compounded factor is
 * clamped to [1-max, 1+max]. Without it (subject's own prior-sale/rent paths,
 * legitimately multi-year), only the loose outer [0.33x, 3x] sanity bound applies.
 */
export function timeAdjust(price: number, monthsAgo: number, monthlyGrowth: number, maxTotalAdjust?: number): number {
  let factor = Math.pow(1 + monthlyGrowth, monthsAgo);
  factor = maxTotalAdjust != null
    ? Math.max(1 - maxTotalAdjust, Math.min(1 + maxTotalAdjust, factor))
    : Math.max(GROWTH_CLAMP_LO, Math.min(GROWTH_CLAMP_HI, factor));
  return Math.round(price * factor);
}

// ── Similarity weighting ───────────────────────────────────────────────────────

/**
 * Multiplicative similarity weight in (0, 1]. A missing attribute on the
 * SUBJECT side means "can't compare" → factor 1.0. A missing attribute on the
 * COMP side when the subject's value IS known is an uncertainty penalty
 * (wBeds 0.7, wLand 0.6) — never an exclusion, but no free pass either.
 */
export function similarityWeight(subject: ComparableSubject, comp: ComparableSale): number {
  const subjBucket = typeBucket(subject.propertyType);
  const isUnit = subjBucket === 'unit';

  // Distance: Gaussian decay. Suburb-only comp (no distance) → 0.6. Acreage
  // subjects use a wide sigma — their market is regional, and the tight sigma
  // would make a genuine acreage comp 12km away weigh less than an adjacent
  // suburban block, defeating the acreage radius widening.
  const sigma =
    !isUnit && subject.landAreaSqm && subject.landAreaSqm >= ACREAGE_MIN_SQM
      ? ACREAGE_DISTANCE_SIGMA_KM
      : DISTANCE_SIGMA_KM;
  const wDistance =
    comp.distanceKm == null
      ? 0.6
      : Math.exp(-(comp.distanceKm * comp.distanceKm) / (2 * sigma * sigma));

  // Property type bucket.
  const compBucket = typeBucket(comp.propertyType);
  let wType: number;
  if (compBucket === 'unknown' || subjBucket === 'unknown') wType = 0.85;
  else wType = compBucket === subjBucket ? 1.0 : 0.45;

  // Bedrooms. When the subject's bed count is known but the comp's is NULL,
  // that's an uncertainty penalty (mirrors the null-land rule below) — NULL-bed
  // VG rows at big-house prices otherwise ride into the weighted median at full
  // weight and drag small-property estimates toward the area's typical stock
  // (66A Duncan Dr investigation, plan 2026-08-18-001). A NULL on the SUBJECT
  // side still means "can't compare" → 1.0.
  let wBeds = 1.0;
  if (subject.bedrooms != null && comp.bedrooms != null) {
    const diff = Math.abs(comp.bedrooms - subject.bedrooms);
    wBeds = diff === 0 ? 1.0 : diff === 1 ? 0.6 : 0.25;
  } else if (subject.bedrooms != null && comp.bedrooms == null) {
    wBeds = 0.7;
  }

  // Bathrooms.
  let wBaths = 1.0;
  if (subject.bathrooms != null && comp.bathrooms != null) {
    const diff = Math.abs(comp.bathrooms - subject.bathrooms);
    wBaths = diff === 0 ? 1.0 : diff === 1 ? 0.9 : 0.75;
  }

  // Car spaces — mild secondary signal. VG rows carry car data patchily, so a
  // NULL on either side is "can't compare" (1.0), NOT an uncertainty penalty
  // like wBeds/wLand — penalising the many null-car comps would reshuffle
  // pools on a weak attribute.
  let wCars = 1.0;
  if (subject.carSpaces != null && comp.carSpaces != null) {
    const diff = Math.abs(comp.carSpaces - subject.carSpaces);
    wCars = diff === 0 ? 1.0 : diff === 1 ? 0.92 : 0.8;
  }

  // Land (houses and vacant land), symmetric in log-space. Land subjects have
  // no beds/baths/building area to differentiate comps, so land-area
  // similarity is weighted more steeply (KTD4) — it's the dominant signal.
  // House subjects normally lean on bed-diff weighting to discriminate size,
  // but when the subject's bedrooms are unknown (common — see comparables
  // pool investigation) that signal is unavailable, so land becomes the only
  // size discriminator and gets a steeper decay too.
  //
  // When we DO want to compare on land (subject's size is known) but the comp's
  // land size is unknown, that's an uncertainty penalty, not a free pass — same
  // treatment as wDistance's null-distance case just above, not the "missing
  // attribute defaults to 1.0" rule this function's docstring describes for
  // wBeds/wBaths. Discovered during the 28 Serene Way investigation: comps
  // with unknown land size were dominating the weighted median (full 1.0
  // weight, undiscounted) even after the land-similar-comp guarantee (U1) and
  // the steeper decay above (U2) — see
  // docs/plans/2026-08-03-001-fix-small-block-estimate-skew-plan.md.
  let wLand = 1.0;
  if (!isUnit && subject.landAreaSqm) {
    if (comp.landAreaSqm && comp.landAreaSqm > 0) {
      const ratio = comp.landAreaSqm / subject.landAreaSqm;
      // Known-bed house subjects used 0.7 — too shallow: a 600m² comp against a
      // 370m² subject kept ~71% weight, letting bigger-block stock dominate
      // (plan 2026-08-18-001). 1.2 drops that comp to ~56% while a same-size
      // comp stays at 1.0.
      const steepness = subjBucket === 'land' ? 2.0 : subject.bedrooms == null ? 1.5 : 1.2;
      wLand = Math.exp(-Math.abs(Math.log(ratio)) * steepness);
    } else {
      wLand = 0.6;
    }
  }

  // Recency.
  const monthsAgo = monthsSince(comp.saleDate);
  const wRecency = Math.exp(-monthsAgo / 18);

  const w = wDistance * wType * wBeds * wBaths * wCars * wLand * wRecency;
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

export interface EstimateFromComparablesOptions {
  /** True when comp-gathering's radius ladder exhausted all radii while still
   * short of MIN_LAND_SIMILAR_COMPS land-similar comps (subject.landAreaSqm
   * known but the local pool skews to larger blocks) — flags the estimate as
   * potentially skewed toward the area's typical size rather than the
   * subject's actual size. Set by estimate-service.ts's comp-gathering. */
  landSimilarSparse?: boolean;
}

export function estimateFromComparables(
  subject: ComparableSubject,
  comps: ComparableSale[],
  marketData: MarketDataInput | null,
  now: Date = new Date(),
  opts: EstimateFromComparablesOptions = {},
): ComparablesEstimateResult | null {
  const subjBucket = typeBucket(subject.propertyType);
  const isUnit = subjBucket === 'unit';
  const segment = isUnit ? marketData?.units : marketData?.houses;
  const rawAnnualGrowth = segment?.annualGrowth ?? 0;
  const annualGrowth = guardAnnualGrowth(rawAnnualGrowth);
  const monthlyGrowth = annualGrowth / 12 / 100;
  const suburbMedian = segment?.medianPrice;

  // Step A — clean & time-adjust.
  const cleaned: WeightedComp[] = [];
  for (const c of comps) {
    if (!c.saleDate) continue;
    if (!(c.salePrice > MIN_PLAUSIBLE_SALE_PRICE && c.salePrice <= MAX_PLAUSIBLE_SALE_PRICE)) continue;
    const monthsAgo = monthsSince(c.saleDate, now);
    const adjustedPrice = timeAdjust(c.salePrice, monthsAgo, monthlyGrowth, MAX_TOTAL_ADJUST);
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
  let priceMid = weightedMedian(values, weights);
  const rawMid = priceMid;

  // Step D — dispersion, effective count, band (against the RAW comp median —
  // the acreage uplift below is a model adjustment, not comp scatter).
  const absDev = cleaned.map((c) => Math.abs(c.adjustedPrice - rawMid));
  const wMAD = weightedMedian(absDev, weights);
  const relDispersion = rawMid > 0 ? wMAD / rawMid : 0.2;
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

  // Step D2 — excess-land uplift. Even the widened acreage radius ladder found
  // no land-similar comps, so the weighted median above is effectively "house
  // on a typical local block" (uniform land down-weighting cancels out of a
  // weighted median). Uplift for the subject's additional non-subdividable
  // land at a diminishing marginal rate, and be honest about it: band to max,
  // confidence capped low.
  let acreageNote = '';
  if (
    opts.landSimilarSparse &&
    !isUnit &&
    subject.landAreaSqm &&
    subject.landAreaSqm >= ACREAGE_MIN_SQM
  ) {
    const landKnown = cleaned.filter((c) => c.landAreaSqm && c.landAreaSqm > 0);
    if (landKnown.length >= MIN_COMPS) {
      const typicalLand = weightedMedian(
        landKnown.map((c) => c.landAreaSqm as number),
        landKnown.map((c) => c.weight),
      );
      const uplifted = excessLandUplift(priceMid, subject.landAreaSqm, typicalLand);
      if (uplifted != null) {
        priceMid = uplifted;
        band = 30;
        confidence = Math.min(confidence, 35);
        acreageNote =
          ` No sales of similarly-sized holdings (~${Math.round(subject.landAreaSqm)}m²) were found even after widening the search;` +
          ` the estimate takes the comparable-sales value of a dwelling on a typical local block (~${Math.round(typicalLand)}m²)` +
          ` and adds the remaining non-subdividable land at a diminishing marginal rate. Treat as indicative only.`;
      }
    }
  }

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
  for (const ext of subject.externalEstimates ?? []) {
    pushCheck(`${ext.source} estimate`, ext.value, 0.15);
  }
  // 0.25 let a 22.7% miss read as "corroborates" (66A Duncan Dr) — align with
  // the same-property checks. If the U6 backtest shows well-comped outlier
  // properties flagging too often, widen to 0.20 and record why.
  pushCheck('Suburb median', suburbMedian, 0.15);

  // Land-similar-comp sparsity note (R5) — the pool met MIN_COMPS/IDEAL_COMPS
  // but comp-gathering couldn't find enough land-similar comps even after
  // widening the full radius ladder, so the estimate may still skew toward
  // the area's typical (often larger) block size.
  let landSparseNote = '';
  if (opts.landSimilarSparse && !acreageNote) {
    const landDesc = subject.landAreaSqm ? `~${Math.round(subject.landAreaSqm)}m²` : 'its size';
    landSparseNote =
      ` Note: few sales of similarly-sized blocks (${landDesc}) were found nearby even after widening the search radius; this estimate may skew toward the area's typical (larger) block size.`;
    confidence = Math.max(confidence - 10, 5);
  }

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
    (annualGrowth
      ? `, time-adjusted using ${annualGrowth.toFixed(1)}% p.a.` +
        (annualGrowth !== rawAnnualGrowth ? ` (dampened from ${rawAnnualGrowth.toFixed(1)}% suburb growth)` : ' suburb growth')
      : '') +
    `. Weighted-median estimate, ±${band}%.` +
    checkNote +
    landSparseNote +
    acreageNote;

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
