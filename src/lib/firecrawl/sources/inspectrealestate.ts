import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * inspectrealestate.com.au — Inspection booking and listing platform.
 * Shows: current listings, open home times, property details, agent info.
 * Many agencies use this as their inspection management tool.
 *
 * Search: /search/residential/sale?query={address}
 */

function buildPropertyUrl(address: StructuredAddress): string {
  const query = [
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode,
  ]
    .filter(Boolean)
    .join(' ');

  return `https://www.inspectrealestate.com.au/search/residential/sale?query=${encodeURIComponent(query)}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  return buildPropertyUrl(address);
}

export const inspectRealEstateSource: SourceConfig = {
  name: 'inspectrealestate.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 20000,
    formats: ['markdown'],
  },
  // Disabled: inspectrealestate.com.au is B2B agent SaaS, not a consumer property portal.
  enabled: false,
  trustRank: 3,
  refreshIntervalHours: 12, // Frequent refresh — inspection times change often
};
