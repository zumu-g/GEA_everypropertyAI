import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StructuredAddress } from '@/types/property';

// Crawl always yields nothing — simulates the prod crawl-failure the fix targets.
vi.mock('@/lib/firecrawl/orchestrator', () => ({ crawlProperty: vi.fn(async () => []) }));
vi.mock('@/lib/enrichment/geocoding', () => ({ geocodeAddress: vi.fn(async () => null) }));

let feedSeed: { feed: 'sold' | 'on-market' | 'rent'; row: Record<string, unknown> } | null = null;
const saveCachedProfile = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/db/queries', () => ({
  getFeedSeedBySlug: vi.fn(async () => feedSeed),
  getCachedProfile: vi.fn(async () => null),
  saveCachedProfile: (...a: unknown[]) => saveCachedProfile(...a),
}));

import { fetchAndCacheProfile } from '../fetch-profile';
import { propertyCache } from '@/lib/cache';
import { FEED_SOURCE } from '../feed-seed';

const ADDRESS: StructuredAddress = {
  streetNumber: '14',
  streetName: 'Loders',
  streetType: 'Way',
  suburb: 'Berwick',
  state: 'VIC',
  postcode: '3806',
};

beforeEach(() => {
  feedSeed = null;
  propertyCache.clear?.();
  saveCachedProfile.mockClear();
});

describe('fetchAndCacheProfile feed-seed integration', () => {
  it('populates the profile from the feed when the crawl yields nothing', async () => {
    feedSeed = {
      feed: 'sold',
      row: {
        property_type: 'House',
        bedrooms: 5,
        bathrooms: 2,
        land_area_sqm: 813,
        sale_price: 1_200_000,
        image_url: 'https://img/14.jpg',
      },
    };

    const { profile, empty } = await fetchAndCacheProfile(ADDRESS);

    expect(empty).toBe(false);
    expect(profile.data.bedrooms).toBe(5);
    expect(profile.data.landArea).toBe(813);
    expect(profile.data.priceMid).toBe(1_200_000);
    expect(profile.data.photos).toEqual(['https://img/14.jpg']);
    expect(profile.overallConfidence).toBeGreaterThan(0);
    expect(profile.sources.map((s) => s.name)).toContain(FEED_SOURCE);
    expect(saveCachedProfile).toHaveBeenCalled();
  });

  it('returns an address-only, uncached profile when no feed row exists', async () => {
    feedSeed = null;
    const { profile, empty } = await fetchAndCacheProfile(ADDRESS);

    expect(empty).toBe(true);
    expect(profile.data.bedrooms).toBeUndefined();
    // Address is still seeded for downstream consumers.
    expect(profile.data.address).toBeTruthy();
    expect(saveCachedProfile).not.toHaveBeenCalled();
  });
});
