import { NextRequest, NextResponse } from 'next/server';
import { getPriceChanges } from '@/lib/db/price-history';
import { isServiceAreaSuburb } from '@/lib/utils/service-area';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/price-changes?suburb=Berwick&state=VIC&sinceDays=30
 *
 * Asking-price changes (sale and rental listings) in a suburb inside the window
 * (R13). sinceDays is an integer 1..365, default 30; outside → 400.
 * Suburbs outside Casey/Cardinia → 404.
 * Auth: middleware-gated (Authorization: Bearer <epai_ key>).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const suburb = q.get('suburb')?.trim();
  const state = (q.get('state')?.trim() || 'VIC').toUpperCase();
  const sinceDays = q.get('sinceDays') === null ? 30 : Math.trunc(Number(q.get('sinceDays')));

  if (!suburb) return NextResponse.json({ error: 'suburb is required' }, { status: 400, headers: CORS_HEADERS });
  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return NextResponse.json({ error: 'sinceDays must be an integer between 1 and 365' }, { status: 400, headers: CORS_HEADERS });
  }
  if (!isServiceAreaSuburb(suburb)) {
    return NextResponse.json({ error: 'suburb outside the Casey/Cardinia service area' }, { status: 404, headers: CORS_HEADERS });
  }

  try {
    const results = await getPriceChanges(suburb, state, sinceDays);
    return NextResponse.json({ count: results.length, results }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[price-changes]', err);
    return NextResponse.json({ error: 'Failed to fetch price changes' }, { status: 500, headers: CORS_HEADERS });
  }
}
