/**
 * Daily listings crawler.
 *
 * Fetches new and recently sold listings from major portals, extracts property
 * data, and stores it in the in-memory cache (or Supabase when configured).
 *
 * Designed to run as a cron job or triggered via API.
 *
 * Sources crawled:
 * - realestate.com.au — new listings + recent sold
 * - domain.com.au — new listings + recent sold
 * - view.com.au — recent sold (VIC)
 */

import { fetchPage } from '@/lib/firecrawl/client';
import { scrapeWithStealth as scrapeUrl } from '@/lib/stealth/client';
import { extractPropertyData } from '@/lib/extraction/extractor';
import { mergePropertyData } from '@/lib/extraction/merger';
import { propertyCache } from '@/lib/cache';
import { parseAddress, toSlug } from '@/lib/utils/address';
import {
  getSuburbsDueForCrawl,
  markSuburbCrawled,
} from '@/lib/db/queries';
import { isSupabaseConfigured } from '@/lib/db/supabase';
import { VIC_SUBURBS } from '@/data/vic-suburbs';

// ─── Per-domain rate limiting ────────────────────────────────────────────────

const lastRequestTime = new Map<string, number>();

const DOMAIN_INTERVALS: Record<string, number> = {
  'realestate.com.au': 2000,
  'domain.com.au': 2000,
};
const DEFAULT_AGENCY_INTERVAL = 5000;

async function rateLimitedFetch(domain: string, minIntervalMs?: number): Promise<void> {
  const interval = minIntervalMs ?? DOMAIN_INTERVALS[domain] ?? DEFAULT_AGENCY_INTERVAL;
  const last = lastRequestTime.get(domain) ?? 0;
  const wait = Math.max(0, last + interval - Date.now());
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  lastRequestTime.set(domain, Date.now());
}

// ─── Suburb offset fallback (cycles through VIC_SUBURBS when DB unavailable) ─

let suburbOffset = 0;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyJobResult {
  startedAt: string;
  completedAt: string;
  suburbs: string[];
  listingsFound: number;
  listingsProcessed: number;
  errors: string[];
}

export interface DailyJobConfig {
  /** Suburbs to crawl (e.g. ["Berwick", "Officer", "Narre Warren"]) */
  suburbs: Array<{
    name: string;
    state: string;
    postcode: string;
  }>;
  /** Max listings to process per suburb per source */
  maxPerSuburb?: number;
  /** Which listing types to fetch */
  types?: ('buy' | 'sold' | 'rent')[];
}

export interface ChunkCrawlResult {
  processed: number;
  total: number;
  listingsFound: number;
  errors: number;
}

// ─── Address extraction ───────────────────────────────────────────────────────

/**
 * Extract individual property addresses from a listings page markdown.
 * Looks for Australian address patterns in the crawled text.
 */
function extractAddressesFromListings(markdown: string): string[] {
  const addressPattern = /\b(\d+[a-zA-Z]?(?:\/\d+)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crescent|Cres|Place|Pl|Lane|Ln|Terrace|Tce|Parade|Pde|Boulevard|Blvd|Circuit|Cct|Close|Cl|Way|Grove|Gr|Highway|Hwy)\b[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;

  const addresses = new Set<string>();
  let match;

  while ((match = addressPattern.exec(markdown)) !== null) {
    const addr = `${match[1]} ${match[2]} ${match[3]}, ${match[4]}`;
    addresses.add(addr);
  }

  return [...addresses].slice(0, 50); // Cap at 50 per page
}

/**
 * Extract individual property addresses from raw HTML returned by direct fetch.
 * Strips script/style tags and HTML markup before applying address regex.
 */
function extractAddressesFromHtml(html: string): string[] {
  // Strip HTML tags to get text content
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  const addressPattern = /\b(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Crescent|Cres|Place|Pl|Lane|Ln|Terrace|Tce|Parade|Pde|Boulevard|Blvd|Circuit|Cct|Close|Cl|Way|Grove|Gr|Highway|Hwy|Rise|Walk|View|Mews|Square|Sq)\b[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;

  const addresses = new Set<string>();
  let match;
  while ((match = addressPattern.exec(text)) !== null) {
    const addr = `${match[1]} ${match[2]} ${match[3]}, ${match[4]}`;
    // Sanity check: suburb should be a real word, not "The" or "A"
    if (match[4].length >= 3) {
      addresses.add(addr);
    }
  }
  return [...addresses].slice(0, 100); // 100 per page
}

/**
 * Fetch all listing pages for a suburb/type using direct fetch (not Firecrawl).
 * Paginates through pages until empty or max pages reached.
 * Returns deduplicated set of property addresses.
 */
async function fetchListingAddresses(
  suburb: { name: string; state: string; postcode: string },
  type: 'buy' | 'sold' | 'rent',
  maxPages = 5
): Promise<Set<string>> {
  const allAddresses = new Set<string>();

  // Build paginated URL lists for each portal
  const portals: { urlFn: (page: number) => string; domain: string }[] = [
    {
      domain: 'realestate.com.au',
      urlFn: (page) => {
        const slug = `${suburb.name.toLowerCase().replace(/\s+/g, '-')}-${suburb.state.toLowerCase()}`;
        const path = type === 'sold' ? 'sold' : type === 'rent' ? 'rent' : 'buy';
        return `https://www.realestate.com.au/${path}/in-${slug}/list-${page}`;
      },
    },
    {
      domain: 'domain.com.au',
      urlFn: (page) => {
        const slug = `${suburb.name.toLowerCase().replace(/\s+/g, '-')}-${suburb.state.toLowerCase()}-${suburb.postcode}`;
        const path = type === 'sold' ? 'sold-listings' : type === 'rent' ? 'rent' : 'sale';
        return `https://www.domain.com.au/${path}/${slug}/?page=${page}`;
      },
    },
  ];

  for (const { urlFn, domain } of portals) {
    let prevCount = 0;
    for (let page = 1; page <= maxPages; page++) {
      await rateLimitedFetch(domain);
      const url = urlFn(page);
      const { html, ok, status } = await fetchPage(url);

      if (!ok || status === 404 || html.length < 500) {
        break; // No more pages or blocked
      }

      const addresses = extractAddressesFromHtml(html);
      addresses.forEach((a) => allAddresses.add(a));

      // Stop paginating if this page added no new addresses (end of results)
      if (allAddresses.size === prevCount) break;
      prevCount = allAddresses.size;
    }
  }

  return allAddresses;
}

// ─── Core suburb crawl ────────────────────────────────────────────────────────

/**
 * Crawl listings for a single suburb across REA, Domain, and View.
 * Returns the number of listings found and processed.
 */
async function crawlSuburb(
  suburb: { name: string; state: string; postcode: string },
  types: ('buy' | 'sold' | 'rent')[] = ['buy', 'sold'],
  maxPerSuburb = 10
): Promise<{ listingsFound: number; listingsProcessed: number; errors: string[] }> {
  let listingsFound = 0;
  let listingsProcessed = 0;
  const errors: string[] = [];

  console.log(`[daily-listings] Processing ${suburb.name}, ${suburb.state} ${suburb.postcode}`);

  for (const type of types) {
    try {
      // ── Step 1: Discover addresses via direct fetch (no Firecrawl) ──
      const allAddresses = await fetchListingAddresses(suburb, type, 5);

      listingsFound += allAddresses.size;
      console.log(`[daily-listings] ${suburb.name} ${type}: found ${allAddresses.size} addresses`);

      // ── Step 2: Crawl individual property pages via Firecrawl ──
      const toProcess = [...allAddresses].slice(0, maxPerSuburb);

      for (const addr of toProcess) {
        try {
          const parsed = parseAddress(`${addr} ${suburb.state} ${suburb.postcode}`);
          const slug = toSlug(parsed);

          // Skip if already cached and fresh
          if (propertyCache.has(slug)) {
            continue;
          }

          // Apply per-domain rate limiting before each property page fetch
          await rateLimitedFetch('realestate.com.au');
          const reaResult = scrapeUrl(
            `https://www.realestate.com.au/property/${slug}`,
            'realestate.com.au',
            { timeout: 30000 }
          );

          await rateLimitedFetch('domain.com.au');
          const domainResult = scrapeUrl(
            `https://www.domain.com.au/property-profile/${slug}`,
            'domain.com.au',
            { timeout: 30000 }
          );

          const propertyCrawls = await Promise.allSettled([reaResult, domainResult]);

          const successful = propertyCrawls
            .filter((r) => r.status === 'fulfilled')
            .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof scrapeUrl>>>).value)
            .filter((v) => v.status === 'success');

          if (successful.length > 0) {
            const extractions = await Promise.all(
              successful.map((r) => extractPropertyData(r.markdown ?? '', r.source))
            );

            const profile = mergePropertyData(extractions);
            propertyCache.set(slug, profile);
            listingsProcessed++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${addr}: ${msg}`);
        }

        // Rate limit: 2s between property crawls (up from 500ms)
        await new Promise<void>((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${suburb.name} ${type}: ${msg}`);
    }
  }

  return { listingsFound, listingsProcessed, errors };
}

// ─── Chunked suburb crawl ─────────────────────────────────────────────────────

/**
 * Runs a chunked crawl across VIC suburbs, processing `chunkSize` suburbs
 * at a time with up to 3 concurrent suburb crawls.
 *
 * Tries Supabase `suburb_crawl_progress` first; falls back to cycling through
 * VIC_SUBURBS using a module-level offset when Supabase is unavailable.
 */
export async function runChunkedSuburbCrawl(chunkSize = 15): Promise<ChunkCrawlResult> {
  const result: ChunkCrawlResult = {
    processed: 0,
    total: VIC_SUBURBS.length,
    listingsFound: 0,
    errors: 0,
  };

  // Get suburbs due for crawl
  let suburbs: Array<{ name: string; state: string; postcode: string }> = [];

  if (isSupabaseConfigured()) {
    const due = await getSuburbsDueForCrawl('VIC', chunkSize);
    suburbs = due.map((d) => ({ name: d.suburb, state: d.state, postcode: d.postcode }));
  }

  // Fallback: cycle through VIC_SUBURBS using offset
  if (suburbs.length === 0) {
    const chunk: Array<{ name: string; state: string; postcode: string }> = [];
    for (let i = 0; i < chunkSize; i++) {
      const entry = VIC_SUBURBS[(suburbOffset + i) % VIC_SUBURBS.length];
      chunk.push({ name: entry.name, state: 'VIC', postcode: entry.postcode });
    }
    suburbOffset = (suburbOffset + chunkSize) % VIC_SUBURBS.length;
    suburbs = chunk;
  }

  console.log(`[daily-listings] Chunked crawl: ${suburbs.length} suburbs selected`);

  // Process up to 3 suburbs concurrently
  const CONCURRENCY = 3;
  for (let i = 0; i < suburbs.length; i += CONCURRENCY) {
    const batch = suburbs.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.allSettled(
      batch.map((suburb) => crawlSuburb(suburb))
    );

    for (let j = 0; j < batch.length; j++) {
      const suburb = batch[j];
      const batchResult = batchResults[j];

      if (batchResult.status === 'fulfilled') {
        const { listingsFound, errors } = batchResult.value;
        result.listingsFound += listingsFound;
        result.errors += errors.length;
        result.processed++;

        // Mark crawled in Supabase if configured
        await markSuburbCrawled(suburb.name, 'VIC', suburb.postcode, listingsFound);
      } else {
        result.errors++;
        console.error(
          `[daily-listings] Failed suburb ${suburb.name}:`,
          batchResult.reason
        );
      }
    }

    // Rate limit: 3s between suburb batches
    if (i + CONCURRENCY < suburbs.length) {
      await new Promise<void>((r) => setTimeout(r, 3000));
    }
  }

  console.log(
    `[daily-listings] Chunked crawl complete: ${result.processed} processed, ` +
    `${result.listingsFound} listings found, ${result.errors} errors`
  );

  return result;
}

// ─── Seed suburb progress ─────────────────────────────────────────────────────

/**
 * One-time setup: populates `suburb_crawl_progress` with all VIC_SUBURBS
 * if the table is empty. Each suburb is seeded with `next_due = NOW()`
 * so it is immediately eligible for crawling.
 */
export async function seedSuburbProgress(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.log('[seedSuburbProgress] Supabase not configured — skipping seed');
    return;
  }

  console.log(`[seedSuburbProgress] Seeding ${VIC_SUBURBS.length} VIC suburbs...`);
  let seeded = 0;

  for (const entry of VIC_SUBURBS) {
    try {
      await markSuburbCrawled(entry.name, 'VIC', entry.postcode, 0, 0);
      seeded++;
    } catch (err) {
      console.error(`[seedSuburbProgress] Failed to seed ${entry.name}:`, err);
    }
  }

  console.log(`[seedSuburbProgress] Done — seeded ${seeded} suburbs`);
}

// ─── Main export: runDailyListingsCrawl ──────────────────────────────────────

/**
 * Run the daily listings crawl for configured suburbs.
 *
 * If `config.suburbs` is empty, delegates to `runChunkedSuburbCrawl(15)`
 * to process a rotating chunk of all VIC suburbs.
 */
export async function runDailyListingsCrawl(
  config: DailyJobConfig
): Promise<DailyJobResult> {
  const result: DailyJobResult = {
    startedAt: new Date().toISOString(),
    completedAt: '',
    suburbs: [],
    listingsFound: 0,
    listingsProcessed: 0,
    errors: [],
  };

  // If no suburbs configured, use chunked crawl across all VIC
  if (!config.suburbs || config.suburbs.length === 0) {
    const chunkResult = await runChunkedSuburbCrawl(15);
    result.suburbs = [`chunk:${chunkResult.processed}/${chunkResult.total}`];
    result.listingsFound = chunkResult.listingsFound;
    result.completedAt = new Date().toISOString();
    return result;
  }

  // Existing explicit suburb list behaviour (backward compat)
  result.suburbs = config.suburbs.map((s) => s.name);

  const types = config.types ?? ['buy', 'sold'];
  const maxPerSuburb = config.maxPerSuburb ?? 10;

  for (const suburb of config.suburbs) {
    const suburbResult = await crawlSuburb(suburb, types, maxPerSuburb);
    result.listingsFound += suburbResult.listingsFound;
    result.listingsProcessed += suburbResult.listingsProcessed;
    result.errors.push(...suburbResult.errors);

    // Mark crawled in Supabase
    await markSuburbCrawled(suburb.name, suburb.state, suburb.postcode, suburbResult.listingsFound);

    // Rate limit: 3s between suburbs (up from 1000ms)
    await new Promise<void>((r) => setTimeout(r, 3000));
  }

  result.completedAt = new Date().toISOString();
  console.log(
    `[daily-listings] Complete: ${result.listingsProcessed} processed, ${result.errors.length} errors`
  );

  return result;
}

/**
 * Default suburbs to crawl daily. Extend this based on user preferences.
 */
export const DEFAULT_VIC_SUBURBS: DailyJobConfig['suburbs'] = [
  { name: 'Berwick', state: 'VIC', postcode: '3806' },
  { name: 'Officer', state: 'VIC', postcode: '3809' },
  { name: 'Narre Warren', state: 'VIC', postcode: '3805' },
  { name: 'Cranbourne', state: 'VIC', postcode: '3977' },
  { name: 'Pakenham', state: 'VIC', postcode: '3810' },
  { name: 'Clyde', state: 'VIC', postcode: '3978' },
  { name: 'Clyde North', state: 'VIC', postcode: '3978' },
  { name: 'Beaconsfield', state: 'VIC', postcode: '3807' },
];
