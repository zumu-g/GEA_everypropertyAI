import { describe, it, expect } from 'vitest';
import {
  estimateRentFromComparables,
  type RentalComparable,
  type RentalSubject,
  type RentMarketInput,
} from '../rental-comparables-estimator';

const NOW = new Date('2026-06-05T00:00:00Z');

const SUBJECT: RentalSubject = {
  latitude: -38.1,
  longitude: 145.28,
  suburb: 'Cranbourne',
  propertyType: 'house',
  bedrooms: 3,
  bathrooms: 2,
};

const MARKET: RentMarketInput = { annualRentGrowth: 5, priceAnnualGrowth: 8, medianRent: 520, grossYield: 4 };

function dateMonthsAgo(months: number): string {
  return new Date(NOW.getFullYear(), NOW.getMonth() - months, NOW.getDate()).toISOString().split('T')[0];
}

function comp(
  rent: number,
  opts: Partial<{ distanceKm: number | null; monthsAgo: number; beds: number | null; baths: number | null; type: string | null }> = {},
  i = 0,
): RentalComparable {
  return {
    rawAddress: `${i} Rent St, Cranbourne VIC 3977`,
    suburb: 'Cranbourne',
    weeklyRent: rent,
    asOf: dateMonthsAgo(opts.monthsAgo ?? 2),
    bedrooms: opts.beds === undefined ? 3 : opts.beds,
    bathrooms: opts.baths === undefined ? 2 : opts.baths,
    propertyType: opts.type === undefined ? 'house' : opts.type,
    distanceKm: opts.distanceKm === undefined ? 0.4 : opts.distanceKm,
  };
}

describe('estimateRentFromComparables', () => {
  it('tight comps → narrow band, high confidence, /wk source', () => {
    const comps = Array.from({ length: 8 }, (_, i) => comp(520 + (i % 2 ? -10 : 10), { distanceKm: 0.3 }, i));
    const r = estimateRentFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.priceSource).toBe('rent-comparables');
    expect(r!.compCount).toBe(8);
    expect(r!.confidenceBand).toBeLessThanOrEqual(12);
    expect(r!.confidenceScore).toBeGreaterThanOrEqual(70);
    expect(r!.priceMid).toBeGreaterThan(480);
    expect(r!.priceMid).toBeLessThan(560);
  });

  it('fewer than MIN_COMPS → null', () => {
    expect(estimateRentFromComparables(SUBJECT, [comp(520, {}, 1), comp(530, {}, 2)], MARKET, NOW)).toBeNull();
  });

  it('drops out-of-range rents (<$100, >$3000)', () => {
    const comps = [comp(500, {}, 1), comp(520, {}, 2), comp(540, {}, 3), comp(50, {}, 4), comp(9000, {}, 5)];
    const r = estimateRentFromComparables(SUBJECT, comps, MARKET, NOW)!;
    expect(r.compCount).toBe(3);
    expect(r.priceMid).toBeGreaterThan(450);
    expect(r.priceMid).toBeLessThan(600);
  });

  it('$/bedroom normalisation lifts a 4-bed subject vs 3-bed comps', () => {
    const comps3 = Array.from({ length: 6 }, (_, i) => comp(450, { beds: 3 }, i)); // 150/bed
    const subj3 = estimateRentFromComparables({ ...SUBJECT, bedrooms: 3 }, comps3, MARKET, NOW)!;
    const subj4 = estimateRentFromComparables({ ...SUBJECT, bedrooms: 4 }, comps3, MARKET, NOW)!;
    expect(subj4.priceMid).toBeGreaterThan(subj3.priceMid); // 4 beds → ~600 vs ~450
    expect(subj4.priceMid).toBeGreaterThan(550);
  });

  it('null beds → falls back to raw-rent median (no crash)', () => {
    const comps = Array.from({ length: 4 }, (_, i) => comp(500, { beds: null }, i));
    const r = estimateRentFromComparables({ ...SUBJECT, bedrooms: undefined }, comps, MARKET, NOW)!;
    expect(r.compCount).toBe(4);
    expect(r.priceMid).toBeGreaterThan(450);
    expect(r.priceMid).toBeLessThan(560);
  });

  it('uses price-growth proxy when rent growth missing → flagged + lower confidence', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(520, { distanceKm: 0.3 }, i));
    const withRent = estimateRentFromComparables(SUBJECT, comps, MARKET, NOW)!;
    const proxy = estimateRentFromComparables(SUBJECT, comps, { ...MARKET, annualRentGrowth: undefined }, NOW)!;
    expect(proxy.usedProxyGrowth).toBe(true);
    expect(withRent.usedProxyGrowth).toBe(false);
    expect(proxy.confidenceScore).toBeLessThan(withRent.confidenceScore);
  });

  it('yield-implied rent cross-check flags a divergent sale estimate', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(520, { distanceKm: 0.3 }, i));
    // saleEstimateMid huge → implied rent (mid*4%/52) far above ~520 → flagged.
    const r = estimateRentFromComparables({ ...SUBJECT, saleEstimateMid: 2_000_000 }, comps, MARKET, NOW)!;
    const yc = r.crossChecks.find((c) => c.label === 'Yield-implied rent');
    expect(yc).toBeDefined();
    expect(yc!.flagged).toBe(true);
  });

  it('time-adjusts older comps upward with positive growth', () => {
    const old = Array.from({ length: 5 }, (_, i) => comp(500, { monthsAgo: 12, distanceKm: 0.3 }, i));
    const r = estimateRentFromComparables(SUBJECT, old, MARKET, NOW)!;
    expect(r.priceMid).toBeGreaterThan(500); // 5% p.a. over 12mo
  });
});
