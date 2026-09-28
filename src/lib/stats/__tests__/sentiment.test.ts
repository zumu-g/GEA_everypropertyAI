import { describe, it, expect } from 'vitest';
import { computeSentiment, type SentimentInputs } from '../sentiment';

function month(i: number, overrides: Partial<SentimentInputs> = {}): SentimentInputs {
  return {
    saleToListRatio: 0.95 + i * 0.005,
    monthsOfSupply: 2 + i * 0.1,
    priceCutShare: 0.1 + i * 0.01,
    medianDaysOnMarket: 20 + i,
    auctionClearanceRate: 0.5 + i * 0.02,
    ...overrides,
  };
}
const twelve = Array.from({ length: 12 }, (_, i) => month(i));

describe('computeSentiment', () => {
  it('AE4: 5 months → null with insufficient-history; 12 months → integer 0..100', () => {
    const five = computeSentiment(month(6), twelve.slice(0, 5));
    expect(five.sentimentIndex).toBeNull();
    expect(five.sentimentBasis.reason).toBe('insufficient-history');
    const full = computeSentiment(month(6), twelve);
    expect(Number.isInteger(full.sentimentIndex)).toBe(true);
    expect(full.sentimentIndex).toBeGreaterThanOrEqual(0);
    expect(full.sentimentIndex).toBeLessThanOrEqual(100);
    expect(full.sentimentBasis.formula).toContain('mean');
    expect(full.sentimentBasis.window).toBe(12);
    expect(full.sentimentBasis.inputs).toHaveLength(5);
  });

  it('all inputs at their best → 100; at their worst → 0', () => {
    const best: SentimentInputs = {
      saleToListRatio: 2, monthsOfSupply: 0, priceCutShare: 0, medianDaysOnMarket: 0, auctionClearanceRate: 1,
    };
    const worst: SentimentInputs = {
      saleToListRatio: 0, monthsOfSupply: 99, priceCutShare: 1, medianDaysOnMarket: 999, auctionClearanceRate: 0,
    };
    expect(computeSentiment(best, twelve).sentimentIndex).toBe(100);
    expect(computeSentiment(worst, twelve).sentimentIndex).toBe(0);
  });

  it('inverted inputs: rising days on market lowers the index', () => {
    const slow = computeSentiment(month(6, { medianDaysOnMarket: 31 }), twelve);
    const quick = computeSentiment(month(6, { medianDaysOnMarket: 20 }), twelve);
    expect(slow.sentimentIndex!).toBeLessThan(quick.sentimentIndex!);
    const dom = slow.sentimentBasis.inputs.find((i) => i.name === 'medianDaysOnMarket')!;
    expect(dom.scaled).toBe(0); // at the top of the range, inverted
    expect(dom.weight).toBe(0.2);
  });

  it('caller passes only frozen non-reconstructed months: 2 real months → insufficient-history', () => {
    const r = computeSentiment(month(6), twelve.slice(0, 2));
    expect(r.sentimentIndex).toBeNull();
    expect(r.sentimentBasis.reason).toBe('insufficient-history');
  });

  it('drops an input with a degenerate range instead of dividing by zero', () => {
    const flat = twelve.map((m) => ({ ...m, monthsOfSupply: 3 }));
    const r = computeSentiment(month(6, { monthsOfSupply: 3 }), flat);
    expect(r.sentimentIndex).not.toBeNull();
    expect(Number.isFinite(r.sentimentIndex)).toBe(true);
    expect(r.sentimentBasis.inputs.map((i) => i.name)).not.toContain('monthsOfSupply');
  });

  it('drops a null current input (clearance under 5 auctions) and nulls under 2 inputs', () => {
    const r = computeSentiment(month(6, { auctionClearanceRate: null }), twelve);
    expect(r.sentimentBasis.inputs.map((i) => i.name)).not.toContain('auctionClearanceRate');
    const one = computeSentiment(
      { saleToListRatio: 1, monthsOfSupply: null, priceCutShare: null, medianDaysOnMarket: null, auctionClearanceRate: null },
      twelve,
    );
    expect(one.sentimentIndex).toBeNull();
    expect(one.sentimentBasis.reason).toBe('insufficient-history');
  });
});
