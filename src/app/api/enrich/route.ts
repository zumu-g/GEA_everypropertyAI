import { NextRequest, NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/enrichment/geocoding';
import { fetchPlanningData } from '@/lib/enrichment/planning';
import { fetchNearbySchools } from '@/lib/enrichment/schools';
import { fetchNearbyTransport } from '@/lib/enrichment/transport';
import { fetchSuburbStats } from '@/lib/enrichment/suburb-stats';
import { fetchBuyerDemand } from '@/lib/enrichment/buyer-demand';
import { fetchSuburbMarketData } from '@/lib/enrichment/market-data';

/**
 * GET /api/enrich?address=...&suburb=...&state=...&postcode=...
 *
 * Returns enrichment data: geocoding, planning/zoning, schools, transport, suburb stats.
 * Planning + suburb stats run in parallel. Schools and transport run sequentially
 * because they both hit Nominatim (1 req/sec rate limit).
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address') ?? '';
  const suburb = request.nextUrl.searchParams.get('suburb') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  const postcode = request.nextUrl.searchParams.get('postcode') ?? '';

  if (!address && !suburb) {
    return NextResponse.json(
      { error: 'address or suburb is required' },
      { status: 400 }
    );
  }

  // Step 1: Geocode the address
  const coords = await geocodeAddress(address || `${suburb}, ${state} ${postcode}`);

  // Step 2: Fetch planning + suburb stats + buyer demand + market data in parallel
  const [planningResult, suburbStatsResult, buyerDemandResult, marketDataResult] = await Promise.allSettled([
    coords
      ? fetchPlanningData(coords.lat, coords.lng, state)
      : Promise.resolve(null),
    suburb && state && postcode
      ? fetchSuburbStats(suburb, state, postcode)
      : Promise.resolve(null),
    suburb && state && postcode
      ? fetchBuyerDemand(suburb, state, postcode)
      : Promise.resolve(null),
    suburb && state && postcode
      ? fetchSuburbMarketData(suburb, state, postcode)
      : Promise.resolve(null),
  ]);

  // Step 3: Schools then transport (both use Nominatim, must be sequential)
  let schools: Awaited<ReturnType<typeof fetchNearbySchools>> = [];
  let transport: Awaited<ReturnType<typeof fetchNearbyTransport>> = [];

  if (coords) {
    try {
      schools = await fetchNearbySchools(coords.lat, coords.lng, 3);
    } catch { /* logged inside */ }

    try {
      transport = await fetchNearbyTransport(coords.lat, coords.lng, 3);
    } catch { /* logged inside */ }
  }

  return NextResponse.json({
    coordinates: coords,
    planning:
      planningResult.status === 'fulfilled' ? planningResult.value : null,
    schools,
    transport,
    suburbStats:
      suburbStatsResult.status === 'fulfilled' ? suburbStatsResult.value : null,
    buyerDemand:
      buyerDemandResult.status === 'fulfilled' ? buyerDemandResult.value : null,
    marketData:
      marketDataResult.status === 'fulfilled' ? marketDataResult.value : null,
  });
}
