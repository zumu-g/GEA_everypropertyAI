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
import { groundFields } from '@/lib/extraction/grounding';
import { geocodeAddress } from '@/lib/enrichment/geocoding';
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

/**
 * Drop any extracted field whose value isn't present in the source content it
 * came from. Grounds both `.raw` and (when present) the schema-parsed `.data`.
 * The resolved address/coordinates are seeded separately after merge and are
 * never passed through grounding (trusted non-LLM source).
 */
function groundExtraction(
  ext: ExtractedPropertyData,
  sourceText: string
): ExtractedPropertyData {
  const raw = groundFields(ext.raw ?? {}, sourceText);
  const data = ext.data ? groundFields(ext.data, sourceText) : undefined;
  return { ...ext, raw, data };
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
      let ext: ExtractedPropertyData | undefined;
      if (EXTRACTION_PROVIDER === 'firecrawl' && r.url) {
        const fc = await scrapeAndExtract(r.url, r.source);
        if (fc && Object.keys(fc.raw).length > 0) ext = fc;
      }
      if (!ext) ext = await extractPropertyData(r.markdown ?? '', r.source, fullAddress);
      // Grounding: keep only values provably present in this source's scraped
      // content. Eliminates LLM-fabricated fields (whether from our own extractor
      // or Firecrawl's LLM-backed /extract) before they can reach the merge.
      return groundExtraction(ext, r.markdown ?? '');
    })
  );

  // Step 3: merge into a unified profile
  const profile = mergePropertyData(extractions);
  profile.crawlMode = fast ? 'fast' : 'full';

  // Whether the *crawl* yielded anything — computed before we seed the resolved
  // address, so an address-only profile (empty crawl) is still treated as empty
  // and left uncached for retry, rather than masking a failed crawl.
  const crawlEmpty =
    profile.sources.length === 0 || Object.keys(profile.data).length === 0;

  // Step 3b: seed the authoritative resolved address + coordinates. The scrapers
  // don't reliably emit a structured address (the Firecrawl schema has no address
  // field, and the regex fallback doesn't populate one), so the merged address was
  // always {}. The caller-resolved StructuredAddress is the source of truth — overlay
  // it, and geocode for coordinates (Mapbox) since address-suggest returns none.
  await seedResolvedAddress(profile, address);

  // Step 4: cache — never cache an empty lookup (would block re-crawl for 24h)
  if (crawlEmpty) {
    console.warn(`[fetch-profile] Empty profile for "${slug}" — not caching`);
    return { profile, slug, empty: true };
  }

  propertyCache.set(slug, profile);
  saveCachedProfile(slug, profile).catch((e) =>
    console.warn('[fetch-profile] Supabase cache save failed:', e)
  );

  return { profile, slug, empty: false };
}

/**
 * Overlay the caller-resolved address (the source of truth) onto the merged
 * profile and attach geocoded coordinates. Mutates `profile.data.address` and
 * the flat `latitude`/`longitude` fields. Always runs — even on an empty crawl —
 * so consumers (e.g. findAI) always get a populated, structured address.
 */
async function seedResolvedAddress(
  profile: PropertyProfile,
  address: StructuredAddress
): Promise<void> {
  // Prefer coordinates already on the resolved address; otherwise geocode.
  let coordinates = address.coordinates;
  if (!coordinates) {
    const geo = await geocodeAddress(formatAddress(address)).catch(() => null);
    if (geo) coordinates = { latitude: geo.lat, longitude: geo.lng };
  }

  const extracted = (profile.data.address ?? {}) as Record<string, unknown>;
  const resolvedAddress: Record<string, unknown> = {
    // Extracted address fields (e.g. lot/plan) are kept, but the resolved values win.
    ...extracted,
    streetNumber: address.streetNumber,
    streetName: address.streetName,
    streetType: address.streetType,
    suburb: address.suburb,
    state: address.state,
    postcode: address.postcode,
    displayAddress: address.displayAddress ?? formatAddress(address),
    ...(address.localGovernmentArea ? { localGovernmentArea: address.localGovernmentArea } : {}),
    ...(coordinates ? { coordinates } : {}),
  };

  profile.data.address = resolvedAddress;
  profile.fieldConfidences['address'] = { confidence: 100, contributedBy: ['resolved-address'] };

  // Mirror coordinates to the flat lat/lng fields the merger/consumers also read.
  if (coordinates) {
    profile.data.latitude = coordinates.latitude;
    profile.data.longitude = coordinates.longitude;
  }
}
