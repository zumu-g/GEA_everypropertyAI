import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';
import {
  onthehousePropertyJsonToMarkdown,
  onthehousePropertyJsonToExtraction,
  matchLocationPropertyId,
} from '@/lib/ingest/onthehouse-profile-json';

/**
 * onthehouse.com.au — CoreLogic-backed property data (national coverage).
 *
 * The page HTML serves no subject data — it's a client-rendered React app whose
 * detail loads from an UNAUTHENTICATED CoreLogic "odin" JSON API on the same
 * origin. We use that API directly (no headless render needed):
 *
 *   1. GET /odin/api/locations?query={address}  → resolve address → othPropertyId
 *   2. GET /odin/api/properties/{othPropertyId} → the full structured record
 *      (beds/baths/carSpaces/land/floor/type/yearBuilt, valuation, last sale)
 *
 * Stage 1 is discoverPropertyUrl; the resolved detail URL is then fetched by the
 * orchestrator and parsed deterministically (no LLM) by the JSON parsers.
 */

const ORIGIN = 'https://www.onthehouse.com.au';

/** Human-facing property page URL — the orchestrator's cache key / nominal URL. */
function buildPropertyUrl(address: StructuredAddress): string {
  const suburbPostcode = `${address.suburb}-${address.postcode}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const state = String(address.state ?? '').toLowerCase();
  return `${ORIGIN}/property/${state}/${suburbPostcode}/${toAddressSlug(address)}`;
}

/** The odin address-resolver URL for an address. */
function buildLocationsUrl(address: StructuredAddress): string {
  const query = [
    address.unitNumber ? `${address.unitNumber}/` : '',
    address.streetNumber,
    address.streetName,
    address.streetType,
    address.suburb,
    address.state,
    address.postcode,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${ORIGIN}/odin/api/locations?query=${encodeURIComponent(query)}`;
}

/** Search page — firecrawl fallback only (won't carry data, but keeps the contract). */
function buildSearchUrl(address: StructuredAddress): string {
  return buildLocationsUrl(address);
}

/**
 * Resolve the address → the odin detail URL. Fetch the locations resolver, match
 * the exact street number, and return /odin/api/properties/{othPropertyId}.
 * Returns null when the address doesn't resolve to a property (skip the fetch).
 */
async function discoverPropertyUrl(
  address: StructuredAddress,
  fetchPage: (url: string) => Promise<string | null>
): Promise<string | null> {
  const body = await fetchPage(buildLocationsUrl(address));
  if (!body) return null;
  const id = matchLocationPropertyId(body, {
    streetNumber: address.streetNumber,
    streetName: address.streetName,
    unitNumber: address.unitNumber ?? address.unit,
  });
  return id ? `${ORIGIN}/odin/api/properties/${id}` : null;
}

export const onthehouseSource: SourceConfig = {
  name: 'onthehouse.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  discoverPropertyUrl,
  scrapeOptions: {
    timeout: 30000,
    formats: ['markdown'],
  },
  enabled: true,
  // The odin API has no anti-bot wall and needs no JS render, but it is AU-geofenced
  // — Web Unlocker (AU exit) is the reliable primary; the JSON is parsed
  // deterministically by the parsers below. Fallbacks cover a WU outage.
  fetchBackend: 'web-unlocker',
  fallbackBackends: ['stealth'],
  htmlToMarkdown: onthehousePropertyJsonToMarkdown,
  htmlToExtraction: onthehousePropertyJsonToExtraction,
  trustRank: 2,
  refreshIntervalHours: 24,
};
