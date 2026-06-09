/**
 * Extract Domain.com.au listing items from a rendered search/sold-listings/sale/
 * rent PAGE's HTML (as returned by Web Unlocker) → the `DomainItem` shape that
 * `mapItem` (domain-mapper.ts) already consumes.
 *
 * Domain is a Next.js site: the listing data is embedded in
 *   <script id="__NEXT_DATA__" type="application/json">{...}</script>
 * under `props.pageProps.componentProps.listingsMap` (an object keyed by listing
 * id; each value carries a `listingModel`). This module: (1) pulls + parses that
 * script, (2) locates the listings collection defensively, (3) maps each node to
 * `DomainItem`.
 *
 * ⚠️ CALIBRATION REQUIRED: the exact key path + per-listing field names must be
 * confirmed against a LIVE Domain page captured via Web Unlocker (U1) — Domain's
 * embedded shape is not contractually stable. `LISTINGS_PATHS` and
 * `listingNodeToDomainItem` below are the two calibration points; the fixtures in
 * __tests__ encode the currently-assumed shape. Until calibrated against live HTML
 * this returns [] for real pages (which the runner treats as a dry source → fallback).
 */

import type { DomainItem } from './domain-mapper';

/** Pull the parsed __NEXT_DATA__ JSON object from page HTML, or null. */
export function parseNextData(html: string): Record<string, unknown> | null {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Known locations of the listings collection within __NEXT_DATA__. Ordered most-
// to least-specific; first hit wins. Add the live-confirmed path here.
const LISTINGS_PATHS: string[][] = [
  ['props', 'pageProps', 'componentProps', 'listingsMap'],
  ['props', 'pageProps', 'componentProps', 'listingSearchMap'],
  ['props', 'pageProps', 'listingsMap'],
];

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** A listings collection may be an array or an id-keyed object; normalise to array. */
function toNodeArray(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  if (collection && typeof collection === 'object') return Object.values(collection as Record<string, unknown>);
  return [];
}

/** Locate the listings collection nodes within parsed __NEXT_DATA__. */
export function findListingNodes(nextData: Record<string, unknown> | null): unknown[] {
  if (!nextData) return [];
  for (const path of LISTINGS_PATHS) {
    const found = getPath(nextData, path);
    const nodes = toNodeArray(found);
    if (nodes.length) return nodes;
  }
  return [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Map one Domain listing node (its `listingModel`) → a `DomainItem`.
 * ⚠️ CALIBRATION POINT — field names are the assumed Domain shape; confirm live.
 */
export function listingNodeToDomainItem(node: unknown): DomainItem | null {
  if (!node || typeof node !== 'object') return null;
  const model = ((node as Record<string, unknown>).listingModel ?? node) as Record<string, unknown>;
  const address = model.address as Record<string, unknown> | undefined;
  const features = model.features as Record<string, unknown> | undefined;
  const branding = model.branding as Record<string, unknown> | undefined;
  const tags = model.tags as Record<string, unknown> | undefined;

  const displayAddress = str(address?.displayAddress) ?? str(model.address as unknown);
  if (!displayAddress) return null;

  return {
    url: str(model.url) ?? str((node as Record<string, unknown>).url),
    dateListed: str(model.dateListed) ?? str(model.dateUpdated),
    location: {
      display_address: displayAddress,
      suburb: str(address?.suburb),
      state: str(address?.state),
      postcode: str(address?.postcode),
      latitude: n((address?.lat as unknown) ?? (model.geoLocation as Record<string, unknown>)?.latitude),
      longitude: n((address?.lng as unknown) ?? (model.geoLocation as Record<string, unknown>)?.longitude),
    },
    pricing: { display_price: str(model.price) ?? str((model.priceDetails as Record<string, unknown>)?.displayPrice) },
    listing: { tags: { tag_text: str(tags?.tagText) ?? str(model.tagText) } },
    property: {
      property_type: str(model.propertyType ?? model.propertyTypeText),
      bedrooms: n(features?.beds),
      bathrooms: n(features?.baths),
      parking: n(features?.parking),
      land_size: n(features?.landSize),
      image_urls: Array.isArray(model.images)
        ? (model.images as unknown[]).map((i) => str((i as Record<string, unknown>)?.url) ?? str(i)).filter(Boolean) as string[]
        : undefined,
    },
    contacts: {
      agency: { name: str(branding?.name) ?? str(model.agencyName) },
      agent_names: str(model.advertiserIdentifiers as unknown),
    },
  };
}

/** Full pipeline: page HTML → DomainItem[]. Returns [] on any parse miss (→ fallback). */
export function extractDomainListings(html: string): DomainItem[] {
  const nextData = parseNextData(html);
  const nodes = findListingNodes(nextData);
  const out: DomainItem[] = [];
  for (const node of nodes) {
    const item = listingNodeToDomainItem(node);
    if (item) out.push(item);
  }
  return out;
}
