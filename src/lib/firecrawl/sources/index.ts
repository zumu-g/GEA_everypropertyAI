import type { SourceConfig } from '@/types/crawl';
import type { StructuredAddress } from '@/types/property';
import { realestateSource } from './realestate';
import { domainSource } from './domain';
import { viewSource } from './view';
import { oldlistingsSource, oldlistingsRentSource } from './oldlistings';
import { homelySource } from './homely';
import { onthehouseSource } from './onthehouse';
import { allhomesSource } from './allhomes';
import { ratemyagentSource } from './ratemyagent';
import { homehoundSource } from './homehound';
import { inspectRealEstateSource } from './inspectrealestate';
import { getAgencySourcesForSuburb } from './agencies';

/**
 * Registry of all portal/aggregator property data sources.
 */
export const sourceRegistry: Record<string, SourceConfig> = {
  [realestateSource.name]: realestateSource,
  [domainSource.name]: domainSource,
  [viewSource.name]: viewSource,
  [oldlistingsSource.name]: oldlistingsSource,
  [oldlistingsRentSource.name]: oldlistingsRentSource,
  [homelySource.name]: homelySource,
  [onthehouseSource.name]: onthehouseSource,
  [allhomesSource.name]: allhomesSource,
  [ratemyagentSource.name]: ratemyagentSource,
  [homehoundSource.name]: homehoundSource,
  [inspectRealEstateSource.name]: inspectRealEstateSource,
};

/**
 * Return only portal sources that are currently enabled.
 */
export function getActiveSources(): SourceConfig[] {
  return Object.values(sourceRegistry).filter((source) => source.enabled);
}

/**
 * High-value sources used by the FAST path (e.g. CRM enrichment). These carry
 * most of the headline fields. The fast crawl trims to these and uses a short
 * timeout so a new-address lookup returns in seconds instead of ~120s; the full
 * 9-source cascade still runs in the background to fill the cache.
 */
export const FAST_SOURCE_NAMES = [
  realestateSource.name,
  domainSource.name,
  viewSource.name,
];

export function getFastSources(): SourceConfig[] {
  return getActiveSources().filter((s) => FAST_SOURCE_NAMES.includes(s.name));
}

/**
 * Return active portal sources PLUS relevant agency websites for the suburb.
 * This gives maximum data coverage for a specific property lookup.
 */
export function getAllSourcesForAddress(address: StructuredAddress): SourceConfig[] {
  const portalSources = getActiveSources();
  const agencySources = address.suburb
    ? getAgencySourcesForSuburb(address.suburb)
    : [];

  return [...portalSources, ...agencySources];
}

/**
 * Get a specific source config by name. Returns undefined if not found.
 */
export function getSource(name: string): SourceConfig | undefined {
  return sourceRegistry[name];
}

export {
  realestateSource,
  domainSource,
  viewSource,
  oldlistingsSource,
  oldlistingsRentSource,
  homelySource,
  onthehouseSource,
  ratemyagentSource,
  homehoundSource,
  inspectRealEstateSource,
  getAgencySourcesForSuburb,
};
