import type { ExtractedPropertyData } from '@/types/property';
import { parseAddress } from '@/lib/utils/address';

/**
 * allhomes.com.au (Domain-owned) — off-market property pages served fully
 * server-rendered with the property record embedded as JSON in
 * `window['__domain_group/APP_PROPS']`. No bot wall, no JS render needed, so
 * a plain direct fetch works. Parsed deterministically — no LLM pass.
 */

interface AllhomesProperty {
  address?: {
    formattedFull?: string;
    coordinates?: { lat?: number; lng?: number };
    priceEstimate?: { medium?: number };
    rentalEstimate?: { weeklyRentEstimate?: number };
  };
  features?: {
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: { total?: number };
    parking?: { total?: number };
    // Building size — Allhomes exposes all three keys; usually null, sometimes
    // populated. Values observed as plain numbers (sqm).
    floorArea?: number | null;
    buildingSize?: number | null;
    buildingArea?: number | null;
  };
  derived?: { keyDetails?: Array<{ label?: string; value?: string; type?: string }> };
  listing?: { media?: MediaBlock } | null;
  history?: HistoryEntry[];
  rentalHistory?: HistoryEntry[];
}

interface MediaBlock {
  items?: Array<{ type?: string; imageSrc?: string; order?: number }>;
}

interface HistoryEntry {
  date?: string;
  listing?: { price?: string; daysOnMarket?: number | null; media?: MediaBlock } | null;
}

/** Extract the APP_PROPS JSON blob from the page HTML, or null. */
function parseAppProps(html: string): AllhomesProperty | null {
  const startMarker = "window['__domain_group/APP_PROPS'] = ";
  const start = html.indexOf(startMarker);
  if (start === -1) return null;
  const from = start + startMarker.length;
  const end = html.indexOf("window['__domain_group/APP_PAGE']", from);
  if (end === -1) return null;
  // Trim back past the trailing `;` between the two assignments.
  const jsonText = html.slice(from, end).trim().replace(/;$/, '');
  try {
    const props = JSON.parse(jsonText) as { body?: { property?: AllhomesProperty } };
    return props.body?.property ?? null;
  } catch {
    return null;
  }
}

function photosOf(media: MediaBlock | undefined | null): string[] {
  return (media?.items ?? [])
    .filter((m) => m?.type === 'PHOTO' && typeof m.imageSrc === 'string')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((m) => m.imageSrc as string);
}

/** All photos on the page: current listing first, then most recent history. */
function collectPhotos(p: AllhomesProperty): string[] {
  const groups = [
    photosOf(p.listing?.media),
    ...(p.history ?? []).map((h) => photosOf(h.listing?.media)),
    ...(p.rentalHistory ?? []).map((h) => photosOf(h.listing?.media)),
  ];
  return [...new Set(groups.flat())].slice(0, 12);
}

/** "$725,000" / "$360 per week" → 725000 / 360 */
function priceNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : undefined;
}

function keyDetail(p: AllhomesProperty, label: string): string | undefined {
  return p.derived?.keyDetails?.find((k) => k.label === label)?.value ?? undefined;
}

export function allhomesProfileHtmlToExtraction(html: string): ExtractedPropertyData | null {
  const p = parseAppProps(html);
  if (!p) return null;

  const raw: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') raw[key] = value;
  };

  const full = p.address?.formattedFull;
  if (full) {
    const parsed = parseAddress(full);
    raw.address = { fullAddress: full, ...parsed };
  }
  set('latitude', p.address?.coordinates?.lat);
  set('longitude', p.address?.coordinates?.lng);

  set('propertyType', p.features?.propertyType?.toLowerCase());
  set('bedrooms', p.features?.bedrooms);
  set('bathrooms', p.features?.bathrooms?.total);
  set('carSpaces', p.features?.parking?.total);

  const blockSize = Number(keyDetail(p, 'Block Size'));
  if (Number.isFinite(blockSize) && blockSize > 0) set('landArea', blockSize);
  const buildingSqm = Number(p.features?.floorArea ?? p.features?.buildingSize ?? p.features?.buildingArea);
  if (Number.isFinite(buildingSqm) && buildingSqm > 0) set('buildingArea', buildingSqm);
  const lot = keyDetail(p, 'Lot');
  const plan = keyDetail(p, 'Plan');
  if (lot && plan) set('lotPlan', `${lot}/${plan}`);

  set('estimatedValue', p.address?.priceEstimate?.medium);
  set('estimatedRent', p.address?.rentalEstimate?.weeklyRentEstimate);

  const photos = collectPhotos(p);
  if (photos.length > 0) set('photos', photos);

  const sales = (p.history ?? [])
    .map((h) => ({
      date: h.date?.slice(0, 10),
      price: priceNumber(h.listing?.price),
      ...(h.listing?.daysOnMarket != null ? { daysOnMarket: h.listing.daysOnMarket } : {}),
    }))
    .filter((s) => s.date);
  if (sales.length > 0) set('saleHistory', sales);

  const rentals = (p.rentalHistory ?? [])
    .map((h) => ({
      date: h.date?.slice(0, 10),
      weeklyRent: priceNumber(h.listing?.price),
      ...(h.listing?.daysOnMarket != null ? { daysOnMarket: h.listing.daysOnMarket } : {}),
    }))
    .filter((r) => r.date);
  if (rentals.length > 0) set('rentalHistory', rentals);

  // A page with an address but no attribute/photo/history data is a shell.
  if (Object.keys(raw).filter((k) => !['address', 'latitude', 'longitude'].includes(k)).length === 0) {
    return null;
  }

  return { source: 'allhomes.com.au', raw, extractedAt: new Date() };
}

/** Human-readable summary — the CrawlResult markdown for cache/debug views. */
export function allhomesProfileHtmlToMarkdown(html: string): string | null {
  const ext = allhomesProfileHtmlToExtraction(html);
  if (!ext) return null;
  const r = ext.raw as Record<string, unknown>;
  const addr = (r.address as { fullAddress?: string } | undefined)?.fullAddress;
  const lines = [
    `# ${addr ?? 'Property'} — allhomes.com.au`,
    '',
    ...Object.entries(r)
      .filter(([k]) => !['address', 'photos'].includes(k))
      .map(([k, v]) => `- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`),
  ];
  const photos = r.photos as string[] | undefined;
  if (photos?.length) lines.push('', '**Photos:**', ...photos.map((u) => `- ${u}`));
  return lines.join('\n');
}
