import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';

/**
 * Construct the direct domain.com.au property profile URL.
 * Domain uses: /property-profile/{address-slug}
 * e.g. https://www.domain.com.au/property-profile/5-42-smith-street-sydney-nsw-2000
 *
 * Domain keeps full street type names in URLs (unlike REA which abbreviates).
 */
function buildPropertyUrl(address: StructuredAddress): string {
  const slug = toAddressSlug(address);
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
    timeout: 30000,
    formats: ['markdown'],
  },
  enabled: true,
  // Routed through Apify actor for reliable Cloudflare bypass.
  // 'domain-com-au-property-scraper' accepts individual property-profile URLs.
  options: { apifyActorId: 'shahidirfan/domain-com-au-property-scraper' },
  // Fall back to Firecrawl then the stealth-browser service when Apify is
  // unavailable/fails. Skipped if stealth is unconfigured.
  fallbackBackends: ['firecrawl', 'stealth'],
};
