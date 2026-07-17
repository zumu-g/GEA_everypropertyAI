import { NextRequest, NextResponse } from 'next/server';
import {
  getListingsForSuburb,
  getRowsNearby,
  haversineKm,
  type PropertyListingRecord,
} from '@/lib/db/queries';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Upper sanity bound on a plausible asking price. Drops upstream price anomalies
// while keeping price-less ("Contact Agent") listings, which are legitimate.
const MAX_PLAUSIBLE_PRICE = 50_000_000;

// Rows dedup on (raw_address, source) in the DB, so the same property can appear
// once per feed (Domain, REA Apify, Homely). Collapse to one row per address here,
// keeping whichever source has seen it most recently.
function dedupeByAddress(rows: PropertyListingRecord[]): PropertyListingRecord[] {
  const byAddress = new Map<string, PropertyListingRecord>();
  for (const r of rows) {
    const key = r.raw_address.trim().toLowerCase();
    const existing = byAddress.get(key);
    if (!existing) {
      byAddress.set(key, r);
      continue;
    }
    const existingSeen = existing.last_seen_at ? new Date(existing.last_seen_at).getTime() : 0;
    const candidateSeen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
    if (candidateSeen > existingSeen) byAddress.set(key, r);
  }
  return Array.from(byAddress.values());
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface OnMarketListingResult {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  displayPrice: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  status: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landAreaSqm: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  agencyName: string | null;
  agentName: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  source: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  listedDate: string | null;
}

/**
 * GET /api/on-market-listings
 *
 * Current on-market (for-sale) listings around a location, backed by the
 * `property_listings` table (Domain Apify /sale/ feed). Mirrors /api/sold-sales:
 * query by suburb OR by lat/lng+radius.
 *
 * Query params (suburb OR lat/lng required):
 *   suburb  — suburb mode
 *   state   — optional (defaults to "VIC")
 *   lat,lng — radius mode: centre point
 *   radius  — radius mode: km (default 2)
 *   sinceDays — optional: only listings first seen within the last N days ("just listed")
 *   limit   — optional, max rows (default 200, capped at 1000)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined;
  const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined;
  const radius = searchParams.get('radius') ? Number(searchParams.get('radius')) : 2;
  // Ignore non-finite / negative sinceDays rather than silently distorting the window.
  const sinceDaysRaw = searchParams.get('sinceDays') !== null ? Number(searchParams.get('sinceDays')) : undefined;
  const sinceDays = sinceDaysRaw !== undefined && Number.isFinite(sinceDaysRaw) && sinceDaysRaw >= 0 ? sinceDaysRaw : undefined;
  const limit = Math.min(searchParams.get('limit') ? Number(searchParams.get('limit')) : 200, 1000);

  // "Just listed" window: keep only rows listed within sinceDays. Prefer the real
  // listed_date, falling back to created_at (first-seen) for rows predating it.
  const sinceMs = sinceDays && sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : null;
  const withinWindow = (r: PropertyListingRecord) => {
    if (sinceMs === null) return true;
    const stamp = r.listed_date ?? r.created_at;
    if (!stamp) return false;
    const t = new Date(stamp).getTime();
    return Number.isFinite(t) && t >= sinceMs;
  };

  const hasGeo = lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  if (!suburb && !hasGeo) {
    return NextResponse.json(
      { error: 'suburb, or lat & lng, query params are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    let rows: PropertyListingRecord[];
    if (hasGeo) {
      const box = await getRowsNearby<PropertyListingRecord>('property_listings', lat!, lng!, radius);
      rows = box
        .filter((r) => r.active !== false)
        .filter(withinWindow)
        .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number'
          && haversineKm(lat!, lng!, r.latitude, r.longitude) <= radius)
        // Sort by distance BEFORE limiting — otherwise arbitrary DB order
        // decides which listings survive the cut in dense areas.
        .sort((a, b) =>
          haversineKm(lat!, lng!, a.latitude as number, a.longitude as number) -
          haversineKm(lat!, lng!, b.latitude as number, b.longitude as number));
    } else {
      // Suburb mode pushes the sinceDays window into the DB query (before the limit).
      rows = await getListingsForSuburb(suburb, state, limit, { sinceDays });
    }

    const results: OnMarketListingResult[] = dedupeByAddress(rows)
      // Lighter touch than sold-sales: only drop garbage price outliers; keep
      // price-less listings ("Contact Agent") since those are legitimate.
      .filter((r) => !(typeof r.price_low === 'number' && r.price_low > MAX_PLAUSIBLE_PRICE))
      // Limit last — after distance sort, dedupe and price sanity — so the N
      // closest distinct listings are returned, not the first N DB rows.
      .slice(0, limit)
      .map((r) => ({
      rawAddress: r.raw_address,
      suburb: r.suburb ?? null,
      postcode: r.postcode ?? null,
      displayPrice: r.display_price ?? null,
      priceLow: r.price_low ?? null,
      priceHigh: r.price_high ?? null,
      status: r.status ?? null,
      bedrooms: r.bedrooms ?? null,
      bathrooms: r.bathrooms ?? null,
      carSpaces: r.car_spaces ?? null,
      landAreaSqm: r.land_area_sqm ?? null,
      propertyType: r.property_type ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      agencyName: r.agency_name ?? null,
      agentName: r.agent_name ?? null,
      listingUrl: r.listing_url ?? null,
      imageUrl: r.image_url ?? null,
      source: r.source,
      createdAt: r.created_at ?? null,
      lastSeenAt: r.last_seen_at ?? null,
      listedDate: r.listed_date ?? null,
    }));

    return NextResponse.json(
      { suburb: suburb || null, state, count: results.length, results },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[on-market-listings] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch on-market listings' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
