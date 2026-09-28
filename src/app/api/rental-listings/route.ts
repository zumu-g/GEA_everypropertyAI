import { NextRequest, NextResponse } from 'next/server';
import {
  getRentalsForSuburb,
  getRowsNearby,
  haversineKm,
  type PropertyRentalRecord,
} from '@/lib/db/queries';
import { getRentalsForSuburbAll } from '@/lib/db/listings-inactive';
import { getPriceHistoryFor, priceHistoryKey, type PriceHistoryEntry } from '@/lib/db/price-history';
import { daysOnMarket, type DaysOnMarketBasis, type LifecycleColumns } from '@/lib/listings/days-on-market';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface RentalListingResult {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  displayPrice: string | null;
  weeklyRent: number | null;
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
  listedDate: string | null;
  // Lifecycle (migration 015; R6, R9, R12, R22). Additive only.
  lifecycleStatus: string | null;
  removedAt: string | null;
  leasedAt: string | null;
  daysOnMarket: number | null;
  daysOnMarketBasis: DaysOnMarketBasis;
  priceHistory: PriceHistoryEntry[];
}

// Migration-015 columns; typed here until PropertyRentalRecord carries them.
type RentalRow = PropertyRentalRecord & LifecycleColumns & { lifecycle_status?: string | null };

/**
 * GET /api/rental-listings
 *
 * Current on-market rental listings around a location, backed by the
 * `property_rentals` table (Domain Apify /rent/ feed). Mirrors
 * /api/on-market-listings: query by suburb OR by lat/lng+radius.
 * Returns an empty result set until the /rent/ scrape has been ingested.
 *
 * Query params (suburb OR lat/lng required):
 *   suburb  — suburb mode
 *   state   — optional (defaults to "VIC")
 *   lat,lng — radius mode: centre point
 *   radius  — radius mode: km (default 2)
 *   limit   — optional, max rows (default 200, capped at 1000)
 *   includeInactive — optional ('true' | '1'): also return closed/leased rows (active=false)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined;
  const lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined;
  const radius = searchParams.get('radius') ? Number(searchParams.get('radius')) : 2;
  // Sanitise numeric filters: ignore non-finite / out-of-range values rather than
  // letting NaN (always-false comparisons) or a negative window silently distort results.
  const posNum = (v: string | null): number | undefined => {
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const sinceDays = posNum(searchParams.get('sinceDays'));
  const minRent = posNum(searchParams.get('minRent'));
  const maxRent = posNum(searchParams.get('maxRent'));
  const limit = Math.min(searchParams.get('limit') ? Number(searchParams.get('limit')) : 200, 1000);
  const includeInactive = ['true', '1'].includes(searchParams.get('includeInactive') ?? '');

  // Predicates for geo mode (suburb mode pushes these into the DB query).
  const sinceMs = sinceDays && sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : null;
  const matchesFilters = (r: PropertyRentalRecord) => {
    if (typeof minRent === 'number' && !(typeof r.weekly_rent === 'number' && r.weekly_rent >= minRent)) return false;
    if (typeof maxRent === 'number' && !(typeof r.weekly_rent === 'number' && r.weekly_rent <= maxRent)) return false;
    if (sinceMs !== null) {
      const stamp = r.listed_date ?? r.created_at;
      if (!stamp) return false;
      const t = new Date(stamp).getTime();
      if (!Number.isFinite(t) || t < sinceMs) return false;
    }
    return true;
  };

  const hasGeo = lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  if (!suburb && !hasGeo) {
    return NextResponse.json(
      { error: 'suburb, or lat & lng, query params are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    let rows: PropertyRentalRecord[];
    if (hasGeo) {
      const box = await getRowsNearby<PropertyRentalRecord>('property_rentals', lat!, lng!, radius);
      rows = box
        .filter((r) => includeInactive || r.active !== false)
        .filter(matchesFilters)
        .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number'
          && haversineKm(lat!, lng!, r.latitude, r.longitude) <= radius)
        .slice(0, limit);
    } else if (includeInactive) {
      rows = (await getRentalsForSuburbAll(suburb, state, limit)).filter(matchesFilters);
    } else {
      rows = await getRentalsForSuburb(suburb, state, limit, { sinceDays, minRent, maxRent });
    }

    const history = await getPriceHistoryFor('rentals', rows);
    const now = new Date();
    const results: RentalListingResult[] = (rows as RentalRow[]).map((r) => ({
      rawAddress: r.raw_address,
      suburb: r.suburb ?? null,
      postcode: r.postcode ?? null,
      displayPrice: r.display_price ?? null,
      weeklyRent: r.weekly_rent ?? null,
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
      listedDate: r.listed_date ?? null,
      lifecycleStatus: r.lifecycle_status ?? null,
      removedAt: r.removed_at ?? null,
      leasedAt: r.leased_at ?? null,
      ...daysOnMarket(r, now),
      priceHistory: history.get(priceHistoryKey(r)) ?? [],
    }));

    return NextResponse.json(
      { suburb: suburb || null, state, count: results.length, results },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[rental-listings] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch rental listings' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
