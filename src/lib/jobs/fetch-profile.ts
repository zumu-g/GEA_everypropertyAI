/**
 * Shared property-fetch pipeline: crawl → extract → merge → cache.
 *
 * Extracted from the /api/property route so it can be reused by the crawl-queue
 * worker (the `property-profile` backfill job) without duplicating logic.
 */

import type { StructuredAddress, MergedPropertyProfile as PropertyProfile } from '@/types/property';
import type { CrawlResult } from '@/types/crawl';
import { propertyCache } from '@/lib/cache';
import { toSlug, formatAddress } from '@/lib/utils/address';
import { crawlProperty } from '@/lib/firecrawl/orchestrator';
import { extractPropertyData } from '@/lib/extraction/extractor';
import { scrapeAndExtract } from '@/lib/firecrawl/client';
import { mergePropertyData } from '@/lib/extraction/merger';
import { saveCachedProfile, getCachedProfile } from '@/lib/db/queries';
import type { ExtractedPropertyData } from '@/types/property';

// When 'firecrawl', use Firecrawl's native /extract (structured JSON) instead of
// our own LLM extractor — removes the MiniMax/OpenRouter dependency.
const EXTRACTION_PROVIDER = process.env.EXTRACTION_PROVIDER ?? 'llm';

export interface FetchProfileResult {
  profile: PropertyProfile;
  slug: string;
  /** True when the merged profile had no sources/data and was NOT cached. */
  empty: boolean;
}

// In-flight dedupe: collapse concurrent crawls of the same address (keyed by
// slug + mode) into a single run so parallel callers (CRM, queue, background)
// don't each spawn duplicate Apify/Firecrawl scrapes.
const inFlight = new Map<string, Promise<FetchProfileResult>>();

/**
 * Run the full crawl → extract → merge pipeline for one address and persist the
 * result to both the in-memory and Supabase caches. Empty profiles (no sources
 * or no merged fields) are returned but NOT cached, so they can be retried.
 *
 * Does not apply user overrides — callers that serve to the UI should apply
 * those on top (the /api/property route does).
 */
export async function fetchAndCacheProfile(
  address: StructuredAddress,
  opts?: { fast?: boolean; skipIfCached?: boolean }
): Promise<FetchProfileResult> {
  const slug = toSlug(address);
  const fast = opts?.fast ?? false;

  // Cache-guard: callers that may run after a delay (queue worker, background
  // fill) can skip the crawl entirely if a profile is already cached — avoids
  // re-scraping an address that got cached between enqueue and execution.
  if (opts?.skipIfCached) {
    const mem = propertyCache.get(slug);
    if (mem) return { profile: mem, slug, empty: false };
    const persisted = await getCachedProfile(slug);
    if (persisted) {
      propertyCache.set(slug, persisted);
      return { profile: persisted, slug, empty: false };
    }
  }

  // In-flight dedupe (keyed by slug + mode): share one run across concurrent callers.
  const key = `${slug}::${fast ? 'fast' : 'full'}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = doFetchAndCacheProfile(address, slug, fast).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function doFetchAndCacheProfile(
  address: StructuredAddress,
  slug: string,
  fast: boolean
): Promise<FetchProfileResult> {
  // Step 1: crawl sources in parallel. Fast mode trims to high-value sources
  // with short timeouts (for the CRM enrich path); the full crawl runs in the
  // background to fill the cache.
  const crawlResults: CrawlResult[] = await crawlProperty(address, { fast });
  console.log(
    `[fetch-profile] Crawl complete for "${slug}": ${crawlResults.length} sources, ` +
      `statuses: ${crawlResults.map((r) => `${r.source}=${r.status}`).join(', ')}`
  );

  const successful = crawlResults.filter((r) => r.status === 'success');

  // Step 2: extract structured data from each successful source.
  // firecrawl provider → Firecrawl native /extract (re-fetches the URL as JSON;
  // no own-LLM key needed), falling back to the LLM extractor if it yields
  // nothing. llm provider → our markdown extractor (MiniMax/OpenRouter/Anthropic).
  const fullAddress = formatAddress(address);
  const extractions: ExtractedPropertyData[] = await Promise.all(
    successful.map(async (r) => {
      if (EXTRACTION_PROVIDER === 'firecrawl' && r.url) {
        const fc = await scrapeAndExtract(r.url, r.source);
        if (fc && Object.keys(fc.raw).length > 0) return fc;
      }
      return extractPropertyData(r.markdown ?? '', r.source, fullAddress);
    })
  );

  // Step 3: merge into a unified profile
  const profile = mergePropertyData(extractions);

  // Step 4: cache — never cache an empty lookup (would block re-crawl for 24h)
  const empty = profile.sources.length === 0 || Object.keys(profile.data).length === 0;
  if (empty) {
    console.warn(`[fetch-profile] Empty profile for "${slug}" — not caching`);
    return { profile, slug, empty: true };
  }

  propertyCache.set(slug, profile);
  saveCachedProfile(slug, profile).catch((e) =>
    console.warn('[fetch-profile] Supabase cache save failed:', e)
  );

  return { profile, slug, empty: false };
}
