import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * ratemyagent.com.au — Agent reviews and property sale results.
 * Shows: agent reviews, recent sales, sale prices, agent performance stats.
 * Useful for: which agent sold the property, reviews, sale method, price achieved.
 *
 * URL pattern: /real-estate-agent/{suburb}-{state}-{postcode}/sold/{address-slug}
 * Search: /real-estate-agent/{suburb}-{state}-{postcode}
 */

function buildPropertyUrl(address: StructuredAddress): string {
  const suburb = address.suburb.toLowerCase().replace(/\s+/g, '-');
  const state = (address.state || 'vic').toLowerCase();
  const postcode = address.postcode;

  const parts: string[] = [];
  if (address.unit) parts.push(address.unit);
  parts.push(
    address.streetNumber,
    address.streetName.toLowerCase().replace(/\s+/g, '-'),
    address.streetType.toLowerCase()
  );
  const addrSlug = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');

  return `https://www.ratemyagent.com.au/real-estate-agent/${suburb}-${state}-${postcode}/sold/${addrSlug}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  const suburb = address.suburb.toLowerCase().replace(/\s+/g, '-');
  const state = (address.state || 'vic').toLowerCase();
  return `https://www.ratemyagent.com.au/real-estate-agent/${suburb}-${state}-${address.postcode}`;
}

export const ratemyagentSource: SourceConfig = {
  name: 'ratemyagent.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 20000,
    formats: ['markdown'],
  },
  // Disabled: DataDome captcha protection blocks all content pages (403).
  enabled: false,
  trustRank: 3,
  refreshIntervalHours: 48,
};
