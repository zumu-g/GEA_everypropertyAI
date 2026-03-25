import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * homely.com.au — Property listings, suburb reviews, lifestyle data.
 * Shows: property details, sale history, suburb info, community reviews.
 * URL pattern: /homes/{suburb}-{state}-{postcode}/{street-slug}
 */

/**
 * Homely uses short state codes in URLs.
 * Property URLs need a numeric ID we don't have, so we use sold-properties
 * suburb page as the lookup — it lists recent sales with data we can extract.
 *
 * Sold: /sold-properties/{suburb}-{state}-{postcode}
 * For sale: /for-sale/{suburb}-{state}-{postcode}/houses
 */
function buildPropertyUrl(address: StructuredAddress): string {
  const suburb = address.suburb.toLowerCase().replace(/\s+/g, '-');
  const state = (address.state || 'vic').toLowerCase();
  // Use sold-properties page — lists recent sales with addresses we can match
  return `https://www.homely.com.au/sold-properties/${suburb}-${state}-${address.postcode}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  const suburb = address.suburb.toLowerCase().replace(/\s+/g, '-');
  const state = (address.state || 'vic').toLowerCase();
  return `https://www.homely.com.au/for-sale/${suburb}-${state}-${address.postcode}/houses`;
}

export const homelySource: SourceConfig = {
  name: 'homely.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 20000,
    formats: ['markdown'],
  },
  enabled: true,
  trustRank: 2,
  refreshIntervalHours: 24,
};
