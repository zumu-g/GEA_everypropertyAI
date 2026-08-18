import { NextRequest, NextResponse } from 'next/server';
import { getEstimate, type EstimateSubjectInput } from '@/lib/estimation/estimate-service';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';

export const maxDuration = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cache only successful (200) responses — never error responses.
const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function num(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * GET /api/estimate — comparables-based valuation (CMA/AVM) for a subject property.
 *
 * Query params:
 *   suburb        (required)
 *   lat, lng      subject coordinates (enables radius search; falls back to suburb)
 *   state         default VIC
 *   postcode      used for suburb market-data lookup
 *   propertyType, beds, baths, land   subject attributes (used for similarity)
 *   priorSalePrice, priorSaleDate     subject's own last sale (cross-check)
 *   listingLow, listingHigh, listingMid   active listing guide (cross-check)
 *   excludeAddress                    raw address to exclude from comps
 */
export async function GET(request: NextRequest) {
  const { searchParams: p } = request.nextUrl;

  const suburb = p.get('suburb') ?? '';
  if (!suburb) {
    return NextResponse.json(
      { result: null, reason: 'suburb query param is required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const priorSalePrice = num(p.get('priorSalePrice'));
  const priorSaleDate = p.get('priorSaleDate') ?? undefined;
  const listingLow = num(p.get('listingLow'));
  const listingHigh = num(p.get('listingHigh'));
  const listingMid = num(p.get('listingMid'));

  const subject: EstimateSubjectInput = {
    latitude: num(p.get('lat')) ?? null,
    longitude: num(p.get('lng')) ?? null,
    suburb,
    state: (p.get('state') ?? 'VIC').toUpperCase(),
    postcode: p.get('postcode') ?? undefined,
    propertyType: p.get('propertyType') ?? undefined,
    bedrooms: num(p.get('beds')),
    bathrooms: num(p.get('baths')),
    carSpaces: num(p.get('cars')),
    landAreaSqm: num(p.get('land')),
    buildingAreaSqm: num(p.get('build')),
    priorSale:
      priorSalePrice && priorSaleDate ? { price: priorSalePrice, date: priorSaleDate } : undefined,
    activeListing:
      listingLow || listingHigh || listingMid
        ? { priceLow: listingLow, priceHigh: listingHigh, priceMid: listingMid }
        : undefined,
    excludeAddress: p.get('excludeAddress') ?? undefined,
    // Repeated extEst=<source>:<value> params — scraped AVM cross-checks.
    externalEstimates: p
      .getAll('extEst')
      .map((s) => {
        const i = s.lastIndexOf(':');
        return { source: s.slice(0, i), value: Number(s.slice(i + 1)) };
      })
      .filter((e) => e.source && Number.isFinite(e.value) && e.value > 0),
  };

  try {
    const result = await getEstimate(subject);
    if (!result) {
      return NextResponse.json(
        { result: null, reason: 'insufficient data to estimate' },
        { status: 200, headers: OK_HEADERS },
      );
    }
    return NextResponse.json({ result }, { status: 200, headers: OK_HEADERS });
  } catch (err) {
    console.error('[estimate] error:', err);
    return NextResponse.json(
      { result: null, reason: 'internal error' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
