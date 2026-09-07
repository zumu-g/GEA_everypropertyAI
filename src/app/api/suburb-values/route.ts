import { NextResponse } from 'next/server';
import { getAllSuburbMedians, getRecentPricedSales } from '@/lib/db/queries';
import { assembleSuburbValues } from '@/lib/values/suburb-values';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

const COMPUTED_WINDOW_DAYS = 90;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/suburb-values
 *
 * Full Casey/Cardinia property-values payload: for every service-area suburb,
 * house and unit medians with 3-month/12-month/5-year change, sourced from
 * Valuer-General Victoria's published suburb medians (`suburb_medians`, U1)
 * plus a computed latest quarter from `property_sales`'s last 90 days (KTD2).
 *
 * Auth: middleware-gated (Authorization: Bearer <epai_gsw_… key>).
 * Consumer: GEA_Website `/property-values` page.
 */
export async function GET() {
  try {
    const [medianRows, recentSales] = await Promise.all([
      getAllSuburbMedians(),
      getRecentPricedSales(COMPUTED_WINDOW_DAYS),
    ]);

    const payload = assembleSuburbValues(medianRows, recentSales);

    return NextResponse.json(payload, { status: 200, headers: OK_HEADERS });
  } catch (err) {
    console.error('[suburb-values] error:', err);
    return NextResponse.json(
      { error: 'Failed to compute suburb values' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
