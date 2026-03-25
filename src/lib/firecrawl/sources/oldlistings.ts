import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * oldlistings.com.au — 15M+ archived property listings going back 18 years.
 *
 * Shows: historical advertised prices, dated price timeline, beds/baths/cars,
 * land size, property category. No bot protection, server-rendered HTML.
 *
 * Lookup: /address?type=buy&query={full address}
 * Rental: /address?type=rent&query={full address}
 * Suburb: /real-estate/{STATE}/{Suburb}/{postcode}/buy/
 */

function buildPropertyUrl(address: StructuredAddress): string {
  const parts = [
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode,
  ].filter(Boolean).join(' ');

  return `https://www.oldlistings.com.au/address?type=buy&query=${encodeURIComponent(parts)}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  const state = (address.state || 'VIC').toUpperCase();
  const suburb = address.suburb
    .split(/[\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('+');

  return `https://www.oldlistings.com.au/real-estate/${state}/${suburb.replace(/\+/g, '+')}/${address.postcode}/buy/`;
}

export const oldlistingsSource: SourceConfig = {
  name: 'oldlistings.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 15000,
    formats: ['markdown'],
  },
  enabled: true,
  trustRank: 3,
  refreshIntervalHours: 168, // Weekly — historical data doesn't change often
};
