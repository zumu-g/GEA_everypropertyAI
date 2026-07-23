import { NextRequest, NextResponse } from 'next/server';
import { getRentalsForSuburb, type PropertyRentalRecord } from '@/lib/db/queries';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

// Below this many matching rentals, a bucket's low/avg/median isn't meaningful.
const MIN_RENTALS_FOR_SUFFICIENT_DATA = 3;

// Plausibility envelope for weekly_rent — excludes obvious data errors
// (e.g. a $1/wk placeholder, a five-figure typo) from the aggregates.
const MIN_PLAUSIBLE_WEEKLY_RENT = 50;
const MAX_PLAUSIBLE_WEEKLY_RENT = 5_000;

export interface RentalMarketSegment {
  name: string;
  low: number;
  avg: number;
  median: number;
  sufficientData: boolean;
}

interface SegmentBucket {
  name: string;
  isUnit: boolean;
  bedrooms: number;
  bedroomsPlus?: boolean;
}

function isUnitType(propertyType: string | undefined): boolean {
  if (!propertyType) return false;
  const t = propertyType.toLowerCase();
  return t.includes('unit') || t.includes('townhouse') || t.includes('apartment');
}

/**
 * Segment set per the subject property's own type (mirrors market-segments'
 * sale-price bucket sets, R2 of the origin sales plan):
 * - unit/townhouse subject: 1-bed unit, 2-bed unit, 3-bed house, 4-bed house
 * - house subject (or unknown): 3-bed, 4-bed, 5+-bed houses, plus units/townhouses
 */
function segmentSetFor(propertyType: string | undefined): SegmentBucket[] {
  if (isUnitType(propertyType)) {
    return [
      { name: '1 bedroom unit', isUnit: true, bedrooms: 1 },
      { name: '2 bedroom unit', isUnit: true, bedrooms: 2 },
      { name: '3 bedroom house', isUnit: false, bedrooms: 3 },
      { name: '4 bedroom house', isUnit: false, bedrooms: 4 },
    ];
  }
  return [
    { name: '3 bedroom homes', isUnit: false, bedrooms: 3 },
    { name: '4 bedroom homes', isUnit: false, bedrooms: 4 },
    { name: '5+ bedroom homes', isUnit: false, bedrooms: 5, bedroomsPlus: true },
    { name: 'Units / townhouses', isUnit: true, bedrooms: 0 },
  ];
}

function matchesBucket(rental: PropertyRentalRecord, bucket: SegmentBucket): boolean {
  const rentalIsUnit = isUnitType(rental.property_type);
  if (bucket.name === 'Units / townhouses') return rentalIsUnit;
  if (rentalIsUnit !== bucket.isUnit) return false;
  if (typeof rental.bedrooms !== 'number') return false;
  return bucket.bedroomsPlus ? rental.bedrooms >= bucket.bedrooms : rental.bedrooms === bucket.bedrooms;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundToTen(n: number): number {
  return Math.round(n / 10) * 10;
}

function aggregateBucket(bucket: SegmentBucket, rentals: PropertyRentalRecord[]): RentalMarketSegment {
  const matching = rentals.filter((r) => matchesBucket(r, bucket));
  const rents = matching
    .map((r) => r.weekly_rent)
    .filter(
      (p): p is number =>
        typeof p === 'number' && p >= MIN_PLAUSIBLE_WEEKLY_RENT && p <= MAX_PLAUSIBLE_WEEKLY_RENT,
    );

  if (rents.length === 0) {
    return { name: bucket.name, low: 0, avg: 0, median: 0, sufficientData: false };
  }

  return {
    name: bucket.name,
    low: roundToTen(Math.min(...rents)),
    avg: roundToTen(rents.reduce((a, b) => a + b, 0) / rents.length),
    median: roundToTen(median(rents)),
    sufficientData: rents.length >= MIN_RENTALS_FOR_SUFFICIENT_DATA,
  };
}

/** Most recent listed_date (falling back to created_at) among rows actually used across all matched buckets. */
function latestRentalDate(rentals: PropertyRentalRecord[], buckets: SegmentBucket[]): string | null {
  let latest: string | null = null;
  for (const rental of rentals) {
    const date = rental.listed_date ?? rental.created_at;
    if (!date) continue;
    if (!buckets.some((b) => matchesBucket(rental, b))) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

/**
 * OPTIONS /api/rental-market-segments — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/rental-market-segments
 *
 * Weekly-rent twin of /api/market-segments: aggregates active suburb rentals
 * (`property_rentals`, via getRentalsForSuburb) into the same 4-segment
 * low/avg/median shape, bucketed by the subject property's own type. Always
 * returns exactly 4 segments — a bucket with too few matching rentals is
 * flagged `sufficientData: false` rather than omitted.
 *
 * Query params:
 *   suburb       — required
 *   state        — optional (defaults to "VIC")
 *   propertyType — optional, subject's property type (selects the segment set)
 *   sinceDays    — optional, how far back to look by listed_date (default 180 —
 *                  rentals turn over far faster than sales, so a 2-year window
 *                  like market-segments would include stale asking rents)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const propertyType = searchParams.get('propertyType') ?? undefined;
  const sinceDaysParam = searchParams.get('sinceDays');
  const sinceDaysRaw = sinceDaysParam && Number.isFinite(Number(sinceDaysParam)) ? Number(sinceDaysParam) : 180;
  const sinceDays = Math.min(Math.max(sinceDaysRaw, 1), 3650);

  if (!suburb) {
    return NextResponse.json(
      { error: 'suburb query param is required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const rentals = await getRentalsForSuburb(suburb, state, 1000, { sinceDays });
    const buckets = segmentSetFor(propertyType);
    const segments = buckets.map((b) => aggregateBucket(b, rentals));
    const dataDate = latestRentalDate(rentals, buckets);

    return NextResponse.json(
      { segments, dataDate },
      { status: 200, headers: OK_HEADERS },
    );
  } catch (err) {
    console.error('[rental-market-segments] error:', err);
    return NextResponse.json(
      { error: 'Failed to compute rental market segments' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
