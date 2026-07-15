import type { StructuredAddress } from '@/types/property';
import type { CrawlResult, FetchBackend } from '@/types/crawl';
import { scrapeUrl } from './client';
import { scrapeWithApify } from '@/lib/apify/client';
import { scrapeWithStealth, isStealthConfigured } from '@/lib/stealth/client';
import { scrapeWithWebUnlocker, isWebUnlockerConfigured } from '@/lib/webunlocker/client';
import { getActiveSources, getAllSourcesForAddress, getFastSources } from './sources';
import { toAddressSlug } from './address';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Per-source timeout for the FAST path — keeps a fresh lookup snappy. The full
// background crawl uses each source's own (longer) timeout.
const FAST_SOURCE_TIMEOUT_MS = 8_000;

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
 * Resolve as soon as one of `attempts` succeeds; if all fail, resolve with the
 * last one to settle. Lets fallback backends race instead of running serially
 * — a source doesn't have to pay for every fallback's timeout back-to-back.
 */
export function raceToFirstSuccess(
  attempts: Promise<CrawlResult>[]
): Promise<CrawlResult> {
  return new Promise((resolve) => {
    let remaining = attempts.length;
    let last: CrawlResult;
    attempts.forEach((attempt) => {
      attempt
        .catch((error): CrawlResult => ({
          source: 'unknown',
          url: '',
          status: 'failed',
          crawledAt: new Date(),
          error: error instanceof Error ? error.message : 'Unexpected fallback error',
        }))
        .then((result) => {
          last = result;
          remaining--;
          if (result.status === 'success' || remaining === 0) resolve(result.status === 'success' ? result : last);
        });
    });
  });
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
  options?: { includeAgencies?: boolean; fast?: boolean; softDeadlineMs?: number }
): Promise<CrawlResult[]> {
  const fast = options?.fast ?? false;
  const softDeadlineMs = options?.softDeadlineMs;
  const sources = fast
    ? getFastSources()
    : options?.includeAgencies
      ? getAllSourcesForAddress(address)
      : getActiveSources();

  const jobs = sources.map(async (source): Promise<CrawlResult> => {
    // Check cache first
    const cached = getCachedResult(source.name, address);
    if (cached) {
      return cached;
    }

    let url = source.buildPropertyUrl(address);
    const apifyActorId = source.options?.apifyActorId as string | undefined;

    // FAST path: force the firecrawl backend with a short timeout and skip Apify
    // (its ~90s actor wait is the main source of slowness). The full background
    // crawl uses the normal backends/timeouts.
    const scrapeOptions = fast
      ? { ...source.scrapeOptions, timeout: FAST_SOURCE_TIMEOUT_MS }
      : source.scrapeOptions;

    // Resolve the primary fetch backend. Default preserves prior behaviour:
    // apify when an actor id is configured, otherwise firecrawl.
    const primary: FetchBackend = fast
      ? 'firecrawl'
      : source.fetchBackend ?? (apifyActorId ? 'apify' : 'firecrawl');

    // Dispatch a single backend. Unavailable backends return a 'failed' result
    // (no actor id / stealth unconfigured) so the fallback loop can move on.
    const dispatch = async (backend: FetchBackend, target: string): Promise<CrawlResult> => {
      if (backend === 'web-unlocker') {
        // Web Unlocker returns raw HTML; render through an AU exit (the property
        // sites are AU-geofenced, client-rendered Next.js apps). Convert to
        // markdown via the source's parser — a shell/404 page (parser returns
        // null) is a failure so the fallback chain continues.
        const wu = await scrapeWithWebUnlocker(target, source.name, {
          timeout: scrapeOptions?.timeout,
          render: true,
          country: 'au',
        });
        if (wu.status !== 'success' || !wu.html) return wu;
        const markdown = source.htmlToMarkdown ? source.htmlToMarkdown(wu.html) : wu.html;
        if (!markdown) {
          return {
            ...wu,
            status: 'failed',
            error: 'page fetched but contained no property data (shell/404)',
          };
        }
        // Deterministic extraction (when the source supports it) rides along on
        // metadata; fetch-profile uses it instead of the LLM extractor.
        const structured = source.htmlToExtraction?.(wu.html) ?? null;
        return {
          ...wu,
          markdown,
          metadata: { ...wu.metadata, ...(structured ? { structuredExtraction: structured } : {}) },
        };
      }
      if (backend === 'stealth') {
        return scrapeWithStealth(target, source.name, {
          waitFor: scrapeOptions?.waitFor,
          timeout: scrapeOptions?.timeout,
          engine: scrapeOptions?.stealthEngine,
        });
      }
      if (backend === 'apify') {
        return apifyActorId
          ? scrapeWithApify(
              target,
              source.name,
              apifyActorId,
              source.options?.apifyInput as Record<string, unknown> | undefined,
              address
            )
          : Promise.resolve<CrawlResult>({
              source: source.name,
              url: target,
              status: 'failed',
              crawledAt: new Date(),
              error: 'apify backend requested but no apifyActorId configured',
            });
      }
      return scrapeUrl(target, source.name, scrapeOptions);
    };

    try {
      // Two-stage discovery: resolve the real detail URL when it can't be
      // derived from the address (e.g. Homely's non-derivable numeric id). Skip
      // in fast mode (discovery adds an index fetch; fast sources don't use it).
      if (source.discoverPropertyUrl && !fast) {
        const fetchPage = async (target: string): Promise<string | null> => {
          if (isWebUnlockerConfigured()) {
            const wu = await scrapeWithWebUnlocker(target, source.name, {
              timeout: scrapeOptions?.timeout,
              render: true,
              country: 'au',
            });
            return wu.status === 'success' ? wu.html ?? null : null;
          }
          // No Web Unlocker in this environment — try the firecrawl backend,
          // which returns markdown; the link regex matches in markdown too.
          const fc = await scrapeUrl(target, source.name, scrapeOptions);
          return fc.status === 'success' ? fc.html ?? fc.markdown ?? null : null;
        };
        const discovered = await source.discoverPropertyUrl(address, fetchPage);
        if (!discovered) {
          console.log(`[orchestrator] ${source.name} discovery found no listing for address — skipping`);
          return {
            source: source.name,
            url,
            status: 'failed',
            crawledAt: new Date(),
            error: 'discovery: no matching listing found in suburb index',
          };
        }
        console.log(`[orchestrator] ${source.name} discovered detail URL: ${discovered}`);
        url = discovered;
      }

      console.log(`[orchestrator] Crawling ${source.name} via ${primary}${fast ? ' (fast)' : ''}: ${url}`);
      let result = await dispatch(primary, url);
      console.log(`[orchestrator] ${source.name} result: status=${result.status}, markdown=${(result.markdown?.length ?? 0)} chars`);

      // Search-URL fallback for the firecrawl backend only: if the direct page
      // misses and the source has a search URL, retry against it.
      if (result.status === 'failed' && primary === 'firecrawl' && source.buildSearchUrl) {
        const searchUrl = source.buildSearchUrl(address);
        result = await scrapeUrl(searchUrl, source.name, scrapeOptions);
      }

      // Cross-backend fallback: try alternate backends in parallel (not one at a
      // time) and take whichever succeeds first. Skips backends that aren't
      // available in this environment. In fast mode only the (short) stealth
      // fallback is allowed — never Apify. Serial fallback was the main driver
      // of full-crawl latency: a source whose primary backend failed would pay
      // for every fallback's timeout back-to-back before giving up.
      if (result.status !== 'success' && source.fallbackBackends?.length) {
        const eligible = source.fallbackBackends.filter((fb) => {
          if (fb === primary) return false;
          if (fast && fb !== 'stealth') return false;
          if (fb === 'apify' && !apifyActorId) return false;
          if (fb === 'stealth' && !isStealthConfigured()) return false;
          if (fb === 'web-unlocker' && !isWebUnlockerConfigured()) return false;
          return true;
        });
        if (eligible.length > 0) {
          console.log(`[orchestrator] ${source.name} falling back to ${eligible.join(', ')} (parallel)`);
          result = await raceToFirstSuccess(eligible.map((fb) => dispatch(fb, url)));
        }
      }

      // Cache successful results (and search-fallback results, as before).
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

  // Run all source crawls in parallel — each is independent. When a soft deadline
  // is set (user-facing lookups), stop waiting once the budget elapses and proceed
  // with whatever completed — blocked portals (REA/view/etc.) otherwise burn the
  // whole route timeout on doomed stealth-retries. The downstream feed-seed step
  // still produces a usable profile from our own data, so a trimmed crawl is fine.
  // The background full crawl passes no deadline and keeps its longer budget.
  if (softDeadlineMs) {
    const DEADLINE = Symbol('deadline');
    const timer = new Promise<typeof DEADLINE>((res) =>
      setTimeout(() => res(DEADLINE), softDeadlineMs),
    );
    const raced = await Promise.all(jobs.map((job) => Promise.race([job, timer])));
    return raced.map((r, index) =>
      r === DEADLINE
        ? {
            source: sources[index].name,
            url: sources[index].buildPropertyUrl(address),
            status: 'failed' as const,
            crawledAt: new Date(),
            error: `skipped — soft deadline ${softDeadlineMs}ms elapsed`,
          }
        : r,
    );
  }

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
