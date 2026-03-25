import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';

/**
 * homehound.com.au (Renet) — Property listings and agent platform.
 * Shows: current listings, sold properties, agent info, open homes.
 * Renet is the backend CRM; HomeHound is the consumer portal.
 *
 * URL pattern: /property/{state}/{suburb}/{address-slug}
 * Search: /search?q={address}
 */

function buildPropertyUrl(address: StructuredAddress): string {
  const state = (address.state || 'vic').toLowerCase();
  const suburb = address.suburb.toLowerCase().replace(/\s+/g, '-');

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

  return `https://www.homehound.com.au/property/${state}/${suburb}/${addrSlug}`;
}

function buildSearchUrl(address: StructuredAddress): string {
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

  return `https://www.homehound.com.au/search?q=${encodeURIComponent(query)}`;
}

export const homehoundSource: SourceConfig = {
  name: 'homehound.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  scrapeOptions: {
    timeout: 20000,
    formats: ['markdown'],
  },
  enabled: true,
  trustRank: 3,
  refreshIntervalHours: 24,
};
