/**
 * Pure mappers for Domain.com.au Apify items → Supabase rows.
 *
 * Shared by the manual loader (scripts/ingest-domain-apify.mjs mirrors this) and
 * the webhook ingest endpoint (src/app/api/ingest/domain/route.ts), so the parse
 * rules live in one place. No DB / network here — pure functions only.
 */

import { parseAddress, toSlug, titleCaseSuburb } from '@/lib/utils/address';
import type {
  PropertySaleRecord,
  PropertyListingRecord,
  PropertyRentalRecord,
} from '@/lib/db/queries';

export type IngestCategory = 'sold' | 'on-market' | 'rent';
export const SOURCE = 'domain-apify';

/** Map a category → its target table + dedup conflict key. */
export const CATEGORY_TABLE: Record<IngestCategory, { table: string; conflict: string }> = {
  sold: { table: 'property_sales', conflict: 'raw_address,sale_date,sale_price,source' },
  'on-market': { table: 'property_listings', conflict: 'raw_address,source' },
  rent: { table: 'property_rentals', conflict: 'raw_address,source' },
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "Sold by private treaty 07 Oct 2020" → "2020-10-07" (or null). */
export function parseSaleDate(tagText: unknown): string | null {
  if (!tagText) return null;
  const m = String(tagText).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

/** "$245,000" → 245000 (or null). */
export function parsePrice(display: unknown): number | null {
  if (!display) return null;
  const digits = String(display).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Every "$1,234,000" amount in a string → numbers. */
function dollarAmounts(display: unknown): number[] {
  if (!display) return [];
  const out: number[] = [];
  for (const m of String(display).matchAll(/\$\s?([\d,]+)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** "$930,000 - $970,000" → {low,high}; single → low=high; none → nulls. */
export function parsePriceRange(display: unknown): { low: number | null; high: number | null } {
  const amts = dollarAmounts(display);
  if (amts.length === 0) return { low: null, high: null };
  return { low: Math.min(...amts), high: Math.max(...amts) };
}

/** "$550 per week" / "$520 - $560 pw" → 550 / 520 (low amount), or null. */
export function parseWeeklyRent(display: unknown): number | null {
  const amts = dollarAmounts(display);
  return amts.length ? Math.min(...amts) : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function smallint(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Address slug for a raw display address (links to the `addresses` table). */
export function slugForRawAddress(raw: string): string | null {
  try {
    const slug = toSlug(parseAddress(raw));
    return slug || null;
  } catch {
    return null;
  }
}

type DomainItem = {
  location?: { display_address?: string; suburb?: string; state?: string; postcode?: string; latitude?: number; longitude?: number };
  pricing?: { display_price?: string };
  listing?: { tags?: { tag_text?: string } };
  property?: { property_type?: string; land_size?: number; bedrooms?: number; bathrooms?: number; parking?: number };
  contacts?: { agency?: { name?: string }; agent_names?: string; agents?: Array<{ name?: string }> };
};

/** Listing/selling agent name(s) from the Domain `contacts` block, or undefined. */
function agentNameOf(it: DomainItem): string | undefined {
  const c = it.contacts;
  if (!c) return undefined;
  if (typeof c.agent_names === 'string' && c.agent_names.trim()) return c.agent_names.trim();
  const names = (c.agents ?? []).map((a) => a?.name?.trim()).filter(Boolean);
  return names.length ? names.join(', ') : undefined;
}

/** Map one Apify item → a row for the given category, or null to skip. */
export function mapItem(category: IngestCategory, it: DomainItem):
  | PropertySaleRecord
  | PropertyListingRecord
  | PropertyRentalRecord
  | null {
  const loc = it.location ?? {};
  const prop = it.property ?? {};
  const rawAddress = (loc.display_address ?? '').trim();
  if (!rawAddress) return null;

  const common = {
    raw_address: rawAddress,
    address_slug: slugForRawAddress(rawAddress) ?? undefined,
    suburb: titleCaseSuburb(loc.suburb) ?? undefined,
    state: (loc.state ?? 'VIC').toUpperCase(),
    postcode: loc.postcode ?? undefined,
    land_area_sqm: num(prop.land_size) ?? undefined,
    property_type: prop.property_type ?? undefined,
    latitude: num(loc.latitude) ?? undefined,
    longitude: num(loc.longitude) ?? undefined,
    agency_name: it.contacts?.agency?.name?.trim() || undefined,
    agent_name: agentNameOf(it),
    source: SOURCE,
  };

  if (category === 'sold') {
    const salePrice = parsePrice(it.pricing?.display_price);
    if (salePrice == null) return null; // sold needs a price
    return {
      ...common,
      sale_price: salePrice,
      sale_date: parseSaleDate(it.listing?.tags?.tag_text) ?? undefined,
    } as PropertySaleRecord;
  }

  const beds = smallint(prop.bedrooms) ?? undefined;
  const baths = smallint(prop.bathrooms) ?? undefined;
  const cars = smallint(prop.parking) ?? undefined;
  const display = it.pricing?.display_price ?? undefined;
  const status = it.listing?.tags?.tag_text ?? undefined;

  if (category === 'on-market') {
    const { low, high } = parsePriceRange(display);
    return {
      ...common,
      display_price: display,
      price_low: low ?? undefined,
      price_high: high ?? undefined,
      status,
      bedrooms: beds,
      bathrooms: baths,
      car_spaces: cars,
    } as PropertyListingRecord;
  }

  // rent
  return {
    ...common,
    display_price: display,
    weekly_rent: parseWeeklyRent(display) ?? undefined,
    status,
    bedrooms: beds,
    bathrooms: baths,
    car_spaces: cars,
  } as PropertyRentalRecord;
}
