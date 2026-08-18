import { describe, it, expect } from 'vitest';
import { calculateEnrichedPriceEstimate, type PriceEstimateInput, type MarketDataInput } from '../price-estimator';

const MARKET: MarketDataInput = { houses: { medianPrice: 720_000, annualGrowth: 8, medianRent: 565, grossYield: 4.06 } };

function saleMonthsAgo(months: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - months, 15).toISOString().split('T')[0];
}

describe('growth guard in sale-history path (plan 2026-08-18-002)', () => {
  const base: PriceEstimateInput = { propertyType: 'house', bedrooms: 3 };

  it('applies the dampened rate (8% → 5.6%) to the sale-history adjustment', () => {
    const res = calculateEnrichedPriceEstimate(
      { ...base, saleHistory: [{ price: 700_000, date: saleMonthsAgo(12) }] },
      MARKET,
    );
    // 12 months at 5.6%/12 monthly ≈ +5.75%; undamped 8% would be ≈ +8.3%
    expect(res!.priceMid).toBeGreaterThan(735_000);
    expect(res!.priceMid).toBeLessThan(745_000);
    expect(res!.methodology).toContain('5.6% p.a.');
    expect(res!.methodology).toContain('dampened from 8.0%');
    expect(res!.growthAdjustment!.annualGrowthUsed).toBeCloseTo(5.6, 5);
  });

  it('multi-year prior sale is NOT capped at ±15% total (uncapped timeAdjust variant)', () => {
    const res = calculateEnrichedPriceEstimate(
      { ...base, saleHistory: [{ price: 600_000, date: saleMonthsAgo(60) }] },
      MARKET,
    );
    // 60 months at 5.6%/12 ≈ ×1.322 — a ±15% cap would stop at 690k
    expect(res!.priceMid).toBeGreaterThan(700_000);
  });

  it('NaN suburb growth is treated as 0, not propagated', () => {
    const res = calculateEnrichedPriceEstimate(
      { ...base, saleHistory: [{ price: 700_000, date: saleMonthsAgo(12) }] },
      { houses: { medianPrice: 720_000, annualGrowth: NaN } },
    );
    expect(Number.isFinite(res!.priceMid)).toBe(true);
    expect(res!.priceMid).toBe(700_000);
  });
});
