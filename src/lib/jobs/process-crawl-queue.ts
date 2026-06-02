/**
 * Crawl queue worker.
 *
 * Pulls jobs from the Supabase `crawl_queue` table and processes them.
 * Designed to run on a 15-minute Vercel Cron schedule, staying well within
 * the 60-second serverless function limit via an elapsed-time guard.
 *
 * Supported job types:
 * - 'suburb-listing'  — crawl a suburb listing page on REA/Domain
 * - 'property-page'   — scrape one property page and cache the result
 * - 'agency-verify'   — test whether an agency search URL returns data
 */

import { scrapeUrl } from '@/lib/firecrawl/client';
import { extractPropertyData } from '@/lib/extraction/extractor';
import { mergePropertyData } from '@/lib/extraction/merger';
import { propertyCache } from '@/lib/cache';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';
import type { StructuredAddress } from '@/types/property';
import {
  claimNextJob,
  completeJob,
  failJob,
  type CrawlQueueJob,
} from '@/lib/db/queries';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuburbListingPayload {
  suburb: string;
  state: string;
  postcode: string;
  portals?: string[];
}

interface PropertyPagePayload {
  url: string;
  source: string;
  address?: {
    streetNumber?: string;
    streetName?: string;
    streetType?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
}

interface AgencyVerifyPayload {
  agencyId: string;
  website: string;
  searchPattern?: string;
}

interface PropertyProfilePayload {
  address: StructuredAddress;
}

// ─── Exponential backoff ──────────────────────────────────────────────────────

function backoffMs(attempt: number): number {
  // attempt 1 → 60s, attempt 2 → 300s, attempt 3+ → 1800s
  if (attempt <= 1) return 60_000;
  if (attempt === 2) return 300_000;
  return 1_800_000;
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

/**
 * Handler: suburb-listing
 *
 * Fetches listing pages for a given suburb from configured portals and
 * caches results for each address discovered.
 */
async function handleSuburbListing(
  payload: SuburbListingPayload
): Promise<Record<string, unknown>> {
  const { suburb, state, postcode, portals = ['realestate.com.au', 'domain.com.au'] } = payload;

  const slug = suburb.toLowerCase().replace(/\s+/g, '-');
  const stateLower = state.toLowerCase();

  const urls: Array<{ url: string; source: string }> = [];

  if (portals.includes('realestate.com.au')) {
    urls.push({
      url: `https://www.realestate.com.au/buy/in-${slug}-${stateLower}/list-1`,
      source: 'realestate.com.au',
    });
    urls.push({
      url: `https://www.realestate.com.au/sold/in-${slug}-${stateLower}/list-1`,
      source: 'realestate.com.au',
    });
  }

  if (portals.includes('domain.com.au')) {
    urls.push({
      url: `https://www.domain.com.au/sale/${slug}-${stateLower}-${postcode}/`,
      source: 'domain.com.au',
    });
    urls.push({
      url: `https://www.domain.com.au/sold-listings/${slug}-${stateLower}-${postcode}/`,
      source: 'domain.com.au',
    });
  }

  const results = await Promise.allSettled(
    urls.map(({ url, source }) =>
      scrapeUrl(url, source, { timeout: 30000, formats: ['markdown'] })
    )
  );

  const addressPattern = /\b(\d+[a-zA-Z]?(?:\/\d+)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crescent|Cres|Place|Pl|Lane|Ln|Terrace|Tce|Parade|Pde|Boulevard|Blvd|Circuit|Cct|Close|Cl|Way|Grove|Gr|Highway|Hwy)\b/g;

  const addresses = new Set<string>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.status === 'success' && r.value.markdown) {
      let m;
      while ((m = addressPattern.exec(r.value.markdown)) !== null) {
        addresses.add(`${m[1]} ${m[2]} ${m[3]}`);
      }
    }
  }

  return {
    suburb,
    state,
    postcode,
    addressesFound: addresses.size,
    portalsChecked: urls.length,
  };
}

/**
 * Handler: property-page
 *
 * Scrapes a single property URL, extracts structured data, and stores
 * the result in the in-memory property cache.
 */
async function handlePropertyPage(
  payload: PropertyPagePayload
): Promise<Record<string, unknown>> {
  const { url, source } = payload;

  const crawlResult = await scrapeUrl(url, source, {
    timeout: 30000,
    formats: ['markdown'],
  });

  if (crawlResult.status !== 'success' || !crawlResult.markdown) {
    throw new Error(
      `Scrape failed for ${url}: ${crawlResult.error ?? 'no markdown returned'}`
    );
  }

  const extracted = await extractPropertyData(crawlResult.markdown, source);
  const merged = mergePropertyData([extracted]);

  // Derive a cache key from the URL (slug-like)
  const cacheKey = url
    .replace(/https?:\/\//i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');

  propertyCache.set(cacheKey, merged);

  return {
    url,
    source,
    cacheKey,
    cached: true,
  };
}

/**
 * Handler: agency-verify
 *
 * Tests whether an agency search URL returns recognisable property data.
 * Updates the agency record in Supabase with the verification result.
 */
async function handleAgencyVerify(
  payload: AgencyVerifyPayload
): Promise<Record<string, unknown>> {
  const { agencyId, website, searchPattern } = payload;

  const testUrl = searchPattern
    ? searchPattern.replace('{suburb}', 'test').replace('{postcode}', '3000')
    : website;

  const crawlResult = await scrapeUrl(testUrl, 'agency-verify', {
    timeout: 20000,
    formats: ['markdown'],
  });

  const hasData =
    crawlResult.status === 'success' &&
    crawlResult.markdown != null &&
    crawlResult.markdown.length > 200;

  // Check for address-like patterns as a signal of property data
  const hasAddresses = hasData
    ? /\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr)/i.test(
        crawlResult.markdown ?? ''
      )
    : false;

  return {
    agencyId,
    website,
    verified: hasAddresses,
    responseLength: crawlResult.markdown?.length ?? 0,
  };
}

/**
 * Handler: property-profile
 *
 * Runs the full crawl → extract → merge → cache pipeline for one address
 * (multi-source, like /api/property), populating property_cache. This is the
 * job the Casey/Cardinia backfill enqueues.
 */
async function handlePropertyProfile(
  payload: PropertyProfilePayload
): Promise<Record<string, unknown>> {
  if (!payload.address) throw new Error('property-profile job missing address');

  // skipIfCached: a job enqueued earlier may already be cached (e.g. filled by a
  // CRM lookup's background crawl) — don't re-scrape it.
  const { profile, slug, empty } = await fetchAndCacheProfile(payload.address, { skipIfCached: true });

  if (empty) {
    // Surface as an error so the queue retries with backoff.
    throw new Error(`No data extracted for ${slug}`);
  }

  return {
    slug,
    sources: profile.sources.length,
    fields: Object.keys(profile.data).length,
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function dispatchJob(job: CrawlQueueJob): Promise<Record<string, unknown>> {
  const payload = job.payload;

  switch (job.job_type) {
    case 'suburb-listing':
      return handleSuburbListing(payload as unknown as SuburbListingPayload);

    case 'property-page':
      return handlePropertyPage(payload as unknown as PropertyPagePayload);

    case 'agency-verify':
      return handleAgencyVerify(payload as unknown as AgencyVerifyPayload);

    case 'property-profile':
      return handlePropertyProfile(payload as unknown as PropertyProfilePayload);

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

// ─── Main queue processor ─────────────────────────────────────────────────────

/**
 * Pull and process up to `maxJobs` jobs from the crawl queue.
 *
 * - Processes up to 3 jobs concurrently.
 * - Stops early if `timeoutMs` has elapsed (to respect Vercel function limits).
 * - Uses exponential backoff for failed jobs.
 *
 * @param maxJobs   Maximum number of jobs to process in this invocation.
 * @param timeoutMs Stop claiming new jobs after this many milliseconds.
 */
export async function processQueue(
  maxJobs = 10,
  timeoutMs = 50_000
): Promise<{ processed: number; failed: number }> {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  const CONCURRENCY = 3;

  // Collect jobs in batches of CONCURRENCY until maxJobs reached or timeout
  const pending: CrawlQueueJob[] = [];

  while (pending.length + processed + failed < maxJobs) {
    if (Date.now() - startedAt > timeoutMs) {
      console.log('[process-queue] Timeout reached — stopping job claims');
      break;
    }

    const job = await claimNextJob();
    if (!job) {
      // Queue is empty
      break;
    }
    pending.push(job);

    // When we have a full batch, or can't get more, process them
    if (pending.length >= CONCURRENCY) {
      const batch = pending.splice(0, CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((j) => dispatchJob(j))
      );

      for (let i = 0; i < batch.length; i++) {
        const job = batch[i];
        const result = batchResults[i];

        if (!job.id) continue;

        if (result.status === 'fulfilled') {
          await completeJob(job.id, result.value);
          processed++;
          console.log(`[process-queue] Job ${job.id} (${job.job_type}) completed`);
        } else {
          const errMsg =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          const retryMs = backoffMs(job.attempts ?? 1);
          await failJob(job.id, errMsg, retryMs);
          failed++;
          console.error(
            `[process-queue] Job ${job.id} (${job.job_type}) failed: ${errMsg} — retry in ${retryMs / 1000}s`
          );
        }
      }
    }
  }

  // Process any remaining pending jobs (less than a full batch)
  if (pending.length > 0) {
    const batchResults = await Promise.allSettled(
      pending.map((j) => dispatchJob(j))
    );

    for (let i = 0; i < pending.length; i++) {
      const job = pending[i];
      const result = batchResults[i];

      if (!job.id) continue;

      if (result.status === 'fulfilled') {
        await completeJob(job.id, result.value);
        processed++;
        console.log(`[process-queue] Job ${job.id} (${job.job_type}) completed`);
      } else {
        const errMsg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        const retryMs = backoffMs(job.attempts ?? 1);
        await failJob(job.id, errMsg, retryMs);
        failed++;
        console.error(
          `[process-queue] Job ${job.id} (${job.job_type}) failed: ${errMsg} — retry in ${retryMs / 1000}s`
        );
      }
    }
  }

  console.log(
    `[process-queue] Done — processed: ${processed}, failed: ${failed}, elapsed: ${Date.now() - startedAt}ms`
  );

  return { processed, failed };
}
