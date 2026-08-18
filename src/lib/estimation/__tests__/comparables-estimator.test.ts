import { describe, it, expect } from 'vitest';
import {
  guardAnnualGrowth,
  MAX_TOTAL_ADJUST,
  estimateFromComparables,
  timeAdjust,
  weightedMedian,
  monthsSince,
  typeBucket,
  isVacantLandType,
  isLandSimilar,
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

  it('isLandSimilar: within [0.6x, 1.6x] of subject land is similar, outside is not', () => {
    expect(isLandSimilar(300, 300)).toBe(true); // exact match
    expect(isLandSimilar(300, 180)).toBe(true); // 0.6x lower bound
    expect(isLandSimilar(300, 480)).toBe(true); // 1.6x upper bound
    expect(isLandSimilar(300, 179)).toBe(false); // just below lower bound
    expect(isLandSimilar(300, 481)).toBe(false); // just above upper bound
    expect(isLandSimilar(300, 700)).toBe(false); // typical-block comp, not similar to a small subject
  });

  it('isLandSimilar treats missing/zero/negative land on either side as not similar', () => {
    expect(isLandSimilar(null, 300)).toBe(false);
    expect(isLandSimilar(300, null)).toBe(false);
    expect(isLandSimilar(undefined, undefined)).toBe(false);
    expect(isLandSimilar(0, 300)).toBe(false);
    expect(isLandSimilar(300, 0)).toBe(false);
    expect(isLandSimilar(-100, 300)).toBe(false);
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

  it('opts.landSimilarSparse=true appends the sparsity note and lowers confidence', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 3 }, i));
    const base = estimateFromComparables(SUBJECT, comps, MARKET, NOW)!;
    const sparse = estimateFromComparables(SUBJECT, comps, MARKET, NOW, { landSimilarSparse: true })!;
    expect(sparse.methodology).toContain('few sales of similarly-sized blocks');
    expect(sparse.methodology).toContain('~600m²'); // SUBJECT.landAreaSqm
    expect(sparse.confidenceScore).toBeLessThan(base.confidenceScore);
  });

  it('opts.landSimilarSparse=false (default) does not add the note', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 3 }, i));
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW)!;
    expect(r.methodology).not.toContain('similarly-sized blocks');
  });

  // similarityWeight returns the full multiplicative product (distance × type
  // × beds × baths × land × recency), so isolating wLand's steepness requires
  // a near/far RATIO (which cancels every other factor, held constant across
  // the pair) rather than comparing an absolute weight to a hand-derived
  // wLand-only formula — mirrors the existing "land-area similarity
  // dominates" test's approach above.
  it('house subject with bedrooms known: land-decay steepness is 1.2 (plan 2026-08-18-001)', () => {
    const nearComp = comp(900_000, { type: 'house', land: 600 }, 1); // exact match to SUBJECT's 600m²
    const farComp = comp(900_000, { type: 'house', land: 1200 }, 2); // 2x
    const ratio = similarityWeight(SUBJECT, farComp) / similarityWeight(SUBJECT, nearComp); // SUBJECT.bedrooms = 3
    const expectedRatio = Math.exp(-Math.abs(Math.log(1200 / 600)) * 1.2);
    expect(ratio).toBeCloseTo(expectedRatio, 6);
  });

  it('house subject with bedrooms unknown: land decay is steeper than the bedrooms-known baseline', () => {
    const bedsUnknownSubject: ComparableSubject = { ...SUBJECT, bedrooms: undefined };
    const nearComp = comp(900_000, { type: 'house', land: 600 }, 1);
    const farComp = comp(900_000, { type: 'house', land: 1200 }, 2); // same 2x ratio
    const ratioKnown = similarityWeight(SUBJECT, farComp) / similarityWeight(SUBJECT, nearComp);
    const ratioUnknown = similarityWeight(bedsUnknownSubject, farComp) / similarityWeight(bedsUnknownSubject, nearComp);
    expect(ratioUnknown).toBeLessThan(ratioKnown); // steeper decay → far comp discounted harder
    const expectedRatio = Math.exp(-Math.abs(Math.log(1200 / 600)) * 1.5);
    expect(ratioUnknown).toBeCloseTo(expectedRatio, 6);
  });

  it('comp with unknown land size gets an uncertainty penalty (0.6), not a free pass at 1.0', () => {
    // Same treatment as wDistance's null-distance case — discovered during the
    // 28 Serene Way investigation: undiscounted unknown-land comps were
    // dominating the weighted median even after the steeper decay above.
    const landUnknownComp = comp(900_000, { type: 'house', land: null }, 1);
    const exactMatchComp = comp(900_000, { type: 'house', land: 600 }, 2); // exact match to SUBJECT's 600m²
    const wUnknown = similarityWeight(SUBJECT, landUnknownComp);
    const wExact = similarityWeight(SUBJECT, exactMatchComp);
    // wExact's land factor is 1.0 (exact match); wUnknown's is 0.6 — everything
    // else about the two comps is identical, so the ratio isolates the penalty.
    expect(wUnknown / wExact).toBeCloseTo(0.6, 6);
  });

  it('subject land unknown: comp land ignored entirely (no penalty either way)', () => {
    const subjectNoLand: ComparableSubject = { ...SUBJECT, landAreaSqm: undefined };
    const landUnknownComp = comp(900_000, { type: 'house', land: null }, 1);
    const landKnownComp = comp(900_000, { type: 'house', land: 1200 }, 2);
    // With no subject land to compare against, wLand stays 1.0 for both —
    // there's nothing to penalise a comp for not matching.
    expect(similarityWeight(subjectNoLand, landUnknownComp)).toBeCloseTo(
      similarityWeight(subjectNoLand, landKnownComp),
      6,
    );
  });

  it('land-bucket subject with bedrooms unknown: steepness stays at 2.0, unaffected by the house-branch change', () => {
    const landSubject: ComparableSubject = { ...SUBJECT, propertyType: 'Vacant land', bedrooms: undefined, bathrooms: undefined, landAreaSqm: 600 };
    const nearComp = comp(350_000, { type: 'Vacant land', beds: null, baths: null, land: 600 }, 1);
    const farComp = comp(350_000, { type: 'Vacant land', beds: null, baths: null, land: 1200 }, 2);
    const ratio = similarityWeight(landSubject, farComp) / similarityWeight(landSubject, nearComp);
    const expectedRatio = Math.exp(-Math.abs(Math.log(1200 / 600)) * 2.0);
    expect(ratio).toBeCloseTo(expectedRatio, 6);
  });
});

// ── 66A Duncan Dr reproduction: skewed pool of larger/null-attribute comps ────
// Plan 2026-08-18-001. A 3-bed 370m² subject surrounded by a growth-corridor
// pool dominated by bigger/newer stock (and NULL-attribute VG rows) must land
// near its size-matched cluster, not the pool-wide median.

const SKEW_SUBJECT: ComparableSubject = {
  latitude: -38.073,
  longitude: 145.4679,
  suburb: 'Pakenham',
  propertyType: 'house',
  bedrooms: 3,
  bathrooms: 2,
  landAreaSqm: 370,
};

const SKEW_MARKET = { houses: { medianPrice: 720_000, annualGrowth: 8 }, units: { medianPrice: 550_000, annualGrowth: 13 } };

function skewedPool(): ComparableSale[] {
  const pool: ComparableSale[] = [];
  // 15 size-matched sales: 3 bed, 300–450m², $620–680k
  for (let i = 0; i < 15; i++) {
    pool.push(comp(620_000 + (i % 4) * 20_000, { beds: 3, land: 300 + (i % 6) * 30, distanceKm: 0.3 + (i % 5) * 0.15, monthsAgo: 2 + (i % 10) }, i));
  }
  // 25 larger sales: 4–5 bed, 500–700m², $850k–$1.05M
  for (let i = 0; i < 25; i++) {
    pool.push(comp(850_000 + (i % 5) * 50_000, { beds: 4 + (i % 2), land: 500 + (i % 5) * 50, distanceKm: 0.3 + (i % 6) * 0.12, monthsAgo: 1 + (i % 12) }, 100 + i));
  }
  // 15 NULL-attribute VG rows at big-house prices
  for (let i = 0; i < 15; i++) {
    pool.push(comp(900_000 + (i % 4) * 40_000, { beds: null, baths: null, land: null, distanceKm: 0.4 + (i % 5) * 0.15, monthsAgo: 2 + (i % 14) }, 200 + i));
  }
  return pool;
}

describe('small-property skew reproduction (66A Duncan Dr shape)', () => {
  it('size-matched-only pool lands inside its own cluster (sanity baseline)', () => {
    const matched = skewedPool().filter((c) => c.bedrooms === 3);
    const r = estimateFromComparables(SKEW_SUBJECT, matched, SKEW_MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.priceMid).toBeGreaterThanOrEqual(600_000);
    expect(r!.priceMid).toBeLessThanOrEqual(720_000);
  });

  it('skewed pool with known-attribute subject lands near the size-matched cluster', () => {
    const r = estimateFromComparables(SKEW_SUBJECT, skewedPool(), SKEW_MARKET, NOW);
    expect(r).not.toBeNull();
    expect(r!.priceMid).toBeGreaterThanOrEqual(600_000);
    expect(r!.priceMid).toBeLessThanOrEqual(760_000);
  });
});

describe('null-attribute comp penalties (U2)', () => {
  it('NULL-bed comp vs known-bed subject: between matching and diff>=2 weights', () => {
    const matching = comp(900_000, { beds: 3 }, 1);
    const nullBeds = comp(900_000, { beds: null }, 2);
    const farBeds = comp(900_000, { beds: 5 }, 3);
    const wMatch = similarityWeight(SUBJECT, matching);
    const wNull = similarityWeight(SUBJECT, nullBeds);
    const wFar = similarityWeight(SUBJECT, farBeds);
    expect(wNull).toBeLessThan(wMatch);
    expect(wNull).toBeGreaterThan(wFar);
  });

  it('subject with unknown beds: NULL-bed comps keep full bed weight', () => {
    const noBedsSubject: ComparableSubject = { ...SUBJECT, bedrooms: undefined };
    const nullBeds = comp(900_000, { beds: null }, 1);
    const withBeds = comp(900_000, { beds: 3 }, 2);
    expect(similarityWeight(noBedsSubject, nullBeds)).toBeCloseTo(similarityWeight(noBedsSubject, withBeds), 6);
  });
});

describe('suburb-median cross-check threshold (U3)', () => {
  // 8 tight comps at a price ~20% above the suburb median → must FLAG now.
  it('20% divergence from suburb median flags, widens band, cuts confidence', () => {
    const comps = Array.from({ length: 8 }, (_, i) => comp(960_000, { distanceKm: 0.4, monthsAgo: 3 }, i));
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW)!; // median 800k, est ~964k adj
    const check = r.crossChecks.find((c) => c.label === 'Suburb median')!;
    expect(check.flagged).toBe(true);
    expect(r.methodology).toContain('Suburb median diverges');
  });

  it('10% divergence corroborates', () => {
    const comps = Array.from({ length: 8 }, (_, i) => comp(860_000, { distanceKm: 0.4, monthsAgo: 0 }, i));
    const r = estimateFromComparables(SUBJECT, comps, MARKET, NOW)!;
    const check = r.crossChecks.find((c) => c.label === 'Suburb median')!;
    expect(check.flagged).toBe(false);
  });
});

describe('external AVM cross-checks (U4)', () => {
  const tightComps = () => Array.from({ length: 8 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 0 }, i));

  it('divergent external estimate flags, widens band, cuts confidence, names source', () => {
    const base = estimateFromComparables(SUBJECT, tightComps(), MARKET, NOW)!;
    const r = estimateFromComparables(
      { ...SUBJECT, externalEstimates: [{ source: 'allhomes.com.au', value: 630_000 }] },
      tightComps(), MARKET, NOW,
    )!;
    const check = r.crossChecks.find((c) => c.label === 'allhomes.com.au estimate')!;
    expect(check.flagged).toBe(true);
    expect(r.confidenceBand).toBeGreaterThan(base.confidenceBand);
    expect(r.confidenceScore).toBeLessThan(base.confidenceScore);
    expect(r.methodology).toContain('allhomes.com.au estimate diverges');
  });

  it('close external estimate corroborates', () => {
    const r = estimateFromComparables(
      { ...SUBJECT, externalEstimates: [{ source: 'onthehouse.com.au', value: 810_000 }] },
      tightComps(), MARKET, NOW,
    )!;
    expect(r.crossChecks.find((c) => c.label === 'onthehouse.com.au estimate')!.flagged).toBe(false);
  });

  it('two externals, one diverging: only that one flags', () => {
    const r = estimateFromComparables(
      { ...SUBJECT, externalEstimates: [
        { source: 'allhomes.com.au', value: 810_000 },
        { source: 'onthehouse.com.au', value: 600_000 },
      ] },
      tightComps(), MARKET, NOW,
    )!;
    expect(r.crossChecks.find((c) => c.label === 'allhomes.com.au estimate')!.flagged).toBe(false);
    expect(r.crossChecks.find((c) => c.label === 'onthehouse.com.au estimate')!.flagged).toBe(true);
  });

  it('no external estimates: behaviour unchanged', () => {
    const a = estimateFromComparables(SUBJECT, tightComps(), MARKET, NOW)!;
    const b = estimateFromComparables({ ...SUBJECT, externalEstimates: [] }, tightComps(), MARKET, NOW)!;
    expect(a.priceMid).toBe(b.priceMid);
    expect(a.confidenceScore).toBe(b.confidenceScore);
  });
});

describe('growth guard (plan 2026-08-18-002)', () => {
  it('dampens a plausible rate: 8% → 5.6%', () => {
    expect(guardAnnualGrowth(8)).toBeCloseTo(5.6, 5);
  });

  it('clamps then dampens an extreme rate: 20% → 8.4%', () => {
    expect(guardAnnualGrowth(20)).toBeCloseTo(8.4, 5);
  });

  it('clamps then dampens negative growth: -20% → -8.4%', () => {
    expect(guardAnnualGrowth(-20)).toBeCloseTo(-8.4, 5);
  });

  it('clamp-only mode passes a modest rate through: 2.7% → 2.7%', () => {
    expect(guardAnnualGrowth(2.7, false)).toBeCloseTo(2.7, 5);
  });

  it('timeAdjust caps total uplift at +15% for old comps', () => {
    // 36 months at 5.6% p.a. uncapped ≈ +18.2%
    const adj = timeAdjust(1_000_000, 36, 5.6 / 12 / 100, MAX_TOTAL_ADJUST);
    expect(adj).toBe(1_150_000);
  });

  it('timeAdjust caps total downlift at -15%', () => {
    const adj = timeAdjust(1_000_000, 36, -8.4 / 12 / 100, MAX_TOTAL_ADJUST);
    expect(adj).toBe(850_000);
  });

  it('uncapped timeAdjust keeps the loose 3x outer bound for prior-sale paths', () => {
    const adj = timeAdjust(1_000_000, 600, 0.1 / 12);
    expect(adj).toBe(3_000_000);
  });

  it('methodology reports the applied (dampened) rate and the raw suburb rate', () => {
    const comps = Array.from({ length: 6 }, (_, i) => comp(800_000, { distanceKm: 0.4, monthsAgo: 6 }, i));
    const res = estimateFromComparables(SUBJECT, comps, MARKET, NOW);
    expect(res!.methodology).toContain('4.2% p.a.');
    expect(res!.methodology).toContain('dampened from 6.0%');
  });
});

describe('growth guard hardening (review fixes)', () => {
  it('NaN growth is treated as 0', () => {
    expect(guardAnnualGrowth(NaN)).toBe(0);
    expect(guardAnnualGrowth(Infinity)).toBe(0);
  });
});

describe('car-spaces similarity weight', () => {
  const carSubject: ComparableSubject = { ...SUBJECT, carSpaces: 1 };

  it('penalises car-count mismatch mildly (0 diff > 1 diff > 2+ diff)', () => {
    const same = similarityWeight(carSubject, { ...comp(800_000), carSpaces: 1 });
    const off1 = similarityWeight(carSubject, { ...comp(800_000), carSpaces: 2 });
    const off3 = similarityWeight(carSubject, { ...comp(800_000), carSpaces: 4 });
    expect(off1).toBeCloseTo(same * 0.92, 6);
    expect(off3).toBeCloseTo(same * 0.8, 6);
  });

  it('unknown car count on either side carries no penalty', () => {
    const nullComp = similarityWeight(carSubject, { ...comp(800_000), carSpaces: null });
    const noSubject = similarityWeight(SUBJECT, { ...comp(800_000), carSpaces: 4 });
    expect(nullComp).toBeCloseTo(similarityWeight(carSubject, { ...comp(800_000), carSpaces: 1 }), 6);
    expect(noSubject).toBeCloseTo(similarityWeight(SUBJECT, comp(800_000)), 6);
  });
});
