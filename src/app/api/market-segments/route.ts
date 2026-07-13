import { NextRequest, NextResponse } from 'next/server';
import { getSalesForSuburb, type PropertySaleRecord } from '@/lib/db/queries';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

// Below this many matching sales, a bucket's low/avg/median isn't meaningful.
const MIN_SALES_FOR_SUFFICIENT_DATA = 3;

const MAX_PLAUSIBLE_SALE_PRICE = 50_000_000;

export interface MarketSegment {
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
 * Segment set per the subject property's own type/bedrooms (plan R2):
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

function matchesBucket(sale: PropertySaleRecord, bucket: SegmentBucket): boolean {
  const saleIsUnit = isUnitType(sale.property_type);
  if (bucket.name === 'Units / townhouses') return saleIsUnit;
  if (saleIsUnit !== bucket.isUnit) return false;
  if (typeof sale.bedrooms !== 'number') return false;
  return bucket.bedroomsPlus ? sale.bedrooms >= bucket.bedrooms : sale.bedrooms === bucket.bedrooms;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundToThousand(n: number): number {
  return Math.round(n / 1000) * 1000;
}

function aggregateBucket(bucket: SegmentBucket, sales: PropertySaleRecord[]): MarketSegment {
  const matching = sales.filter((s) => matchesBucket(s, bucket));
  const prices = matching
    .map((s) => s.sale_price)
    .filter((p): p is number => typeof p === 'number' && p > 0 && p <= MAX_PLAUSIBLE_SALE_PRICE);

  if (prices.length === 0) {
    return { name: bucket.name, low: 0, avg: 0, median: 0, sufficientData: false };
  }

  return {
    name: bucket.name,
    low: roundToThousand(Math.min(...prices)),
    avg: roundToThousand(prices.reduce((a, b) => a + b, 0) / prices.length),
    median: roundToThousand(median(prices)),
    sufficientData: prices.length >= MIN_SALES_FOR_SUFFICIENT_DATA,
  };
}

/** Most recent sale_date among rows actually used across all matched buckets. */
function latestSaleDate(sales: PropertySaleRecord[], buckets: SegmentBucket[]): string | null {
  let latest: string | null = null;
  for (const sale of sales) {
    if (!sale.sale_date) continue;
    if (!buckets.some((b) => matchesBucket(sale, b))) continue;
    if (!latest || sale.sale_date > latest) latest = sale.sale_date;
  }
  return latest;
}

/**
 * OPTIONS /api/market-segments — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/market-segments
 *
 * Aggregates suburb sold-sales (`property_sales`, via getSalesForSuburb) into
 * the 4-segment low/avg/median shape QuadrantChart expects, bucketed by the
 * subject property's own type/bedrooms. Always returns exactly 4 segments —
 * a bucket with too few matching sales is flagged `sufficientData: false`
 * rather than omitted.
 *
 * Query params:
 *   suburb       — required
 *   state        — optional (defaults to "VIC")
 *   propertyType — optional, subject's property type (selects the segment set)
 *   bedrooms     — optional, subject's bedroom count (currently informational;
 *                  the segment set is keyed on propertyType per plan R2)
 *   sinceDays    — optional, how far back to look (default 730)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const propertyType = searchParams.get('propertyType') ?? undefined;
  const sinceDaysParam = searchParams.get('sinceDays');
  const sinceDaysRaw = sinceDaysParam && Number.isFinite(Number(sinceDaysParam)) ? Number(sinceDaysParam) : 730;
  // Clamp to a sane range: <=0 would silently return zero rows (every segment
  // flagged insufficient) rather than a clear error; an unbounded huge value
  // risks pathological date math downstream. 10 years is a generous ceiling.
  const sinceDays = Math.min(Math.max(sinceDaysRaw, 1), 3650);

  if (!suburb) {
    return NextResponse.json(
      { error: 'suburb query param is required' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const sales = await getSalesForSuburb(suburb, state, sinceDays, 1000);
    const buckets = segmentSetFor(propertyType);
    const segments = buckets.map((b) => aggregateBucket(b, sales));
    const dataDate = latestSaleDate(sales, buckets);

    return NextResponse.json(
      { segments, dataDate },
      { status: 200, headers: OK_HEADERS },
    );
  } catch (err) {
    console.error('[market-segments] error:', err);
    return NextResponse.json(
      { error: 'Failed to compute market segments' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
