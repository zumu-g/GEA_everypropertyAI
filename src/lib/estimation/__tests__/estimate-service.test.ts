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

describe('getEstimate — land-similar comp guarantee (U1)', () => {
  beforeEach(() => vi.clearAllMocks());

  // Small-block subject (299m² ~ the 28 Serene Way investigation): the local
  // pool skews to larger (700m²) blocks, so the ladder must keep widening
  // past radius=1 even once it already has enough *recent* comps.
  const SMALL_BLOCK_SUBJECT: EstimateSubjectInput = {
    latitude: LAT,
    longitude: LNG,
    suburb: 'Bunyip',
    state: 'VIC',
    propertyType: 'House',
    landAreaSqm: 300,
  };

  function houseRow(landAreaSqm: number, i: number, distKm: number) {
    // Offset ~0.001 deg lat ≈ 0.111km — pick i so the mocked haversineKm
    // distance lands just inside the target radius band.
    const offsetDeg = distKm / 111;
    return saleRow(
      { property_type: 'House', bedrooms: null, bathrooms: null, land_area_sqm: landAreaSqm, latitude: LAT + offsetDeg },
      i,
    );
  }

  it('recent comps satisfied at 1km but land-similar comps are not → ladder widens to 2km then stops', async () => {
    vi.mocked(getRowsNearby).mockImplementation(async (_table, _lat, _lng, radius) => {
      if (radius === 1) {
        // 8 recent, typical-size (700m²) comps — satisfies recentEnough but
        // none are land-similar to a 300m² subject (ratio 2.33, outside [0.6,1.6]).
        return Array.from({ length: 8 }, (_, i) => houseRow(700, i, 0.8)) as never;
      }
      if (radius === 2) {
        // 3 more comps, land-similar (300m², ratio 1.0), just inside 2km.
        return Array.from({ length: 3 }, (_, i) => houseRow(300, 10 + i, 1.5)) as never;
      }
      return [] as never;
    });

    const result = await getEstimate(SMALL_BLOCK_SUBJECT, NOW);
    expect(result).not.toBeNull();
    // Ladder should have widened to radius=2 and stopped there (not radius=5).
    expect(getRowsNearby).toHaveBeenCalledTimes(2);
    expect('compCount' in result! ? result.compCount : undefined).toBe(11);
  });

  it('subject landAreaSqm unknown → ladder behavior unchanged (stops purely on recentEnough)', async () => {
    const noLandSubject: EstimateSubjectInput = { ...SMALL_BLOCK_SUBJECT, landAreaSqm: undefined };
    vi.mocked(getRowsNearby).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => houseRow(700, i, 0.8)) as never,
    );

    const result = await getEstimate(noLandSubject, NOW);
    expect(result).not.toBeNull();
    expect(getRowsNearby).toHaveBeenCalledTimes(1);
  });

  it('land-similar comps genuinely absent within 5km → ladder exhausts, estimate still returns with sparsity note', async () => {
    vi.mocked(getRowsNearby).mockImplementation(async (_table, _lat, _lng, radius) => {
      // Always typical-size (700m²) comps, never land-similar to the 300m² subject,
      // at every radius in the ladder.
      const dist = radius === 1 ? 0.8 : radius === 2 ? 1.5 : 4;
      return Array.from({ length: 8 }, (_, i) => houseRow(700, i, dist)) as never;
    });

    const result = await getEstimate(SMALL_BLOCK_SUBJECT, NOW);
    expect(result).not.toBeNull();
    expect(getRowsNearby).toHaveBeenCalledTimes(3); // ladder exhausted (1, 2, 5km)
    expect(result!.methodology).toContain('few sales of similarly-sized blocks');
  });

  it('land-similar comps already present at 1km → no extra widening beyond radius=1', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) => houseRow(700, i, 0.8)),
      ...Array.from({ length: 3 }, (_, i) => houseRow(300, 10 + i, 0.9)),
    ] as never);

    const result = await getEstimate(SMALL_BLOCK_SUBJECT, NOW);
    expect(result).not.toBeNull();
    expect(getRowsNearby).toHaveBeenCalledTimes(1);
    expect(result!.methodology).not.toContain('similarly-sized blocks');
  });
});

describe('getEstimate — cross-source address dedup (#8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('same address in different source formats counts as one comp', async () => {
    const house = (overrides: Record<string, unknown>, i: number) =>
      saleRow({ property_type: 'House', bedrooms: 3, bathrooms: 2, sale_price: 800_000, ...overrides }, i);
    vi.mocked(getRowsNearby).mockResolvedValue([
      house({ raw_address: '12 Smith St, Berwick VIC 3806', sale_date: '2026-05-01', source: 'vic-vg' }, 1),
      house({ raw_address: '12 SMITH STREET BERWICK', sale_date: '2026-04-01', source: 'rea-history-apify' }, 1),
      house({ raw_address: '14 Smith St, Berwick VIC 3806' }, 2),
      house({ raw_address: '16 Smith St, Berwick VIC 3806' }, 3),
      house({ raw_address: '18 Smith St, Berwick VIC 3806' }, 4),
    ] as never);

    const result = await getEstimate(HOUSE_SUBJECT, NOW);
    expect(result).not.toBeNull();
    // 5 rows, but the two "12 Smith" formats are the same property → 4 comps.
    expect('compCount' in result! ? result.compCount : undefined).toBe(4);
  });
});
