import { describe, it, expect } from 'vitest';
import {
  estimateFromComparables,
  timeAdjust,
  weightedMedian,
  monthsSince,
  typeBucket,
  isVacantLandType,
  similarityWeight,
  type ComparableSale,
  type ComparableSubject,
} from '../comparables-estimator';

const NOW = new Date('2026-06-05T00:00:00Z');

const SUBJECT: ComparableSubject = {
  latitude: -38.07,
  longitude: 145.32,
  suburb: 'Cranbourne',
  propertyType: 'house',
  bedrooms: 3,
  bathrooms: 2,
  landAreaSqm: 600,
};

const MARKET = { houses: { medianPrice: 800_000, annualGrowth: 6 }, units: { medianPrice: 500_000, annualGrowth: 4 } };

function dateMonthsAgo(months: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() - months, NOW.getDate());
  return d.toISOString().split('T')[0];
}

function comp(
  price: number,
  opts: Partial<{ distanceKm: number | null; monthsAgo: number; beds: number | null; baths: number | null; type: string | null; land: number | null }> = {},
  i = 0,
): ComparableSale {
  return {
    rawAddress: `${i} Test St, Cranbourne VIC 3977`,
    suburb: 'Cranbourne',
    salePrice: price,
    saleDate: dateMonthsAgo(opts.monthsAgo ?? 4),
    bedrooms: opts.beds === undefined ? 3 : opts.beds,
    bathrooms: opts.baths === undefined ? 2 : opts.baths,
    landAreaSqm: opts.land === undefined ? 600 : opts.land,
    propertyType: opts.type === undefined ? 'house' : opts.type,
    distanceKm: opts.distanceKm === undefined ? 0.5 : opts.distanceKm,
  };
}

describe('helpers', () => {
  it('typeBucket maps variants', () => {
    expect(typeBucket('Townhouse')).toBe('house');
    expect(typeBucket('Apartment')).toBe('unit');
    expect(typeBucket(null)).toBe('unknown');
    expect(typeBucket('warehouse-conversion')).toBe('house'); // contains "house"
  });

  it('typeBucket maps vacant-land variants to land', () => {
    for (const t of ['Vacant land', 'VacantLand', 'residential land', 'residentialLand', 'New land', 'NewLand', 'land', 'Development Site']) {
      expect(typeBucket(t)).toBe('land');
    }
  });

  it('typeBucket resolves house-and-land PACKAGES as house, not land', () => {
    expect(typeBucket('New House & Land')).toBe('house');
    expect(typeBucket('NewHouseLand')).toBe('house');
  });

  it('typeBucket leaves rural/farm as unknown (not yet a distinct bucket)', () => {
    // Pre-existing quirk: "AcreageSemiRural" contains "semi" (HOUSE_TYPES), so
    // it buckets as house — unrelated to the land-detection change here.
    expect(typeBucket('AcreageSemiRural')).toBe('house');
    expect(typeBucket('Rural')).toBe('unknown');
    expect(typeBucket('Farm')).toBe('unknown');
  });

  it('typeBucket(null | undefined | "") is unknown', () => {
    expect(typeBucket(null)).toBe('unknown');
    expect(typeBucket(undefined)).toBe('unknown');
    expect(typeBucket('')).toBe('unknown');
  });

  it('isVacantLandType matches explicit land strings, excludes house-and-land packages', () => {
    expect(isVacantLandType('Vacant land')).toBe(true);
    expect(isVacantLandType('VacantLand')).toBe(true);
    expect(isVacantLandType('residential land')).toBe(true);
    expect(isVacantLandType('residentialLand')).toBe(true);
    expect(isVacantLandType('New land')).toBe(true);
    expect(isVacantLandType('NewLand')).toBe(true);
    expect(isVacantLandType('land')).toBe(true);
    expect(isVacantLandType('Development Site')).toBe(true);
    expect(isVacantLandType('New House & Land')).toBe(false);
    expect(isVacantLandType('NewHouseLand')).toBe(false);
    expect(isVacantLandType('House')).toBe(false);
    expect(isVacantLandType(undefined)).toBe(false);
    expect(isVacantLandType(null)).toBe(false);
  });

  it('timeAdjust ~1.22x for 24 months at 10% p.a.', () => {
    const adj = timeAdjust(1_000_000, 24, 0.1 / 12);
    expect(adj).toBeGreaterThan(1_215_000);
    expect(adj).toBeLessThan(1_225_000);
  });

  it('timeAdjust clamps to 3x ceiling', () => {
    const adj = timeAdjust(1_000_000, 600, 0.1 / 12); // absurd horizon
    expect(adj).toBe(3_000_000);
  });

  it('weightedMedian respects weights', () => {
    expect(weightedMedian([100, 200, 300], [1, 1, 1])).toBe(200);
    // Heavy weight on the low value pulls the median down.
    expect(weightedMedian([100, 200, 300], [10, 1, 1])).toBe(100);
  });

  it('monthsSince is non-negative', () => {
    expect(monthsSince(dateMonthsAgo(12), NOW)).toBe(12);
    expect(monthsSince('2099-01-01', NOW)).toBe(0);
  });
});

describe('estimateFromComparables', () => {
  it('tight comps → narrow band, high confidence', () => {
    const comps = Array.from({ length: 8 }, (_, i) =>
      comp(800_000 + (i % 2 === 0 ? 2000 : -2000), { distanceKm: 0.4, monthsAgo: 4 }, i),
    );
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.priceSource).toBe('comparables');
    expect(r!.compCount).toBe(8);
    expect(r!.confidenceBand).toBeLessThanOrEqual(10);
    expect(r!.confidenceScore).toBeGreaterThanOrEqual(75);
    expect(r!.confidenceLevel).toBe('high');
    expect(r!.priceLow).toBeLessThan(r!.priceMid);
    expect(r!.priceHigh).toBeGreaterThan(r!.priceMid);
  });

  it('scattered comps → wider band, lower confidence than tight', () => {
    const tight = estimateFromComparables(
      SUBJECT,
      Array.from({ length: 8 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 3 }, i)),
      MARKET,
      NOW,
    )!;
    const scattered = estimateFromComparables(
      SUBJECT,
      [600, 700, 800, 900, 1000, 1100, 1200, 1300].map((k, i) =>
        comp(k * 1000, { distanceKm: 0.5 + i * 0.4, monthsAgo: 2 + i * 3 }, i),
      ),
      MARKET,
      NOW,
    )!;
    expect(scattered).not.toBeNull();
    expect(scattered.confidenceBand).toBeGreaterThan(tight.confidenceBand);
    expect(scattered.confidenceScore).toBeLessThan(tight.confidenceScore);
  });

  it('fewer than MIN_COMPS → null', () => {
    expect(estimateFromComparables(SUBJECT, [comp(800_000, {}, 1), comp(810_000, {}, 2)], MARKET, NOW)).toBeNull();
    expect(estimateFromComparables(SUBJECT, [], MARKET, NOW)).toBeNull();
  });

  it('null coords (suburb-only) still produces an estimate', () => {
    const comps = Array.from({ length: 5 }, (_, i) => comp(800_000, { distanceKm: null, monthsAgo: 6 }, i));
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.compCount).toBe(5);
  });

  it('drops implausible outliers without moving the median', () => {
    const comps = [
      comp(790_000, {}, 1),
      comp(800_000, {}, 2),
      comp(810_000, {}, 3),
      comp(60_000_000, {}, 4), // > MAX
      comp(0, {}, 5), // <= MIN
    ];
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.compCount).toBe(3);
    expect(r!.priceMid).toBeGreaterThan(700_000);
    expect(r!.priceMid).toBeLessThan(900_000);
  });

  it('null beds/baths/land are not excluded', () => {
    const comps = Array.from({ length: 4 }, (_, i) =>
      comp(800_000, { beds: null, baths: null, land: null }, i),
    );
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.compCount).toBe(4);
  });

  it('cross-check divergence flags and widens band', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 3 }, i));
    const base = estimateFromComparables(SUBJECT, comps, MARKET, NOW)!;
    const withDivergentPrior = estimateFromComparables(
      { ...SUBJECT, priorSale: { price: 1_200_000, date: dateMonthsAgo(0) } },
      comps,
      MARKET,
      NOW,
    )!;
    const flagged = withDivergentPrior.crossChecks.find((c) => c.label === 'Prior sale (adjusted)');
    expect(flagged?.flagged).toBe(true);
    expect(withDivergentPrior.confidenceBand).toBeGreaterThanOrEqual(base.confidenceBand);
    expect(withDivergentPrior.confidenceScore).toBeLessThan(base.confidenceScore);
  });

  it('land subject: land comps produce a "vacant-land sales" methodology note', () => {
    const landSubject: ComparableSubject = { ...SUBJECT, propertyType: 'Vacant land', bedrooms: undefined, bathrooms: undefined, landAreaSqm: 700 };
    const landComps = Array.from({ length: 5 }, (_, i) =>
      comp(350_000, { type: 'Vacant land', beds: null, baths: null, land: 650 + i * 20, distanceKm: 0.6 }, i),
    );
    const r = estimateFromComparables(landSubject, landComps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.methodology).toContain('comparable vacant-land sales');
  });

  it('land subject: land-area similarity dominates over a house subject at the same land ratio', () => {
    const landSubject: ComparableSubject = { ...SUBJECT, propertyType: 'Vacant land', bedrooms: undefined, bathrooms: undefined, landAreaSqm: 600 };
    const nearLandComp = comp(350_000, { type: 'Vacant land', beds: null, baths: null, land: 660 }, 1); // 10% bigger
    const farLandComp = comp(350_000, { type: 'Vacant land', beds: null, baths: null, land: 1800 }, 2); // 3x bigger
    const wNear = similarityWeight(landSubject, nearLandComp);
    const wFar = similarityWeight(landSubject, farLandComp);
    // Both compared against the equivalent house-subject weights at the same ratios.
    const houseNear = similarityWeight(SUBJECT, { ...nearLandComp, propertyType: 'house' });
    const houseFar = similarityWeight(SUBJECT, { ...farLandComp, propertyType: 'house' });
    // Land weighting is steeper: the near/far spread for land should be wider
    // (relatively) than for houses, since land-area is the dominant signal.
    expect(wFar / wNear).toBeLessThan(houseFar / houseNear);
  });
});
