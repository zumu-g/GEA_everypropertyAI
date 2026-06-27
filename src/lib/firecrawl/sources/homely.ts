import type { StructuredAddress } from '@/types/property';
import type { SourceConfig } from '@/types/crawl';
import { toAddressSlug } from '../address';
import {
  homelyProfileHtmlToMarkdown,
  homelyProfileHtmlToExtraction,
} from '@/lib/ingest/homely-profile-markdown';

/**
 * homely.com.au — Property listings, suburb reviews, lifestyle data.
 *
 * Detail URLs are `/homes/{address-slug}/{numericId}` where the numeric listing
 * id is NOT derivable from the address — so a direct address→URL guess always
 * 404s. Instead we DISCOVER the real URL: the suburb index pages are openly
 * accessible and list every detail link (with its id), so we fetch the index,
 * parse the links, and match the one whose address-slug equals our target.
 */

/** Map abbreviated street types to their full form (Homely URLs use full forms). */
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
  cir: 'circuit',
  cct: 'circuit',
  gr: 'grove',
  gv: 'grove',
  pk: 'park',
  pwy: 'parkway',
  sq: 'square',
  esp: 'esplanade',
  ri: 'rise',
};

function expandStreetType(streetType: string): string {
  const key = streetType.toLowerCase().replace(/\./g, '');
  return STREET_TYPE_FULL[key] ?? streetType;
}

/**
 * The address-slug portion of a Homely detail URL, e.g.
 *   { unit: "2", streetNumber: "31", streetName: "Florence", streetType: "Ave",
 *     suburb: "Berwick", state: "VIC", postcode: "3806" }
 *   → "2-31-florence-avenue-berwick-vic-3806"
 * Matches the leading slug Homely puts before the numeric listing id.
 */
function homelySlug(address: StructuredAddress): string {
  return toAddressSlug({ ...address, streetType: expandStreetType(address.streetType ?? '') });
}

/**
 * Direct (best-effort) property URL — used only as the orchestrator's nominal
 * URL/cache key and the firecrawl search-fallback. The real fetch URL comes from
 * discoverPropertyUrl. Without the numeric id this slug will 404 on its own.
 */
function buildPropertyUrl(address: StructuredAddress): string {
  return `https://www.homely.com.au/homes/${homelySlug(address)}`;
}

/** A URL-safe slug: lowercase, non-alphanumerics → hyphens, collapsed/trimmed. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Suburb index URLs (openly accessible) used to discover the detail link. */
function suburbIndexUrls(address: StructuredAddress): string[] {
  const suburb = slugify(
    `${address.suburb} ${address.state || 'vic'} ${address.postcode}`
  );
  return [
    `https://www.homely.com.au/for-sale/${suburb}`,
    `https://www.homely.com.au/sold-properties/${suburb}`,
  ];
}

function buildSearchUrl(address: StructuredAddress): string {
  return suburbIndexUrls(address)[0];
}

/** Parse `/homes/{slug}/{id}` detail links out of an index page's HTML. */
function parseDetailLinks(html: string): { slug: string; url: string }[] {
  const seen = new Set<string>();
  const out: { slug: string; url: string }[] = [];
  for (const m of html.matchAll(/\/homes\/([a-z0-9-]+)\/(\d+)/gi)) {
    const path = `/homes/${m[1]}/${m[2]}`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ slug: m[1].toLowerCase(), url: `https://www.homely.com.au${path}` });
  }
  return out;
}

/**
 * Discover the real detail URL for an address by fetching the suburb index and
 * matching its links against the target address-slug. Tries for-sale first, then
 * sold. Returns null if no link matches (property not currently listed/sold).
 */
async function discoverPropertyUrl(
  address: StructuredAddress,
  fetchPage: (url: string) => Promise<string | null>
): Promise<string | null> {
  const target = homelySlug(address);
  for (const indexUrl of suburbIndexUrls(address)) {
    const html = await fetchPage(indexUrl);
    if (!html) continue;
    const links = parseDetailLinks(html);
    // Exact match wins; otherwise accept a slug that starts with the target
    // (tolerates trailing differences). The downstream address guard drops any
    // genuine mismatch, so a slightly loose match here is safe.
    const exact = links.find((l) => l.slug === target);
    if (exact) return exact.url;
    const prefix = links.find((l) => l.slug.startsWith(`${target}-`) || l.slug === target);
    if (prefix) return prefix.url;
  }
  return null;
}

export const homelySource: SourceConfig = {
  name: 'homely.com.au',
  buildPropertyUrl,
  buildSearchUrl,
  discoverPropertyUrl,
  scrapeOptions: {
    timeout: 30000,
    formats: ['markdown'],
  },
  enabled: true,
  // Homely serves data with no anti-bot wall, so Web Unlocker (AU exit, renders
  // the Next.js page) is a reliable primary; the detail data is parsed
  // deterministically out of __NEXT_DATA__ by the parsers below.
  fetchBackend: 'web-unlocker',
  fallbackBackends: ['stealth', 'firecrawl'],
  htmlToMarkdown: homelyProfileHtmlToMarkdown,
  htmlToExtraction: homelyProfileHtmlToExtraction,
  trustRank: 2,
  refreshIntervalHours: 24,
};
