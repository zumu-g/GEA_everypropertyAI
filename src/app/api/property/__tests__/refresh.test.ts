import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { StructuredAddress } from '@/types/property';

const fetchAndCacheProfile = vi.fn();
const getCachedProfile = vi.fn();
const deleteCachedProfile = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/jobs/fetch-profile', () => ({
  fetchAndCacheProfile: (...a: unknown[]) => fetchAndCacheProfile(...a),
}));
vi.mock('@/lib/db/queries', () => ({
  getCachedProfile: (...a: unknown[]) => getCachedProfile(...a),
  getOverrides: vi.fn(async () => ({})),
  deleteCachedProfile: (...a: unknown[]) => deleteCachedProfile(...a),
  getHistoryRowsForSlug: vi.fn(async () => ({ sales: [], rentals: [] })),
}));

import { POST } from '../route';
import { propertyCache } from '@/lib/cache';
import { toSlug } from '@/lib/utils/address';

const ADDRESS: StructuredAddress = {
  streetNumber: '120', streetName: 'Moondarra', streetType: 'Drive',
  suburb: 'Berwick', state: 'VIC', postcode: '3806',
};
const SLUG = toSlug(ADDRESS);

function makeProfile(tag: string) {
  return { data: { tag }, fieldConfidences: {}, overallConfidence: 50, sources: [{ name: 's', extractedAt: new Date(), hasErrors: false }], mergedAt: new Date() };
}

function req(body: object, query = '') {
  return new NextRequest(`http://localhost/api/property${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  propertyCache.clear?.();
  fetchAndCacheProfile.mockReset();
  getCachedProfile.mockReset();
  deleteCachedProfile.mockClear();
  fetchAndCacheProfile.mockResolvedValue({ profile: makeProfile('fresh'), slug: SLUG, empty: false });
  getCachedProfile.mockResolvedValue(null);
});

describe('POST /api/property refresh (plan 008 U3)', () => {
  it('without refresh, serves the in-memory cached profile (no re-crawl)', async () => {
    propertyCache.set(SLUG, makeProfile('cached') as never);
    const res = await POST(req({ address: ADDRESS }));
    const json = await res.json();
    expect(json.source).toBe('cache');
    expect(json.profile.data.tag).toBe('cached');
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
    expect(deleteCachedProfile).not.toHaveBeenCalled();
  });

  it('with {refresh:true}, evicts caches, re-crawls, returns the fresh profile', async () => {
    propertyCache.set(SLUG, makeProfile('cached') as never);
    const res = await POST(req({ address: ADDRESS, refresh: true }));
    const json = await res.json();
    expect(deleteCachedProfile).toHaveBeenCalledWith(SLUG);
    expect(propertyCache.get(SLUG)).toBeUndefined(); // in-memory evicted (then not re-set by mock)
    expect(fetchAndCacheProfile).toHaveBeenCalled();
    expect(json.source).toBe('fresh');
    expect(json.profile.data.tag).toBe('fresh');
  });

  it('?refresh=1 query param also triggers a refresh', async () => {
    propertyCache.set(SLUG, makeProfile('cached') as never);
    await POST(req({ address: ADDRESS }, '?refresh=1'));
    expect(deleteCachedProfile).toHaveBeenCalledWith(SLUG);
    expect(fetchAndCacheProfile).toHaveBeenCalled();
  });
});

describe('POST /api/property cachedOnly', () => {
  it('cache hit returns the cached profile without crawling', async () => {
    propertyCache.set(SLUG, makeProfile('cached') as never);
    const res = await POST(req({ address: ADDRESS, cachedOnly: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.source).toBe('cache');
    expect(json.profile.data.tag).toBe('cached');
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });

  it('serves a cached fast partial (caller opted out of a crawl)', async () => {
    propertyCache.set(SLUG, { ...makeProfile('partial'), crawlMode: 'fast' } as never);
    const res = await POST(req({ address: ADDRESS, cachedOnly: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.profile.data.tag).toBe('partial');
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });

  it('cache miss returns 404 and never crawls', async () => {
    const res = await POST(req({ address: ADDRESS }, '?cachedOnly=1'));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.addressSlug).toBe(SLUG);
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });

  it('falls through to the Supabase cache on in-memory miss', async () => {
    getCachedProfile.mockResolvedValue(makeProfile('supabase') as never);
    const res = await POST(req({ address: ADDRESS, cachedOnly: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.profile.data.tag).toBe('supabase');
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });

  it('rejects cachedOnly + refresh as contradictory', async () => {
    const res = await POST(req({ address: ADDRESS, cachedOnly: true, refresh: true }));
    expect(res.status).toBe(400);
    expect(deleteCachedProfile).not.toHaveBeenCalled();
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });
});
