import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StructuredAddress } from '@/types/property';
import type { CrawlResult } from '@/types/crawl';

// Mock the crawl/db/geocoding boundaries the same way fetch-profile-feed-seed
// does, plus the persist-sale-history seam under test.
let crawlResults: CrawlResult[] = [];
vi.mock('@/lib/firecrawl/orchestrator', () => ({ crawlProperty: vi.fn(async () => crawlResults) }));
vi.mock('@/lib/enrichment/geocoding', () => ({ geocodeAddress: vi.fn(async () => null) }));
vi.mock('@/lib/db/queries', () => ({
  getFeedSeedBySlug: vi.fn(async () => null),
  getCachedProfile: vi.fn(async () => null),
  saveCachedProfile: vi.fn(async () => {}),
}));
vi.mock('@/lib/jobs/persist-sale-history', () => ({ persistSaleHistory: vi.fn(async () => {}) }));

import { fetchAndCacheProfile } from '../fetch-profile';
import { persistSaleHistory } from '@/lib/jobs/persist-sale-history';
import { propertyCache } from '@/lib/cache';

function address(streetNumber: string): StructuredAddress {
  return {
    streetNumber,
    streetName: 'Loders',
    streetType: 'Way',
    suburb: 'Berwick',
    state: 'VIC',
    postcode: '3806',
  };
}

/** One successful crawl result carrying a deterministic structured extraction. */
function successfulCrawl(): CrawlResult[] {
  return [
    {
      source: 'domain',
      status: 'success',
      markdown: '',
      metadata: {
        structuredExtraction: {
          source: 'domain',
          extractedAt: new Date(),
          raw: {
            bedrooms: 4,
            saleHistory: [{ date: '2019-03-12', price: 650000 }],
          },
        },
      },
    } as unknown as CrawlResult,
  ];
}

beforeEach(() => {
  crawlResults = [];
  propertyCache.clear?.();
  vi.clearAllMocks();
});

describe('fetchAndCacheProfile → persistSaleHistory write-back seam', () => {
  it('calls persistSaleHistory once with the cached profile and slug, awaited before resolving', async () => {
    crawlResults = successfulCrawl();

    // Deferred persist: fetchAndCacheProfile must not resolve before it does.
    let releasePersist!: () => void;
    let fetchResolved = false;
    vi.mocked(persistSaleHistory).mockImplementation(
      () => new Promise<void>((resolve) => { releasePersist = resolve; })
    );

    const run = fetchAndCacheProfile(address('14')).then((r) => {
      fetchResolved = true;
      return r;
    });

    // Flush microtasks until the persist call has been made.
    await vi.waitFor(() => expect(persistSaleHistory).toHaveBeenCalledTimes(1));
    // Persist is still pending → the fetch must still be pending too.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchResolved).toBe(false);

    releasePersist();
    const { profile, slug, empty } = await run;

    expect(empty).toBe(false);
    expect(persistSaleHistory).toHaveBeenCalledWith(profile, slug);
    expect(slug).toBe('14-loders-way-berwick-vic-3806');
    expect(profile.data.bedrooms).toBe(4);
  });

  it('does not call persistSaleHistory for an empty profile', async () => {
    crawlResults = []; // crawl yields nothing; no feed seed either
    const { empty } = await fetchAndCacheProfile(address('16'));
    expect(empty).toBe(true);
    expect(persistSaleHistory).not.toHaveBeenCalled();
  });

  it('resolves even when persistSaleHistory rejects', async () => {
    crawlResults = successfulCrawl();
    vi.mocked(persistSaleHistory).mockRejectedValueOnce(new Error('persist blew up'));
    const { empty, profile } = await fetchAndCacheProfile(address('18'));
    expect(empty).toBe(false);
    expect(profile.data.bedrooms).toBe(4);
    expect(persistSaleHistory).toHaveBeenCalledTimes(1);
  });
});
