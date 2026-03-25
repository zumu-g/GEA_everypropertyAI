import type { StructuredAddress } from '@/types/property';
import type { CrawlResult } from '@/types/crawl';
import { scrapeUrl } from './client';
import { getActiveSources, getAllSourcesForAddress } from './sources';
import { toAddressSlug } from './address';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Simple in-memory cache for crawl results.
 * Key: "{source}::{addressSlug}", Value: { results, cachedAt }
 */
const crawlCache = new Map<
  string,
  { result: CrawlResult; cachedAt: number }
>();

function getCacheKey(source: string, address: StructuredAddress): string {
  return `${source}::${toAddressSlug(address)}`;
}

function getCachedResult(
  source: string,
  address: StructuredAddress
): CrawlResult | null {
  const key = getCacheKey(source, address);
  const entry = crawlCache.get(key);

  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  if (age > CACHE_TTL_MS) {
    crawlCache.delete(key);
    return null;
  }

  return entry.result;
}

function setCachedResult(
  source: string,
  address: StructuredAddress,
  result: CrawlResult
): void {
  const key = getCacheKey(source, address);
  crawlCache.set(key, { result, cachedAt: Date.now() });
}

/**
 * Crawl property data from all active sources in parallel.
 *
 * - Builds URLs for each registered source
 * - Checks in-memory cache (24hr TTL) before scraping
 * - Dispatches parallel Firecrawl scrape jobs
 * - One source failing does not affect the others
 * - Returns array of CrawlResults with source attribution
 */
export async function crawlProperty(
  address: StructuredAddress,
  options?: { includeAgencies?: boolean }
): Promise<CrawlResult[]> {
  const sources = options?.includeAgencies
    ? getAllSourcesForAddress(address)
    : getActiveSources();

  const jobs = sources.map(async (source): Promise<CrawlResult> => {
    // Check cache first
    const cached = getCachedResult(source.name, address);
    if (cached) {
      return cached;
    }

    const url = source.buildPropertyUrl(address);
    console.log(`[orchestrator] Crawling ${source.name}: ${url}`);

    try {
      const result = await scrapeUrl(url, source.name, source.scrapeOptions);
      console.log(`[orchestrator] ${source.name} result: status=${result.status}, markdown=${(result.markdown?.length ?? 0)} chars`);

      // If direct URL fails and a search URL builder exists, try the search fallback
      if (result.status === 'failed' && source.buildSearchUrl) {
        const searchUrl = source.buildSearchUrl(address);
        const searchResult = await scrapeUrl(
          searchUrl,
          source.name,
          source.scrapeOptions
        );

        // Cache and return search result regardless of status
        setCachedResult(source.name, address, searchResult);
        return searchResult;
      }

      // Cache successful results
      if (result.status === 'success') {
        setCachedResult(source.name, address, result);
      }

      return result;
    } catch (error) {
      const errorResult: CrawlResult = {
        source: source.name,
        url,
        status: 'failed',
        crawledAt: new Date(),
        error:
          error instanceof Error
            ? error.message
            : 'Unexpected error during crawl',
      };

      return errorResult;
    }
  });

  // Run all source crawls in parallel — each is independent
  const results = await Promise.allSettled(jobs);

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    // This shouldn't happen since we catch inside each job,
    // but handle it defensively
    return {
      source: sources[index].name,
      url: sources[index].buildPropertyUrl(address),
      status: 'failed' as const,
      crawledAt: new Date(),
      error:
        result.reason instanceof Error
          ? result.reason.message
          : 'Promise rejected unexpectedly',
    };
  });
}

/**
 * Clear the in-memory crawl cache entirely.
 */
export function clearCrawlCache(): void {
  crawlCache.clear();
}

/**
 * Clear cached results for a specific address across all sources.
 */
export function clearCacheForAddress(address: StructuredAddress): void {
  const slug = toAddressSlug(address);
  for (const key of crawlCache.keys()) {
    if (key.endsWith(`::${slug}`)) {
      crawlCache.delete(key);
    }
  }
}

export { toAddressSlug } from './address';
