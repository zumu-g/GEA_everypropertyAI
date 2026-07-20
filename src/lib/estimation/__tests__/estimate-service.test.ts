import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  getRowsNearby: vi.fn(),
  haversineKm: (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
  getSalesForSuburb: vi.fn(async () => []),
}));
vi.mock('@/lib/enrichment/market-data', () => ({
  fetchSuburbMarketData: vi.fn(async () => ({
    houses: { medianPrice: 800_000, annualGrowth: 5 },
    units: { medianPrice: 500_000, annualGrowth: 4 },
  })),
}));

import { getEstimate, type EstimateSubjectInput } from '../estimate-service';
import { getRowsNearby, getSalesForSuburb } from '@/lib/db/queries';

const NOW = new Date('2026-07-20T00:00:00Z');
const LAT = -38.065, LNG = 145.45;

function saleRow(overrides: Partial<Record<string, unknown>> = {}, i = 0) {
  return {
    raw_address: `${i} Test St, Bunyip VIC 3815`,
    suburb: 'Bunyip',
    state: 'VIC',
    sale_price: 350_000,
    sale_date: '2026-05-01',
    bedrooms: null,
    bathrooms: null,
    land_area_sqm: 700,
    property_type: 'Vacant land',
    latitude: LAT + i * 0.001,
    longitude: LNG,
    source: 'vg',
    ...overrides,
  };
}

const LAND_SUBJECT: EstimateSubjectInput = {
  latitude: LAT,
  longitude: LNG,
  suburb: 'Bunyip',
  state: 'VIC',
  propertyType: 'Vacant land',
  landAreaSqm: 800,
};

const HOUSE_SUBJECT: EstimateSubjectInput = {
  latitude: LAT,
  longitude: LNG,
  suburb: 'Bunyip',
  state: 'VIC',
  propertyType: 'House',
  bedrooms: 3,
  bathrooms: 2,
  landAreaSqm: 700,
};

describe('getEstimate — vacant-land bucket', () => {
  beforeEach(() => vi.clearAllMocks());

  it('land subject: mixed pool → house comps excluded, only land comps price the estimate', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue([
      saleRow({}, 1),
      saleRow({}, 2),
      saleRow({}, 3),
      saleRow({ property_type: 'House', bedrooms: 4, bathrooms: 2, sale_price: 900_000 }, 4),
      saleRow({ property_type: 'House', bedrooms: 3, bathrooms: 2, sale_price: 850_000 }, 5),
    ] as never);

    const result = await getEstimate(LAND_SUBJECT, NOW);
    expect(result).not.toBeNull();
    expect('compCount' in result! ? result.compCount : undefined).toBe(3);
    expect(result!.priceMid).toBeLessThan(500_000); // house prices (850-900k) did not leak in
  });

  it('house subject: pool containing vacant-land sales excludes them (regression: no longer weight-0.85 included)', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue([
      saleRow({ property_type: 'House', bedrooms: 3, bathrooms: 2, sale_price: 800_000 }, 1),
      saleRow({ property_type: 'House', bedrooms: 3, bathrooms: 2, sale_price: 810_000 }, 2),
      saleRow({ property_type: 'House', bedrooms: 3, bathrooms: 2, sale_price: 790_000 }, 3),
      saleRow({ property_type: 'Vacant land', sale_price: 300_000 }, 4),
      saleRow({ property_type: 'VacantLand', sale_price: 280_000 }, 5),
    ] as never);

    const result = await getEstimate(HOUSE_SUBJECT, NOW);
    expect(result).not.toBeNull();
    expect('compCount' in result! ? result.compCount : undefined).toBe(3);
    expect(result!.priceMid).toBeGreaterThan(700_000); // land prices did not drag the median down
  });

  it('land subject with too few land comps: fallback confidence floored to low, with a land-specific note', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue([saleRow({}, 1)] as never); // 1 land comp, below MIN_COMPS
    vi.mocked(getSalesForSuburb).mockResolvedValue([]);

    const result = await getEstimate(LAND_SUBJECT, NOW);
    expect(result).not.toBeNull();
    expect(result!.confidenceLevel).toBe('low');
    expect(result!.methodology).toContain('not representative of land value');
  });
});
