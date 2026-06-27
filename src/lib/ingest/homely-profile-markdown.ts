/**
 * Convert a homely.com.au property-detail PAGE (rendered HTML, e.g. fetched via
 * Web Unlocker) into LLM-ready markdown + deterministic extraction.
 *
 * Homely is a Next.js app whose data lives in
 *   <script id="__NEXT_DATA__">…</script>
 * under `props.pageProps.listing` — a clean, fully-structured listing node
 * carrying the subject (beds/baths/cars/land/type), price, sale/sold timeline,
 * geo, agent/office, photos and description. Because it is structured, the
 * deterministic extraction below bypasses the LLM extractor entirely (exact
 * values, no transcription drift).
 *
 * Both functions return null when the page is a shell or 404 (no listing node)
 * so the orchestrator treats the fetch as failed and continues the fallback
 * chain.
 */

import { parseNextData } from './domain-page-extractor';
import type { ExtractedPropertyData } from '@/types/property';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

function isoDay(v: unknown): string | undefined {
  const s = str(v);
  return s ? s.slice(0, 10) : undefined;
}

/** Locate the `listing` node under props.pageProps. */
function findListingNode(nextData: Obj): Obj | null {
  const listing = (((nextData.props as Obj)?.pageProps as Obj)?.listing ?? null) as Obj | null;
  return isObj(listing) ? listing : null;
}

/** Split Homely's combined `street` ("Murndal Court") into name + type. */
function splitStreet(street: string | undefined): { streetName?: string; streetType?: string } {
  if (!street) return {};
  const parts = street.trim().split(/\s+/);
  if (parts.length === 1) return { streetName: parts[0] };
  return { streetType: parts[parts.length - 1], streetName: parts.slice(0, -1).join(' ') };
}

/** Parse a price range / single from Homely's display text, e.g. "$800,000 - $880,000". */
function parsePriceRange(text: string | undefined): { from?: number; to?: number } {
  if (!text) return {};
  const nums = [...text.matchAll(/\$\s*([\d,]+)(?:\s*([kKmM]))?/g)].map((m) => {
    let n = parseInt(m[1].replace(/,/g, ''), 10);
    const suffix = m[2]?.toLowerCase();
    if (suffix === 'k') n *= 1_000;
    else if (suffix === 'm') n *= 1_000_000;
    return n;
  }).filter((n) => Number.isFinite(n) && n >= 50_000 && n <= 50_000_000);
  if (nums.length === 0) return {};
  if (nums.length === 1) return { from: nums[0], to: nums[0] };
  return { from: Math.min(...nums), to: Math.max(...nums) };
}

/** Collect photo URLs (prefer the default-variant URI). */
function photoUrls(listing: Obj): string[] {
  const media = listing.media;
  const photos = isObj(media) ? media.photos : undefined;
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => (isObj(p) ? str(p.webDefaultURI) ?? str(p.webHeroURI) : undefined))
    .filter((u): u is string => Boolean(u));
}

/** Collect feature tags from the several places Homely stores them. */
function featureList(listing: Obj): string[] {
  const f = isObj(listing.features) ? listing.features : {};
  const out: string[] = [];
  for (const key of ['tags', 'extraFeatures']) {
    const arr = (f as Obj)[key];
    if (Array.isArray(arr)) out.push(...arr.filter((x): x is string => typeof x === 'string' && x.trim() !== ''));
  }
  const other = str((f as Obj).otherFeatures);
  if (other) out.push(...other.split(/[,;]+/).map((s) => s.trim()).filter(Boolean));
  return [...new Set(out)];
}

/** Build a saleHistory entry from soldDetails when the listing is sold. */
function soldEntry(listing: Obj, priceFrom: number | undefined): Obj | null {
  const sale = isObj(listing.saleDetails) ? listing.saleDetails : undefined;
  const soldOn = sale && isObj(sale.soldDetails) ? isoDay((sale.soldDetails as Obj).soldOn) : undefined;
  if (!soldOn) return null;
  const entry: Obj = { date: soldOn, type: 'Sold' };
  const price = num(sale?.loanPrice) ?? priceFrom;
  if (price !== undefined) entry.price = price;
  return entry;
}

function pushLine(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  lines.push(`**${label}:** ${value}`);
}

export function homelyProfileHtmlToMarkdown(html: string): string | null {
  const nextData = parseNextData(html);
  if (!nextData) return null;
  const listing = findListingNode(nextData);
  if (!listing) return null; // shell / 404

  const lines: string[] = [];
  const address = isObj(listing.address) ? listing.address : {};
  const features = isObj(listing.features) ? listing.features : {};

  pushLine(lines, 'Address', str(address.longAddress) ?? str(address.shortAddress));
  pushLine(lines, 'Property Type', str(listing.propertyTypeDescription) ?? str(listing.propertyType));
  pushLine(lines, 'Bedrooms', num(features.bedrooms));
  pushLine(lines, 'Bathrooms', num(features.bathrooms));
  pushLine(lines, 'Car Spaces', num(features.cars));

  const landArea = isObj(listing.landFeatures) ? num((listing.landFeatures as Obj).areaSqm) : undefined;
  if (landArea) pushLine(lines, 'Land Area', `${landArea} sqm`);

  const priceText = isObj(listing.priceDetails)
    ? str((listing.priceDetails as Obj).longDescription) ?? str((listing.priceDetails as Obj).shortDescription)
    : undefined;
  pushLine(lines, 'Price', priceText);
  pushLine(lines, 'Status', str(listing.statusType));

  const feats = featureList(listing);
  if (feats.length > 0) pushLine(lines, 'Features', feats.join(', '));

  const photos = photoUrls(listing).slice(0, 8);
  if (photos.length > 0) lines.push(`**Photos:**\n${photos.map((u) => `- ${u}`).join('\n')}`);

  const sold = soldEntry(listing, undefined);
  if (sold) lines.push(`**Property History:**\n- ${[sold.date, 'Sold', sold.price ? `$${sold.price}` : undefined].filter(Boolean).join(' — ')}`);

  const desc = str(listing.description);
  if (desc) pushLine(lines, 'Description', desc.slice(0, 1000));

  // Need the structured subject at minimum — an address-only page is useless.
  return lines.length >= 3 ? lines.join('\n') : null;
}

/**
 * Deterministic extraction for the same page — field names match the merger's
 * SCALAR_FIELDS / array contracts (landArea, photos, saleHistory, …). Returns
 * null on a shell/404 page or when no subject attributes are present.
 */
export function homelyProfileHtmlToExtraction(html: string): ExtractedPropertyData | null {
  const nextData = parseNextData(html);
  if (!nextData) return null;
  const listing = findListingNode(nextData);
  if (!listing) return null;

  const raw: Obj = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') raw[k] = v;
  };

  const address = isObj(listing.address) ? listing.address : {};
  if (Object.keys(address).length > 0) {
    const { streetName, streetType } = splitStreet(str(address.street));
    raw.address = {
      fullAddress: str(address.longAddress) ?? str(address.shortAddress),
      unit: str(address.subNumber),
      streetNumber: str(address.streetNumber),
      streetName,
      streetType,
      suburb: str(address.suburb),
      state: str(address.stateCode) ?? str(address.state),
      postcode: str(address.postcode),
    };
    set('latitude', num(address.latitude));
    set('longitude', num(address.longitude));
  }

  const features = isObj(listing.features) ? listing.features : {};
  set('propertyType', str(listing.propertyType) ?? str(listing.propertyTypeDescription)?.toLowerCase());
  set('bedrooms', num(features.bedrooms));
  set('bathrooms', num(features.bathrooms));
  set('carSpaces', num(features.cars));
  set('landArea', isObj(listing.landFeatures) ? num((listing.landFeatures as Obj).areaSqm) : undefined);

  const feats = featureList(listing);
  if (feats.length > 0) set('features', feats);

  const priceText = isObj(listing.priceDetails)
    ? str((listing.priceDetails as Obj).longDescription) ?? str((listing.priceDetails as Obj).shortDescription)
    : undefined;
  if (priceText) {
    set('priceLabel', priceText);
    const { from, to } = parsePriceRange(priceText);
    set('priceFrom', from);
    set('priceTo', to);
  }

  set('listingStatus', str(listing.statusType));
  set('headline', str(listing.title));
  set('description', str(listing.description));

  const office = isObj(listing.office) ? listing.office : undefined;
  set('agencyName', office ? str(office.fullName) : undefined);
  const agents = Array.isArray(listing.agents) ? listing.agents : [];
  const agent0 = agents.find(isObj);
  if (agent0) {
    set('agentName', str(agent0.name));
    set('agentPhone', str(agent0.mobile) ?? str(agent0.phone) ?? (office ? str(office.phone) : undefined));
  }

  const photos = photoUrls(listing);
  if (photos.length > 0) set('photos', photos);

  const sold = soldEntry(listing, num(raw.priceFrom));
  if (sold) set('saleHistory', [sold]);

  // Subject attributes are the point — an address-only page is not useful.
  const hasSubject = ['bedrooms', 'bathrooms', 'landArea', 'propertyType'].some((k) => raw[k] !== undefined);
  if (!hasSubject) return null;

  return { source: 'homely.com.au', raw, extractedAt: new Date() };
}
