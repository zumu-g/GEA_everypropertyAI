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

import { scrapeUrl } from '@/lib/firecrawl/client';
import { extractPropertyData } from '@/lib/extraction/extractor';
import { mergePropertyData } from '@/lib/extraction/merger';
import { propertyCache } from '@/lib/cache';
import { parseAddress, toSlug } from '@/lib/utils/address';

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

// REA sold/buy listing pages
function reaListingsUrl(suburb: string, state: string, type: 'buy' | 'sold' | 'rent'): string {
  const slug = `${suburb.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}`;
  if (type === 'sold') {
    return `https://www.realestate.com.au/sold/in-${slug}/list-1`;
  }
  if (type === 'rent') {
    return `https://www.realestate.com.au/rent/in-${slug}/list-1`;
  }
  return `https://www.realestate.com.au/buy/in-${slug}/list-1`;
}

// Domain sold/buy listing pages
function domainListingsUrl(suburb: string, state: string, postcode: string, type: 'buy' | 'sold' | 'rent'): string {
  const slug = `${suburb.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}-${postcode}`;
  if (type === 'sold') {
    return `https://www.domain.com.au/sold-listings/${slug}/`;
  }
  if (type === 'rent') {
    return `https://www.domain.com.au/rent/${slug}/`;
  }
  return `https://www.domain.com.au/sale/${slug}/`;
}

// View.com.au recent sales (VIC only)
function viewSoldUrl(suburb: string, postcode: string): string {
  const slug = suburb.toLowerCase().replace(/\s+/g, '-');
  return `https://www.view.com.au/sold/${slug}-${postcode}-vic/`;
}

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
 * Run the daily listings crawl for configured suburbs.
 */
export async function runDailyListingsCrawl(
  config: DailyJobConfig
): Promise<DailyJobResult> {
  const result: DailyJobResult = {
    startedAt: new Date().toISOString(),
    completedAt: '',
    suburbs: config.suburbs.map((s) => s.name),
    listingsFound: 0,
    listingsProcessed: 0,
    errors: [],
  };

  const types = config.types ?? ['buy', 'sold'];
  const maxPerSuburb = config.maxPerSuburb ?? 10;

  for (const suburb of config.suburbs) {
    console.log(`[daily-listings] Processing ${suburb.name}, ${suburb.state} ${suburb.postcode}`);

    for (const type of types) {
      try {
        // Crawl listing pages from multiple sources in parallel
        const urls = [
          { url: reaListingsUrl(suburb.name, suburb.state, type), source: 'realestate.com.au' },
          { url: domainListingsUrl(suburb.name, suburb.state, suburb.postcode, type), source: 'domain.com.au' },
        ];

        // Add view.com.au for VIC sold listings
        if (suburb.state.toUpperCase() === 'VIC' && type === 'sold') {
          urls.push({
            url: viewSoldUrl(suburb.name, suburb.postcode),
            source: 'view.com.au',
          });
        }

        const crawlResults = await Promise.allSettled(
          urls.map(({ url, source }) =>
            scrapeUrl(url, source, { timeout: 30000, formats: ['markdown'] })
          )
        );

        // Extract addresses from each listing page
        const allAddresses = new Set<string>();
        for (const cr of crawlResults) {
          if (cr.status === 'fulfilled' && cr.value.status === 'success' && cr.value.markdown) {
            const addresses = extractAddressesFromListings(cr.value.markdown);
            addresses.forEach((a) => allAddresses.add(a));
          }
        }

        result.listingsFound += allAddresses.size;
        console.log(`[daily-listings] ${suburb.name} ${type}: found ${allAddresses.size} addresses`);

        // Process each address (up to max)
        const toProcess = [...allAddresses].slice(0, maxPerSuburb);

        for (const addr of toProcess) {
          try {
            const parsed = parseAddress(`${addr} ${suburb.state} ${suburb.postcode}`);
            const slug = toSlug(parsed);

            // Skip if already cached and fresh
            if (propertyCache.has(slug)) {
              continue;
            }

            // Crawl the individual property from all sources
            const propertyCrawls = await Promise.allSettled([
              scrapeUrl(
                `https://www.realestate.com.au/property/${slug}`,
                'realestate.com.au',
                { timeout: 30000, formats: ['markdown'] }
              ),
              scrapeUrl(
                `https://www.domain.com.au/property-profile/${slug}`,
                'domain.com.au',
                { timeout: 30000, formats: ['markdown'] }
              ),
            ]);

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
              result.listingsProcessed++;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`${addr}: ${msg}`);
          }

          // Rate limit: small delay between property crawls
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`${suburb.name} ${type}: ${msg}`);
      }
    }

    // Rate limit between suburbs
    await new Promise((r) => setTimeout(r, 1000));
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
