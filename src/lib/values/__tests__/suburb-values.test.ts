import { describe, it, expect } from 'vitest';
import type { PropertySaleRecord, SuburbMedianRecord } from '@/lib/db/queries';
import {
  assembleSuburbValues,
  computeSuburbTypeValues,
  dedupeSales,
  filterQualifyingSales,
  MAX_PLAUSIBLE_SALE_PRICE,
  MIN_SALES_FOR_COMPUTED_PERIOD,
} from '../suburb-values';

const SRC_URL = 'https://discover.data.vic.gov.au/dataset/example';

function medianRow(overrides: Partial<SuburbMedianRecord>): SuburbMedianRecord {
  return {
    suburb: 'Berwick',
    property_type: 'house',
    period_type: 'quarter',
    period_start: '2025-12-01',
    median: 900000,
    sales_count: 40,
    source_url: SRC_URL,
    ...overrides,
  };
}

function sale(overrides: Partial<PropertySaleRecord>): PropertySaleRecord {
  return {
    raw_address: '1 Test St, Berwick VIC 3806',
    suburb: 'Berwick',
    state: 'VIC',
    property_type: 'House',
    sale_price: 900000,
    sale_date: daysAgo(30),
    source: 'domain-apify',
    ...overrides,
  };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function makeSales(count: number, price: number, addressPrefix = 'a'): PropertySaleRecord[] {
  return Array.from({ length: count }, (_, i) =>
    sale({
      raw_address: `${addressPrefix}${i} Test St, Berwick VIC 3806`,
      address_slug: `${addressPrefix}${i}-test-st-berwick-vic-3806`,
      sale_price: price,
      sale_date: daysAgo(10 + i),
    })
  );
}

describe('computeSuburbTypeValues', () => {
  it('scenario 1: computed latest agrees with Dec 2025 quarter, short-term change labelled against it', () => {
    const quarters = [
      medianRow({ period_start: '2025-12-01', median: 900000 }),
      medianRow({ period_start: '2025-09-01', median: 880000 }),
      medianRow({ period_start: '2025-06-01', median: 860000 }),
      medianRow({ period_start: '2025-03-01', median: 850000 }),
      medianRow({ period_start: '2024-12-01', median: 840000 }),
      medianRow({ period_start: '2024-09-01', median: 830000 }),
    ];
    const sales = makeSales(25, 910000); // within 10% of 900000
    const result = computeSuburbTypeValues(quarters, sales);

    expect(result.latest?.source).toBe('property-sales-90d');
    expect(result.latest?.median).toBe(910000);
    expect(result.latest?.salesCount).toBe(25);
    expect(result.latestReason).toBeNull();
    expect(result.change3m.fromLabel).toBe('Dec 2025 quarter');
    expect(result.change3m.percent).toBeCloseTo(((910000 - 900000) / 900000) * 100, 5);
  });

  it('scenario 2: computed period diverging >10% from newest quarter is demoted (low-agreement)', () => {
    const quarters = [medianRow({ period_start: '2025-12-01', median: 900000 })];
    const sales = makeSales(15, 1_100_000); // ~22% above 900000
    const result = computeSuburbTypeValues(quarters, sales);

    expect(result.latest?.source).toBe('valuer-general-quarter');
    expect(result.latestReason).toBe('low-agreement');
  });

  it('scenario 3: thin sample (fewer than 10 qualifying sales) does not compute a latest period', () => {
    const quarters = [medianRow({ period_start: '2025-12-01', median: 900000 })];
    const priced = makeSales(8, 900000);
    const aggregate = [
      sale({ raw_address: 'agg1', source: 'vic-vg-aggregate', sale_price: undefined }),
      sale({ raw_address: 'agg2', source: 'vic-vg-aggregate', sale_price: undefined }),
    ];
    const qualifying = filterQualifyingSales([...priced, ...aggregate]);
    expect(qualifying).toHaveLength(8);

    const result = computeSuburbTypeValues(quarters, qualifying);
    expect(result.latest?.source).toBe('valuer-general-quarter');
    expect(result.latestReason).toBe('thin-sample');
  });

  it('scenario 4: the same sale from two sources within 120 days dedupes to one, preferring vic-vg price', () => {
    const raw: PropertySaleRecord[] = [
      sale({ raw_address: '5 Shared St, Berwick VIC 3806', address_slug: '5-shared-st-berwick', source: 'domain-apify', sale_price: 905000, sale_date: daysAgo(20) }),
      sale({ raw_address: '5 Shared St, Berwick VIC 3806', address_slug: '5-shared-st-berwick', source: 'vic-vg', sale_price: 900000, sale_date: daysAgo(15) }),
      ...makeSales(9, 900000, 'b'),
    ];
    const qualifying = filterQualifyingSales(raw);
    const deduped = dedupeSales(qualifying);
    expect(deduped).toHaveLength(10);
    const shared = deduped.find((r) => r.address_slug === '5-shared-st-berwick');
    expect(shared?.source).toBe('vic-vg');
    expect(shared?.sale_price).toBe(900000);
  });

  it('scenario 5: fewer than 10 recent sales falls back to newest VG quarter, short-term vs prior quarter', () => {
    const quarters = [
      medianRow({ period_start: '2025-12-01', median: 900000 }),
      medianRow({ period_start: '2025-09-01', median: 880000 }),
    ];
    const sales = makeSales(4, 950000);
    const result = computeSuburbTypeValues(quarters, sales);

    expect(result.latest?.source).toBe('valuer-general-quarter');
    expect(result.latest?.median).toBe(900000);
    expect(result.change3m.fromLabel).toBe('Sep 2025 quarter');
    expect(result.change3m.toLabel).toBe('Dec 2025 quarter');
    expect(result.change3m.percent).toBeCloseTo(((900000 - 880000) / 880000) * 100, 5);
  });

  it('scenario 6: a suppressed Dec 2025 quarter returns a null short-term change with reason suppressed', () => {
    const quarters = [
      medianRow({ period_start: '2025-12-01', median: null }),
      medianRow({ period_start: '2025-09-01', median: 880000 }),
    ];
    const result = computeSuburbTypeValues(quarters, []);

    expect(result.latest).toBeNull();
    expect(result.latestReason).toBe('suppressed');
    expect(result.change3m.percent).toBeNull();
    expect(result.change3m.reason).toBe('suppressed');
  });

  it('scenario 7: no Valuer-General row but priced sales exist returns unmatched', () => {
    const sales = makeSales(12, 900000);
    const result = computeSuburbTypeValues([], sales);
    expect(result.latest).toBeNull();
    expect(result.latestReason).toBe('unmatched');
  });

  it('scenario 8: no Valuer-General row and no priced sales returns no-data', () => {
    const result = computeSuburbTypeValues([], []);
    expect(result.latest).toBeNull();
    expect(result.latestReason).toBe('no-data');
  });

  it('scenario 9: 5-year change uses the 2021 year row when no 2021 quarter exists', () => {
    const quarters = [medianRow({ period_start: '2026-06-01', median: 950000 })];
    const years = [
      medianRow({ period_start: '2021-01-01', median: 700000, period_type: 'year' }),
      medianRow({ period_start: '2020-01-01', median: 650000, period_type: 'year' }),
    ];
    // No sales -> falls back to the newest VG quarter as latest (deterministic period_start).
    const result = computeSuburbTypeValues([...quarters, ...years], []);

    expect(result.latest?.periodStart).toBe('2026-06-01');
    expect(result.change5y.fromLabel).toBe('2021');
    expect(result.change5y.percent).toBeCloseTo(((950000 - 700000) / 700000) * 100, 5);
  });

  it('scenario 10: a sale above the plausibility cap is excluded', () => {
    const sales = [...makeSales(9, 900000), sale({ raw_address: 'huge', sale_price: MAX_PLAUSIBLE_SALE_PRICE + 1 })];
    const qualifying = filterQualifyingSales(sales);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.some((s) => s.sale_price === MAX_PLAUSIBLE_SALE_PRICE + 1)).toBe(false);
  });
});

describe('assembleSuburbValues', () => {
  it('scenario 11: produces a series entry for every service-area suburb even with a >1000-row median fixture', () => {
    // Fabricate a >1000-row median fixture (mirrors what a paginated bulk fetch would return).
    const bigFixture: SuburbMedianRecord[] = [];
    for (let i = 0; i < 20; i++) {
      bigFixture.push(medianRow({ suburb: 'Pakenham', period_start: `20${10 + i}-01-01`, period_type: 'year', median: 500000 + i * 1000 }));
    }
    for (let i = 0; i < 1000; i++) {
      bigFixture.push(medianRow({ suburb: 'Cranbourne', property_type: 'unit', period_type: 'year', period_start: `19${i % 90}-01-01`, median: 400000 }));
    }
    const payload = assembleSuburbValues(bigFixture, []);
    expect(payload.suburbs.length).toBeGreaterThan(70); // full SERVICE_AREA_SUBURBS list
    const pakenham = payload.suburbs.find((s) => s.name === 'Pakenham');
    expect(pakenham?.houses.series.length).toBe(20);
  });

  it('carries schemaVersion and attribution', () => {
    const payload = assembleSuburbValues([], []);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.attribution.valuerGeneral).toMatch(/Valuer-General/);
  });

  it('MIN_SALES_FOR_COMPUTED_PERIOD is 10 per KTD2', () => {
    expect(MIN_SALES_FOR_COMPUTED_PERIOD).toBe(10);
  });
});
