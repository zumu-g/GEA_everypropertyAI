import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  getRowsNearby: vi.fn(async () => []),
  haversineKm: () => 0.5,
  getRentalsForSuburb: vi.fn(async () => []),
}));
vi.mock('@/lib/enrichment/market-data', () => ({
  fetchSuburbMarketData: vi.fn(async () => ({
    houses: { medianPrice: 800_000, annualGrowth: 5, medianRent: 550, grossYield: 4 },
    units: { medianPrice: 500_000, annualGrowth: 4, medianRent: 450, grossYield: 4.5 },
  })),
}));

import { getRentalEstimate, type RentalEstimateSubjectInput } from '../estimate-rental-service';
import { getRowsNearby } from '@/lib/db/queries';

const NOW = new Date('2026-07-20T00:00:00Z');

describe('getRentalEstimate — vacant land', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for a vacant-land subject, even with rental comps nearby', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        raw_address: `${i} Test St, Bunyip VIC 3815`,
        suburb: 'Bunyip',
        weekly_rent: 400,
        created_at: '2026-05-01',
        bedrooms: 3,
        bathrooms: 2,
        property_type: 'house',
        latitude: -38.065,
        longitude: 145.45,
      })) as never,
    );
    const subject: RentalEstimateSubjectInput = {
      latitude: -38.065,
      longitude: 145.45,
      suburb: 'Bunyip',
      state: 'VIC',
      propertyType: 'Vacant land',
    };
    const result = await getRentalEstimate(subject, NOW);
    expect(result).toBeNull();
  });

  it('non-land subjects are unaffected (still gets a rent estimate)', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        raw_address: `${i} Test St, Bunyip VIC 3815`,
        suburb: 'Bunyip',
        weekly_rent: 400,
        created_at: '2026-05-01',
        bedrooms: 3,
        bathrooms: 2,
        property_type: 'house',
        latitude: -38.065,
        longitude: 145.45,
      })) as never,
    );
    const subject: RentalEstimateSubjectInput = {
      latitude: -38.065,
      longitude: 145.45,
      suburb: 'Bunyip',
      state: 'VIC',
      propertyType: 'House',
      bedrooms: 3,
      bathrooms: 2,
    };
    const result = await getRentalEstimate(subject, NOW);
    expect(result).not.toBeNull();
  });
});

describe('getRentalEstimate — comp imageUrl passthrough', () => {
  beforeEach(() => vi.clearAllMocks());

  const rows = (imageUrl?: string) =>
    Array.from({ length: 5 }, (_, i) => ({
      raw_address: `${i} Test St, Bunyip VIC 3815`,
      suburb: 'Bunyip',
      weekly_rent: 400 + i * 10,
      created_at: '2026-05-01',
      bedrooms: 3,
      bathrooms: 2,
      property_type: 'house',
      latitude: -38.065,
      longitude: 145.45,
      ...(imageUrl ? { image_url: imageUrl } : {}),
    })) as never;

  const subject: RentalEstimateSubjectInput = {
    latitude: -38.065,
    longitude: 145.45,
    suburb: 'Bunyip',
    state: 'VIC',
    propertyType: 'House',
    bedrooms: 3,
  };

  it('carries image_url through to comparablesUsed', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue(rows('https://cdn.example/img.jpg'));
    const result = await getRentalEstimate(subject, NOW);
    expect(result && 'comparablesUsed' in result).toBe(true);
    const comps = (result as { comparablesUsed: Array<{ imageUrl?: string | null }> }).comparablesUsed;
    expect(comps.length).toBeGreaterThan(0);
    expect(comps.every((c) => c.imageUrl === 'https://cdn.example/img.jpg')).toBe(true);
  });

  it('records without image_url yield null imageUrl and estimate unchanged', async () => {
    vi.mocked(getRowsNearby).mockResolvedValue(rows());
    const result = await getRentalEstimate(subject, NOW);
    const comps = (result as { comparablesUsed: Array<{ imageUrl?: string | null }> }).comparablesUsed;
    expect(comps.every((c) => c.imageUrl == null)).toBe(true);
  });
});
