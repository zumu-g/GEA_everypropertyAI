import { NextRequest, NextResponse } from 'next/server';
import { getRentalEstimate, type RentalEstimateSubjectInput } from '@/lib/estimation/estimate-rental-service';

export const maxDuration = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function num(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * GET /api/estimate-rent — comparables-based weekly-rent range for a subject.
 *
 * Params: suburb (required); lat,lng; state; postcode; propertyType, beds,
 * baths, land; saleEstimateMid (for yield cross-check); priorRent, priorRentDate;
 * excludeAddress.
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

  const priorRent = num(p.get('priorRent'));
  const priorRentDate = p.get('priorRentDate') ?? undefined;

  const subject: RentalEstimateSubjectInput = {
    latitude: num(p.get('lat')) ?? null,
    longitude: num(p.get('lng')) ?? null,
    suburb,
    state: (p.get('state') ?? 'VIC').toUpperCase(),
    postcode: p.get('postcode') ?? undefined,
    propertyType: p.get('propertyType') ?? undefined,
    bedrooms: num(p.get('beds')),
    bathrooms: num(p.get('baths')),
    landAreaSqm: num(p.get('land')),
    saleEstimateMid: num(p.get('saleEstimateMid')),
    priorRent: priorRent && priorRentDate ? { weeklyRent: priorRent, date: priorRentDate } : undefined,
    excludeAddress: p.get('excludeAddress') ?? undefined,
  };

  try {
    const result = await getRentalEstimate(subject);
    if (!result) {
      return NextResponse.json(
        { result: null, reason: 'insufficient data to estimate rent' },
        { status: 200, headers: CORS_HEADERS },
      );
    }
    return NextResponse.json({ result }, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('[estimate-rent] error:', err);
    return NextResponse.json(
      { result: null, reason: 'internal error' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
