import { NextRequest, NextResponse } from 'next/server';
import { getSalesForSuburb, getRowsNearby, haversineKm, type PropertySaleRecord } from '@/lib/db/queries';
import { enrichSoldRowsFromDb } from '@/lib/sold/enrich';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Upper sanity bound on a plausible residential sale price. Drops upstream data
// anomalies (e.g. a bogus $140,000,000 row) before they reach any consumer.
// Remove/raise once the back-catalogue is re-scraped clean.
const MAX_PLAUSIBLE_SALE_PRICE = 50_000_000;

/**
 * OPTIONS /api/sold-sales — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/sold-sales
 *
 * Bulk sold-sales feed for downstream consumers (e.g. the CMA generator), backed
 * by the `property_sales` table (Valuer-General + ingested records). Unlike
 * /api/comparable-sales (single-property similarity, top 4, no price filter),
 * this returns the full result set for a suburb with optional price/date filters.
 *
 * Query params (suburb OR lat/lng+radius required):
 *   suburb    — suburb mode
 *   state     — optional (defaults to "VIC")
 *   lat,lng   — radius mode: centre point
 *   radius    — radius mode: km (default 2)
 *   minPrice  — optional, inclusive lower bound on sale_price
 *   maxPrice  — optional, inclusive upper bound on sale_price
 *   sinceDays — optional, how far back to look (default 730)
 *   limit     — optional, max rows (default 200, capped at 1000)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined;
  const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined;
  const radius = searchParams.get('radius') ? Number(searchParams.get('radius')) : 2;
  const minPrice = searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : undefined;
  const maxPrice = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined;
  const sinceDays = searchParams.get('sinceDays') ? Number(searchParams.get('sinceDays')) : 730;
  const limit = Math.min(searchParams.get('limit') ? Number(searchParams.get('limit')) : 200, 1000);

  const hasGeo = lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  if (!suburb && !hasGeo) {
    return NextResponse.json(
      { error: 'suburb, or lat & lng, query params are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    let sales: PropertySaleRecord[];
    if (hasGeo) {
      const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
      const box = await getRowsNearby<PropertySaleRecord>('property_sales', lat!, lng!, radius);
      sales = box
        .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number'
          && haversineKm(lat!, lng!, s.latitude, s.longitude) <= radius)
        .filter((s) => !s.sale_date || new Date(s.sale_date).getTime() >= sinceMs)
        .sort((a, b) => (b.sale_date ?? '').localeCompare(a.sale_date ?? ''))
        .slice(0, limit);
    } else {
      sales = await getSalesForSuburb(suburb, state, sinceDays, limit);
    }

    const filteredSales = sales.filter((s) => {
      if (typeof s.sale_price !== 'number') return false;
      // Drop non-positive prices and implausible outliers (data anomalies)
      if (s.sale_price <= 0 || s.sale_price > MAX_PLAUSIBLE_SALE_PRICE) return false;
      if (minPrice !== undefined && s.sale_price < minPrice) return false;
      if (maxPrice !== undefined && s.sale_price > maxPrice) return false;
      return true;
    });

    const results = await enrichSoldRowsFromDb(filteredSales);

    return NextResponse.json(
      { suburb: suburb || null, state, count: results.length, results },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[sold-sales] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch sold sales' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
