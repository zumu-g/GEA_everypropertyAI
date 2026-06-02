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
  source: string;
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
 *   limit   — optional, max rows (default 200, capped at 1000)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined;
  const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined;
  const radius = searchParams.get('radius') ? Number(searchParams.get('radius')) : 2;
  const limit = Math.min(searchParams.get('limit') ? Number(searchParams.get('limit')) : 200, 1000);

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
        .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number'
          && haversineKm(lat!, lng!, r.latitude, r.longitude) <= radius)
        .slice(0, limit);
    } else {
      rows = await getListingsForSuburb(suburb, state, limit);
    }

    const results: OnMarketListingResult[] = rows.map((r) => ({
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
      source: r.source,
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
