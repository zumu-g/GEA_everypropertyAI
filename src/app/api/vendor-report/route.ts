import { NextRequest, NextResponse } from 'next/server';
import {
  getRowsNearby,
  haversineKm,
  type PropertySaleRecord,
  type PropertyListingRecord,
} from '@/lib/db/queries';
import { geocodeAddress } from '@/lib/enrichment/geocoding';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const DEFAULT_RADIUS_KM = 0.5; // 500m
const MAX_RADIUS_KM = 2;
const TAKE = 3;

interface NearbySold {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  salePrice: number | null;
  saleDate: string | null;
  landAreaSqm: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  agencyName: string | null;
  agentName: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  distanceMetres: number;
}

interface NearbyListing {
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
  distanceMetres: number;
}

// getRowsNearby selects '*', so the DB row carries created_at even though the
// typed record doesn't surface it.
type ListingRow = PropertyListingRecord & { created_at?: string };

const hasCoords = <T extends { latitude?: number; longitude?: number }>(
  r: T
): r is T & { latitude: number; longitude: number } =>
  typeof r.latitude === 'number' && typeof r.longitude === 'number';

/**
 * GET /api/vendor-report
 *
 * Proximity feed for the weekly vendor campaign report (consumer:
 * GEA_reports_weeklycampaign_vendor). Returns the 3 CLOSEST sold sales and the 3
 * NEWEST on-market listings within a radius (default 500m) of a subject location.
 * Empty arrays when nothing is nearby — the consumer renders nothing.
 *
 * Query params (lat+lng OR address required):
 *   lat,lng        — centre point (preferred)
 *   address        — free-text address, geocoded to lat/lng if lat/lng absent
 *   radius         — optional, km (default 0.5, capped at 2)
 *   excludeAddress — optional, drops the subject's own row (case-insensitive match)
 *
 * Auth: middleware-gated (Authorization: Bearer <epai_ key>).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let lat = searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined;
  let lng = searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined;
  const address = searchParams.get('address')?.trim();
  const radius = Math.min(
    searchParams.get('radius') ? Number(searchParams.get('radius')) : DEFAULT_RADIUS_KM,
    MAX_RADIUS_KM
  );
  const exclude = searchParams.get('excludeAddress')?.trim().toLowerCase() || null;

  // Resolve centre point: explicit lat/lng, else geocode the address.
  const hasGeo = lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasGeo) {
    if (!address) {
      return NextResponse.json(
        { error: 'lat & lng, or address, query params are required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const geo = await geocodeAddress(address);
    if (!geo) {
      return NextResponse.json(
        { error: `Could not geocode address: ${address}` },
        { status: 422, headers: CORS_HEADERS }
      );
    }
    lat = geo.lat;
    lng = geo.lng;
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    return NextResponse.json(
      { error: 'radius must be a positive number (km)' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const cLat = lat!;
  const cLng = lng!;
  const notExcluded = (raw: string) => !exclude || raw.trim().toLowerCase() !== exclude;

  try {
    const [saleBox, listingBox] = await Promise.all([
      getRowsNearby<PropertySaleRecord>('property_sales', cLat, cLng, radius),
      getRowsNearby<ListingRow>('property_listings', cLat, cLng, radius),
    ]);

    // Solds: within radius, with a price → 3 closest (tiebreak: most recent sale).
    const solds: NearbySold[] = saleBox
      .filter(hasCoords)
      .map((s) => ({ s, d: haversineKm(cLat, cLng, s.latitude, s.longitude) }))
      .filter(({ s, d }) => d <= radius && typeof s.sale_price === 'number' && notExcluded(s.raw_address))
      .sort((a, b) => a.d - b.d || (b.s.sale_date ?? '').localeCompare(a.s.sale_date ?? ''))
      .slice(0, TAKE)
      .map(({ s, d }) => ({
        rawAddress: s.raw_address,
        suburb: s.suburb ?? null,
        postcode: s.postcode ?? null,
        salePrice: s.sale_price ?? null,
        saleDate: s.sale_date ?? null,
        landAreaSqm: s.land_area_sqm ?? null,
        propertyType: s.property_type ?? null,
        latitude: s.latitude ?? null,
        longitude: s.longitude ?? null,
        agencyName: s.agency_name ?? null,
        agentName: s.agent_name ?? null,
        listingUrl: s.listing_url ?? null,
        imageUrl: s.image_url ?? null,
        distanceMetres: Math.round(d * 1000),
      }));

    // Listings: active, within radius → 3 newest (by first-seen created_at).
    const listings: NearbyListing[] = listingBox
      .filter((r) => r.active !== false)
      .filter(hasCoords)
      .map((r) => ({ r: r as ListingRow & { latitude: number; longitude: number }, d: haversineKm(cLat, cLng, r.latitude, r.longitude) }))
      .filter(({ r, d }) => d <= radius && notExcluded(r.raw_address))
      .sort((a, b) => (b.r.created_at ?? '').localeCompare(a.r.created_at ?? '') || a.d - b.d)
      .slice(0, TAKE)
      .map(({ r, d }) => ({
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
        distanceMetres: Math.round(d * 1000),
      }));

    return NextResponse.json(
      { lat: cLat, lng: cLng, radiusMetres: Math.round(radius * 1000), solds, listings },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[vendor-report] error:', err);
    return NextResponse.json(
      { error: 'Failed to build vendor report' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
