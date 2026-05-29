import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';

/**
 * view.com.au — Victorian property data.
 * Shows sale history, rental history, estimated values, and property details.
 * URL pattern: /property/{street-number}-{street-name}-{suburb}-{state}-{postcode}/
 */

/**
 * URL pattern: /property/{state}/{suburb-postcode}/{street-address}/
 * e.g. https://view.com.au/property/vic/berwick-3806/10-collins-crescent/
 */
function buildPropertyUrl(address: StructuredAddress): string {
  const state = (address.state || 'vic').toLowerCase();
  const suburbSlug = `${address.suburb.toLowerCase().replace(/\s+/g, '-')}-${address.postcode}`;

  const addrParts: string[] = [];
  if (address.unit) addrParts.push(address.unit);
  addrParts.push(
    address.streetNumber,
    address.streetName.toLowerCase().replace(/\s+/g, '-'),
    address.streetType.toLowerCase()
  );
  const addrSlug = addrParts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');

  return `https://www.view.com.au/property/${state}/${suburbSlug}/${addrSlug}/`;
}

function buildSearchUrl(address: StructuredAddress): string {
  return `https://www.view.com.au/sold-properties/`;
}

export const viewSource: SourceConfig = {
  name: 'view.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 30000,
    formats: ['markdown'],
  },
  // Apify actor handles DataDome bypass — re-enabled
  enabled: true,
  trustRank: 2,
  refreshIntervalHours: 24,
  options: { apifyActorId: 'abotapi/view-com-au-scraper' },
  // Fall back to Firecrawl then the stealth-browser service when Apify is
  // unavailable/fails. Skipped if stealth is unconfigured.
  fallbackBackends: ['firecrawl', 'stealth'],
};
