import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * homely.com.au — Property listings, suburb reviews, lifestyle data.
 * Shows: property details, sale history, suburb info, community reviews.
 * URL pattern: /homes/{suburb}-{state}-{postcode}/{street-slug}
 */

/** Map abbreviated street types to their full form for URL slugs. */
const STREET_TYPE_FULL: Record<string, string> = {
  st: 'street',
  str: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  dr: 'drive',
  ct: 'court',
  crt: 'court',
  pl: 'place',
  cr: 'crescent',
  cres: 'crescent',
  cl: 'close',
  pde: 'parade',
  tce: 'terrace',
  ter: 'terrace',
  hwy: 'highway',
  bvd: 'boulevard',
  blvd: 'boulevard',
  ln: 'lane',
  way: 'way',
  cir: 'circuit',
  gr: 'grove',
  gv: 'grove',
  pk: 'park',
  pwy: 'parkway',
  sq: 'square',
  esp: 'esplanade',
  ri: 'rise',
};

/** Expand an abbreviated street type to its full lowercase form. */
function expandStreetType(raw: string): string {
  const key = raw.toLowerCase().replace(/\.$/, '');
  return STREET_TYPE_FULL[key] ?? key;
}

/** Slugify a string: lowercase, spaces/underscores to hyphens, strip non-alphanumeric. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Property-specific URL.
 * Pattern: /homes/{suburb}-{state}-{postcode}/{streetNumber}-{streetName}-{streetType}
 * With unit: /homes/{suburb}-{state}-{postcode}/unit-{unit}-{streetNumber}-{streetName}-{streetType}
 */
function buildPropertyUrl(address: StructuredAddress): string {
  const suburb = slugify(address.suburb);
  const state = (address.state || 'vic').toLowerCase();
  const suburbSlug = `${suburb}-${state}-${address.postcode}`;

  const unit = address.unitNumber || address.unit;
  const streetNumber = slugify(address.streetNumber);
  const streetName = slugify(address.streetName);
  const streetType = expandStreetType(address.streetType);

  const streetSlug = unit
    ? `unit-${slugify(unit)}-${streetNumber}-${streetName}-${streetType}`
    : `${streetNumber}-${streetName}-${streetType}`;

  return `https://www.homely.com.au/homes/${suburbSlug}/${streetSlug}`;
}

/**
 * Suburb-wide fallback URLs for search / discovery.
 * Sold: /sold-properties/{suburb}-{state}-{postcode}
 * For sale: /for-sale/{suburb}-{state}-{postcode}/houses
 */
function buildSearchUrl(address: StructuredAddress): string {
  const suburb = slugify(address.suburb);
  const state = (address.state || 'vic').toLowerCase();
  return `https://www.homely.com.au/sold-properties/${suburb}-${state}-${address.postcode}`;
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
