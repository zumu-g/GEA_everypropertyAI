import { NextRequest, NextResponse } from 'next/server';
import { isServiceAreaSuburb } from '@/lib/utils/service-area';
import { isValidIsoDate, melbourneDate, type PeriodType } from '@/lib/stats/periods';
import { getSuburbStats } from '@/lib/stats/suburb-stats';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const MIN_AS_OF = '2020-01-01';

/**
 * GET /api/suburb-stats?suburb=Berwick&state=VIC&period=month&asOf=2026-08-15
 *
 * Period block of suburb market statistics (R14–R19, R26) with prior and
 * year-ago blocks. Suburbs outside Casey/Cardinia → 404; bad period or asOf → 400.
 * Auth: middleware-gated (Authorization: Bearer <epai_ key>).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const suburb = q.get('suburb')?.trim();
  const state = (q.get('state')?.trim() || 'VIC').toUpperCase();
  const period = (q.get('period')?.trim() || 'month') as PeriodType;
  const today = melbourneDate();
  const asOf = q.get('asOf')?.trim() || today;

  if (!suburb) return NextResponse.json({ error: 'suburb is required' }, { status: 400, headers: CORS_HEADERS });
  if (period !== 'month' && period !== 'week') {
    return NextResponse.json({ error: 'period must be month or week' }, { status: 400, headers: CORS_HEADERS });
  }
  if (state !== 'VIC') return NextResponse.json({ error: 'state must be VIC' }, { status: 400, headers: CORS_HEADERS });
  if (!isValidIsoDate(asOf) || asOf < MIN_AS_OF || asOf > today) {
    return NextResponse.json({ error: `asOf must be an ISO date between ${MIN_AS_OF} and today` }, { status: 400, headers: CORS_HEADERS });
  }
  if (!isServiceAreaSuburb(suburb)) {
    return NextResponse.json({ error: 'suburb outside the Casey/Cardinia service area' }, { status: 404, headers: CORS_HEADERS });
  }

  try {
    const body = await getSuburbStats(suburb, state, period, asOf);
    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[suburb-stats]', err);
    return NextResponse.json({ error: 'Failed to compute suburb stats' }, { status: 500, headers: CORS_HEADERS });
  }
}
