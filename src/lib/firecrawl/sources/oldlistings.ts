// NOTE: oldlistingsRentSource must also be registered in
// src/lib/firecrawl/sources/index.ts — add it to sourceRegistry and the
// named exports for it to be included in crawl runs.

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

// ─── Shared helpers ──────────────────────────────────────────────────────────

function buildAddressParts(address: StructuredAddress): string {
  return [
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode,
  ].filter(Boolean).join(' ');
}

function buildSuburbSearchUrl(address: StructuredAddress, listingType: 'buy' | 'rent'): string {
  const state = (address.state || 'VIC').toUpperCase();
  const suburb = address.suburb
    .split(/[\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('+');

  return `https://www.oldlistings.com.au/real-estate/${state}/${suburb.replace(/\+/g, '+')}/${address.postcode}/${listingType}/`;
}

// ─── Buy (sales history) ────────────────────────────────────────────────────

function buildBuyPropertyUrl(address: StructuredAddress): string {
  const parts = buildAddressParts(address);
  return `https://www.oldlistings.com.au/address?type=buy&query=${encodeURIComponent(parts)}`;
}

function buildBuySearchUrl(address: StructuredAddress): string {
  return buildSuburbSearchUrl(address, 'buy');
}

export const oldlistingsSource: SourceConfig = {
  name: 'oldlistings.com.au',
  buildPropertyUrl: buildBuyPropertyUrl,
  buildSearchUrl: buildBuySearchUrl,
  scrapeOptions: {
    timeout: 15000,
    formats: ['markdown'],
  },
  enabled: true,
  trustRank: 3,
  refreshIntervalHours: 168, // Weekly — historical data doesn't change often
};

// ─── Rent (rental history) ──────────────────────────────────────────────────

function buildRentPropertyUrl(address: StructuredAddress): string {
  const parts = buildAddressParts(address);
  return `https://www.oldlistings.com.au/address?type=rent&query=${encodeURIComponent(parts)}`;
}

function buildRentSearchUrl(address: StructuredAddress): string {
  return buildSuburbSearchUrl(address, 'rent');
}

export const oldlistingsRentSource: SourceConfig = {
  name: 'oldlistings.com.au-rent',
  buildPropertyUrl: buildRentPropertyUrl,
  buildSearchUrl: buildRentSearchUrl,
  scrapeOptions: {
    timeout: 15000,
    formats: ['markdown'],
  },
  enabled: true,
  trustRank: 3,
  refreshIntervalHours: 168, // Weekly — historical data doesn't change often
};
