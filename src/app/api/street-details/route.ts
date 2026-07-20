import { NextRequest, NextResponse } from 'next/server';
import { fetchAddressSuggestions, type AddressSuggestion } from '@/lib/address-suggest';
import { getCachedProfilesBySlugs, getSalesForStreet, type PropertySaleRecord } from '@/lib/db/queries';
import { toSlug } from '@/lib/utils/address';
import type { StructuredAddress } from '@/types/property';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cache only genuine-success responses — never the 400, and never the
// outer catch's `fallback: true` response, which is a soft failure, not data.
const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** One row of the street comparison table. */
export interface StreetRow {
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  slug: string;
  propertyHref: string;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garage: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  lastListedDate: string | null;
  listedPrice: number | null;
}

/**
 * GET /api/street-details?q=Rose+Garden+Ave+Officer+VIC
 *
 * Returns every known address on a street enriched with detail columns pulled
 * ONLY from data already stored in Supabase (property_cache + property_sales /
 * Valuer-General). No crawling is triggered. Addresses with no stored data
 * return null fields (rendered as "—" by the client).
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json(
      { rows: [], error: 'Query must be at least 3 characters.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const all = await fetchAddressSuggestions(query);

    // Filter to addresses on the requested street (same logic as /api/street-search)
    const streetTokens = deriveStreetTokens(query.toLowerCase().split(/\s+/));
    const seen = new Set<string>();
    const suggestions = all
      .filter((s) => {
        const street = s.streetAddress.toLowerCase();
        return streetTokens.some((token) => street.includes(token));
      })
      .filter((s) => {
        if (seen.has(s.fullAddress)) return false;
        seen.add(s.fullAddress);
        return true;
      })
      .sort((a, b) => streetNumberOf(a) - streetNumberOf(b))
      .slice(0, 40);

    if (suggestions.length === 0) {
      return NextResponse.json(
        { rows: [], streetLabel: streetLabelOf(query), locationLabel: '' },
        { status: 200, headers: OK_HEADERS }
      );
    }

    // Build structured addresses + slugs
    const parsed = suggestions.map((s) => {
      const address = toStructuredAddress(s);
      return { suggestion: s, address, slug: toSlug(address) };
    });

    // Batch-fetch stored data (cache by slug, VG sales scoped to this street —
    // a suburb-wide newest-200 window starves busy suburbs of older street sales)
    const first = suggestions[0];
    const [cacheBySlug, vgSales] = await Promise.all([
      getCachedProfilesBySlugs(parsed.map((p) => p.slug)),
      getSalesForStreet(parsed[0].address.streetName, first.suburb, first.state, 3650),
    ]);

    const rows: StreetRow[] = parsed.map(({ suggestion, address, slug }) => {
      const profile = cacheBySlug.get(slug);
      const data = (profile?.data ?? {}) as Record<string, unknown>;

      // Cached sale history (newest first per merger convention)
      const saleHistory = Array.isArray(data.saleHistory)
        ? (data.saleHistory as Array<Record<string, unknown>>)
        : [];
      const cachedSale = saleHistory[0];
      const cachedSaleDate = asString(cachedSale?.date) ?? asString(cachedSale?.saleDate);
      const cachedSalePrice = asNumber(cachedSale?.price);

      // Matching Valuer-General record (by street number + name in raw_address)
      const vg = matchVgSale(vgSales, address);
      const vgSaleDate = vg?.sale_date ?? null;
      const vgSalePrice = vg?.sale_price ?? null;

      // Pick the most recent sale across cache + VG
      const sale = pickNewerSale(
        { date: cachedSaleDate, price: cachedSalePrice },
        { date: vgSaleDate, price: vgSalePrice ?? null }
      );

      const listing = (data.currentListing ?? {}) as Record<string, unknown>;
      const listingHistory = Array.isArray(data.listingHistory)
        ? (data.listingHistory as Array<Record<string, unknown>>)
        : [];

      return {
        streetAddress: suggestion.streetAddress,
        suburb: suggestion.suburb,
        state: suggestion.state,
        postcode: suggestion.postcode,
        slug,
        propertyHref: `/property?address=${encodeURIComponent(JSON.stringify(address))}`,
        // Cache profile wins; the matched sale record fills the blanks — the
        // sold feed carries beds/baths/cars/areas that property_cache mostly lacks.
        landAreaSqm:
          asNumber(data.landAreaSqm) ?? asNumber(data.landArea) ?? vg?.land_area_sqm ?? null,
        buildingAreaSqm:
          asNumber(data.buildingAreaSqm) ?? asNumber(data.buildingArea) ?? vg?.building_area_sqm ?? null,
        bedrooms: asNumber(data.bedrooms) ?? vg?.bedrooms ?? null,
        bathrooms: asNumber(data.bathrooms) ?? vg?.bathrooms ?? null,
        garage: asNumber(data.garages) ?? asNumber(data.carSpaces) ?? vg?.car_spaces ?? null,
        lastSaleDate: sale.date,
        lastSalePrice: sale.price,
        lastListedDate:
          asString(listing.dateFirstListed) ??
          asString(listingHistory[0]?.dateFirstListed) ??
          null,
        listedPrice:
          asNumber(data.currentPrice) ??
          asNumber(data.priceNumeric) ??
          asNumber(listing.price),
      };
    });

    const locationLabel = [first.suburb, first.state, first.postcode].filter(Boolean).join(', ');

    return NextResponse.json(
      { rows, streetLabel: streetLabelOf(query), locationLabel },
      { status: 200, headers: OK_HEADERS }
    );
  } catch (error) {
    console.error('[/api/street-details] Error:', error);
    return NextResponse.json(
      { rows: [], fallback: true },
      { status: 200, headers: CORS_HEADERS }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function streetNumberOf(s: AddressSuggestion): number {
  return parseInt(s.streetAddress.match(/^\d+/)?.[0] ?? '0', 10);
}

function streetLabelOf(query: string): string {
  return query.replace(/\s+(vic|nsw|qld|sa|wa|tas|nt|act)\s*\d{0,4}\s*$/i, '').trim();
}

function pickNewerSale(
  a: { date: string | null; price: number | null },
  b: { date: string | null; price: number | null }
): { date: string | null; price: number | null } {
  if (!a.date) return b;
  if (!b.date) return a;
  return new Date(a.date).getTime() >= new Date(b.date).getTime() ? a : b;
}

/** Parse a suggestion's streetAddress into a StructuredAddress. */
function toStructuredAddress(s: AddressSuggestion): StructuredAddress {
  const parts = s.streetAddress.match(
    /^(\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?)\s+(.+?)(?:\s+(St|Rd|Ave|Dr|Cres|Ct|Pl|Ln|Tce|Pde|Cct|Cl|Way|Gr|Blvd|Hwy|Esp|Prom|Circuit|Street|Road|Avenue|Drive|Crescent|Court|Place|Lane|Terrace|Parade|Close|Grove|Boulevard|Highway))?\s*$/i
  );
  return {
    streetNumber: parts?.[1] ?? '',
    streetName: parts?.[2] ?? s.streetAddress,
    streetType: parts?.[3] ?? '',
    suburb: s.suburb,
    state: s.state,
    postcode: s.postcode,
    displayAddress: s.fullAddress,
  };
}

/** Find the most recent VG sale whose raw_address matches the street number + name. */
function matchVgSale(
  sales: PropertySaleRecord[],
  address: StructuredAddress
): PropertySaleRecord | null {
  const num = address.streetNumber.toLowerCase();
  const name = address.streetName.toLowerCase();
  if (!num || !name) return null;

  // sales are already ordered newest-first by getSalesForSuburb
  for (const sale of sales) {
    const raw = (sale.raw_address ?? '').toLowerCase();
    if (!raw) continue;
    const startsWithNum = new RegExp(`(^|[^0-9])${escapeRegExp(num)}([^0-9]|$)`).test(raw);
    if (startsWithNum && raw.includes(name)) return sale;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract street-identifying tokens (mirrors /api/street-search).
 */
function deriveStreetTokens(tokens: string[]): string[] {
  const stateAbbrs = new Set(['vic', 'nsw', 'qld', 'sa', 'wa', 'tas', 'nt', 'act']);
  const streetTypeSuffixes = new Set([
    'st', 'rd', 'ave', 'dr', 'cres', 'ct', 'pl', 'ln', 'tce', 'pde',
    'cct', 'cl', 'way', 'gr', 'blvd', 'hwy', 'esp', 'prom', 'circuit',
    'street', 'road', 'avenue', 'drive', 'crescent', 'court', 'place',
    'lane', 'terrace', 'parade', 'close', 'grove', 'boulevard', 'highway',
  ]);

  const meaningful: string[] = [];
  for (const token of tokens) {
    if (/^\d{4}$/.test(token)) break;
    if (stateAbbrs.has(token)) break;
    if (streetTypeSuffixes.has(token)) {
      meaningful.push(token);
      break;
    }
    meaningful.push(token);
  }
  return meaningful.filter((t) => t.length >= 3);
}
