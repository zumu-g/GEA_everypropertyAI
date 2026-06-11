import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';
import {
  domainProfileHtmlToMarkdown,
  domainProfileHtmlToExtraction,
} from '@/lib/ingest/domain-profile-markdown';

/**
 * Domain URLs use FULL street-type names ("parade", not "pde") — an abbreviated
 * slug 404s. Address-suggest returns abbreviated types, so expand them here.
 */
const STREET_TYPE_EXPANSIONS: Record<string, string> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  dr: 'drive',
  cres: 'crescent',
  cr: 'crescent',
  ct: 'court',
  pl: 'place',
  ln: 'lane',
  tce: 'terrace',
  pde: 'parade',
  cct: 'circuit',
  cl: 'close',
  gr: 'grove',
  blvd: 'boulevard',
  bvd: 'boulevard',
  hwy: 'highway',
  esp: 'esplanade',
  prom: 'promenade',
  sq: 'square',
  gdns: 'gardens',
  ch: 'chase',
  wk: 'walk',
};

function expandStreetType(streetType: string): string {
  const key = streetType.toLowerCase().replace(/\./g, '');
  return STREET_TYPE_EXPANSIONS[key] ?? streetType;
}

/**
 * Construct the direct domain.com.au property profile URL.
 * Domain uses: /property-profile/{address-slug}
 * e.g. https://www.domain.com.au/property-profile/34-allunga-parade-berwick-vic-3806
 */
function buildPropertyUrl(address: StructuredAddress): string {
  const slug = toAddressSlug({
    ...address,
    streetType: expandStreetType(address.streetType ?? ''),
  });
  return `https://www.domain.com.au/property-profile/${slug}`;
}

function buildSearchUrl(address: StructuredAddress): string {
  const query = encodeURIComponent(address.fullAddress ?? address.displayAddress ?? '');
  return `https://www.domain.com.au/sale/?search=${query}&ssubs=0`;
}

export const domainSource: SourceConfig = {
  name: 'domain.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    waitFor: '[data-testid="property-summary"], .property-summary, .css-property-features',
    timeout: 90000,
    formats: ['markdown'],
  },
  enabled: true,
  // Primary: Bright Data Web Unlocker (renders the Next.js profile page through
  // an AU exit and solves the anti-bot challenge). The profile data is parsed
  // deterministically out of __NEXT_DATA__ by htmlToMarkdown below.
  //
  // The previous Apify primary ('shahidirfan/domain-com-au-property-scraper')
  // is a SEARCH scraper: it ignores property-profile URLs (its input is a
  // single `startUrl` search URL) and returns unrelated nationwide listings,
  // which the address gate then rightly discards — net result was an always-
  // empty source. Do not reinstate it for profile lookups.
  fetchBackend: 'web-unlocker',
  fallbackBackends: ['stealth'],
  htmlToMarkdown: domainProfileHtmlToMarkdown,
  htmlToExtraction: domainProfileHtmlToExtraction,
};
