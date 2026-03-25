import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';

/**
 * Construct the direct realestate.com.au property URL.
 * REA uses: /property/{slug}
 * e.g. https://www.realestate.com.au/property/5-42-smith-st-sydney-nsw-2000
 *
 * REA abbreviates street types in URLs (Street → st, Road → rd, etc.)
 */
const STREET_TYPE_ABBREV: Record<string, string> = {
  street: 'st',
  road: 'rd',
  avenue: 'ave',
  drive: 'dr',
  place: 'pl',
  court: 'ct',
  crescent: 'cres',
  terrace: 'tce',
  lane: 'ln',
  highway: 'hwy',
  boulevard: 'blvd',
  parade: 'pde',
  circuit: 'cct',
  close: 'cl',
  way: 'way',
  grove: 'gr',
};

function abbreviateStreetType(streetType: string): string {
  return STREET_TYPE_ABBREV[streetType.toLowerCase()] ?? streetType.toLowerCase();
}

function buildPropertyUrl(address: StructuredAddress): string {
  const parts: string[] = [];

  if (address.unit) {
    parts.push(address.unit);
  }

  parts.push(
    address.streetNumber,
    address.streetName,
    abbreviateStreetType(address.streetType),
    address.suburb,
    address.state,
    address.postcode
  );

  const slug = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `https://www.realestate.com.au/property/${slug}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  const query = encodeURIComponent(address.fullAddress ?? address.displayAddress ?? '');
  return `https://www.realestate.com.au/sold/in-${toAddressSlug(address)}/list-1?searchTerm=${query}`;
}

export const realestateSource: SourceConfig = {
  name: 'realestate.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    waitFor: '.property-info, .property-features, [data-testid="property-features"]',
    timeout: 30000,
    formats: ['markdown'],
  },
  enabled: true,
};
