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
import { mergePropertyData } from '@/lib/extraction/merger';
import { partitionByAddressMatch } from '@/lib/extraction/address-match';
import { groundFields } from '@/lib/extraction/grounding';
import { geocodeAddress } from '@/lib/enrichment/geocoding';
import { fetchParcelLandArea } from '@/lib/enrichment/parcel';
import { saveCachedProfile, getCachedProfile, getFeedSeedBySlug } from '@/lib/db/queries';
import { mapFeedRowToProfileFields, applyFeedSeed } from '@/lib/jobs/feed-seed';
import { persistSaleHistory } from '@/lib/jobs/persist-sale-history';
import { persistRentalHistory } from '@/lib/jobs/persist-rental-history';
import type { ExtractedPropertyData } from '@/types/property';

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
  opts?: { fast?: boolean; skipIfCached?: boolean; softDeadlineMs?: number }
): Promise<FetchProfileResult> {
  const slug = toSlug(address);
  const fast = opts?.fast ?? false;
  const softDeadlineMs = opts?.softDeadlineMs;

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

  // In-flight dedupe (keyed by slug + mode): share one run across concurrent
  // callers. The soft-deadline (user-facing) and no-deadline (background) full
  // crawls are kept in separate buckets so a user request never inherits the
  // background crawl's long wait, and vice versa.
  const key = `${slug}::${fast ? 'fast' : 'full'}::${softDeadlineMs ? 'soft' : 'full'}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = doFetchAndCacheProfile(address, slug, fast, softDeadlineMs).finally(() => inFlight.delete(key));
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
  fast: boolean,
  softDeadlineMs?: number
): Promise<FetchProfileResult> {
  // Step 1: crawl sources in parallel. Fast mode trims to high-value sources
  // with short timeouts (for the CRM enrich path); the full crawl runs in the
  // background to fill the cache. softDeadlineMs (user-facing lookups) stops
  // waiting on blocked portals so the feed-seed step can still return a profile.
  const crawlResults: CrawlResult[] = await crawlProperty(address, { fast, softDeadlineMs });
  console.log(
    `[fetch-profile] Crawl complete for "${slug}": ${crawlResults.length} sources, ` +
      `statuses: ${crawlResults.map((r) => `${r.source}=${r.status}`).join(', ')}`
  );

  const successful = crawlResults.filter((r) => r.status === 'success');

  // Step 2: extract structured data from each successful source via our
  // markdown extractor (MiniMax/OpenRouter/Anthropic).
  const fullAddress = formatAddress(address);
  const extractions: ExtractedPropertyData[] = await Promise.all(
    successful.map(async (r) => {
      // Deterministic extraction parsed straight from the page's embedded JSON
      // (e.g. Domain's __NEXT_DATA__ Apollo state via Web Unlocker). Exact
      // values from a structured store — no LLM pass, no grounding needed.
      const structured = r.metadata?.structuredExtraction as ExtractedPropertyData | undefined;
      if (structured && Object.keys(structured.raw ?? {}).length > 0) {
        return structured;
      }
      const ext = await extractPropertyData(r.markdown ?? '', r.source, fullAddress);
      // Grounding: keep only values provably present in this source's scraped
      // content. Eliminates LLM-fabricated fields before they can reach the merge.
      return groundExtraction(ext, r.markdown ?? '');
    })
  );

  // Step 2b: address guard — drop any extraction whose address CONFIDENTLY
  // contradicts the target (a neighbouring listing that blended in via a guessed
  // REA URL). 'abstain' (no usable address) is kept; the Apify item-selection
  // gate is the primary defence there. Covers both the LLM and Firecrawl-native
  // extraction paths (plan 008).
  const { kept: matched, droppedCount } = partitionByAddressMatch(extractions, address);
  if (droppedCount > 0) {
    console.warn(`[fetch-profile] Dropped ${droppedCount} extraction(s) for "${slug}" — address contradicted target`);
  }

  // Step 3: merge into a unified profile
  const profile = mergePropertyData(matched);
  profile.crawlMode = fast ? 'fast' : 'full';

  // Whether the *crawl* yielded anything — computed before we seed the resolved
  // address, so an address-only profile (empty crawl) is still treated as empty
  // and left uncached for retry, rather than masking a failed crawl.
  const crawlEmpty =
    profile.sources.length === 0 || Object.keys(profile.data).length === 0;

  // Step 3a: seed structured attributes from our own feeds (sold → on-market →
  // rent). Gap-fill only — a value the crawl already merged is never overwritten
  // (crawl wins), so the feed only fills what the crawl left empty. This makes
  // the profile useful even when the live crawl yields nothing in prod.
  const feedSeeded = await seedFromFeed(profile, slug);

  // Step 3b: seed the authoritative resolved address + coordinates. The scrapers
  // don't reliably emit a structured address (the Firecrawl schema has no address
  // field, and the regex fallback doesn't populate one), so the merged address was
  // always {}. The caller-resolved StructuredAddress is the source of truth — overlay
  // it, and geocode for coordinates (Mapbox) since address-suggest returns none.
  await seedResolvedAddress(profile, address);

  // Step 3c: land-size fallback from the Vicmap cadastre. Only when neither the
  // crawl nor the feed produced a land area and we have coordinates (VIC only).
  if (
    profile.data.landArea === undefined &&
    typeof profile.data.latitude === 'number' &&
    typeof profile.data.longitude === 'number' &&
    (address.state ?? '').toUpperCase() === 'VIC'
  ) {
    const parcelArea = await fetchParcelLandArea(profile.data.latitude, profile.data.longitude);
    if (parcelArea != null) {
      profile.data.landArea = parcelArea;
      profile.fieldConfidences['landArea'] = { confidence: 55, contributedBy: ['vicmap-parcel'] };
    }
  }

  // A profile carrying feed-seeded attributes is NOT empty even when the crawl
  // failed — recompute its confidence (the merger left it at 0) so consumers
  // (proposal CLI, CMA pack) get a non-zero score. Only an address-with-no-feed
  // profile stays empty and uncached (retryable).
  const isEmpty = crawlEmpty && !feedSeeded;
  if (feedSeeded) {
    profile.overallConfidence = recomputeOverallConfidence(profile);
  }

  // Step 4: cache — never cache an empty lookup (would block re-crawl for 24h)
  if (isEmpty) {
    console.warn(`[fetch-profile] Empty profile for "${slug}" — not caching`);
    return { profile, slug, empty: true };
  }

  propertyCache.set(slug, profile);
  saveCachedProfile(slug, profile).catch((e) =>
    console.warn('[fetch-profile] Supabase cache save failed:', e)
  );

  // Step 4b: best-effort write-back of the profile's saleHistory into
  // property_sales (source='profile-crawl') so on-demand crawls permanently
  // top up sale history. Awaited (persistSaleHistory never throws) — a
  // fire-and-forget promise can be frozen by Vercel at response end and the
  // insert would silently never run; the write is one fast upsert.
  await persistSaleHistory(profile, slug).catch(() => {});

  // Step 4c: same write-back for rentalHistory → property_rental_history.
  // See persist-rental-history.ts — mirrors 4b, independently gated on its
  // own field confidence.
  await persistRentalHistory(profile, slug).catch(() => {});

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

/**
 * Gap-fill the merged profile's attribute fields from our own feed rows
 * (sold → on-market → rent) for this slug, registered as a low-confidence
 * `property-feed` source. Only fills fields the crawl did NOT already set, so a
 * real crawl extraction always wins. Mutates `profile`; returns true when at
 * least one field was seeded. Fail-soft: no feed row (or Supabase off) → false.
 */
async function seedFromFeed(profile: PropertyProfile, slug: string): Promise<boolean> {
  const seed = await getFeedSeedBySlug(slug).catch((e) => {
    console.warn('[fetch-profile] feed-seed lookup failed:', e);
    return null;
  });
  if (!seed) return false;

  const fields = mapFeedRowToProfileFields(seed.row, seed.feed);
  return applyFeedSeed(profile, fields);
}

/** Round-mean of all per-field confidences (matches the merger's measure). */
function recomputeOverallConfidence(profile: PropertyProfile): number {
  const values = Object.values(profile.fieldConfidences).map((fc) => fc.confidence);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
