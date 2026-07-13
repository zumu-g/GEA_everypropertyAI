import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/db/supabase';
import { getSalesForSuburb } from '@/lib/db/queries';
import { propertyCache } from '@/lib/cache';
import { PUBLIC_GET_CACHE_HEADERS } from '@/lib/http/cache-headers';
import { parseAddress, toSlug } from '@/lib/utils/address';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cache only successful (200) responses — never error responses.
const OK_HEADERS = { ...CORS_HEADERS, ...PUBLIC_GET_CACHE_HEADERS };

/**
 * OPTIONS /api/comparable-sales — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface ComparableResult {
  address: string;
  suburb: string;
  price: number;
  saleDate: string;
  beds?: number;
  baths?: number;
  landAreaSqm?: number;
  similarityScore: number;
  imageUrl?: string;
}

/**
 * First valid photo URL from a profile's inner data. `photos` entries may be
 * plain URL strings or `{ url }` objects (same contract as /api/proposal).
 */
function firstPhotoUrl(innerData: Record<string, unknown>): string | undefined {
  const photos = innerData.photos;
  if (!Array.isArray(photos)) return undefined;
  for (const p of photos) {
    const url = typeof p === 'string' ? p : (p as { url?: unknown } | null)?.url;
    if (typeof url === 'string' && url) return url;
  }
  return undefined;
}

/**
 * Extract a readable address string from raw_data.data.address,
 * which may be a string, or an object with fullAddress / displayAddress.
 */
function extractAddress(rawData: Record<string, unknown>): string {
  const data = (rawData.data ?? {}) as Record<string, unknown>;
  const addr = data.address;
  if (typeof addr === 'string') return addr;
  if (addr && typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    if (typeof a.fullAddress === 'string') return a.fullAddress;
    if (typeof a.displayAddress === 'string') return a.displayAddress;
  }
  return '';
}

/**
 * Normalized dedup key for a comparable's address — tolerant of case,
 * punctuation, and street-type formatting differences between the
 * property_cache and Valuer-General (property_sales) sources.
 */
function dedupKey(address: string): string {
  const slug = toSlug(parseAddress(address));
  return slug || address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Field-richness score used to break ties when two comparables share a
 * dedup key — prefers the record with more populated display fields.
 */
function richnessScore(c: ComparableResult): number {
  let score = 0;
  if (c.imageUrl) score += 1;
  if (c.beds != null) score += 1;
  if (c.baths != null) score += 1;
  if (c.landAreaSqm != null && c.landAreaSqm > 0) score += 1;
  return score;
}

/**
 * Collapse comparables that refer to the same property (same normalized
 * address) into one — keeping the higher similarity score, then the
 * richer record on ties. The same property can legitimately appear once
 * from property_cache and once from the Valuer-General supplement.
 */
function dedupeComparables(comparables: ComparableResult[]): ComparableResult[] {
  const byKey = new Map<string, ComparableResult>();

  for (const candidate of comparables) {
    const key = dedupKey(candidate.address);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const candidateWins =
      candidate.similarityScore > existing.similarityScore ||
      (candidate.similarityScore === existing.similarityScore &&
        richnessScore(candidate) > richnessScore(existing));
    if (candidateWins) byKey.set(key, candidate);
  }

  return Array.from(byKey.values());
}

/**
 * Search the in-memory property cache for comparable sales in the same suburb.
 * Used as a fallback when Supabase is not configured.
 */
function findComparablesFromCache(
  suburb: string,
  beds: number | undefined,
  baths: number | undefined,
  propertyType: string,
  excludeSlug: string
): ComparableResult[] {
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const suburbLower = suburb.toLowerCase();
  const comparables: ComparableResult[] = [];

  for (const [slug, profile] of propertyCache.entries()) {
    if (slug === excludeSlug) continue;

    const d = profile.data as Record<string, unknown>;

    // Check suburb match
    const addrObj = d.address as Record<string, unknown> | undefined;
    const profileSuburb = (
      typeof d.suburb === 'string' ? d.suburb :
      addrObj && typeof addrObj.suburb === 'string' ? addrObj.suburb : ''
    ).toLowerCase();

    if (!profileSuburb.includes(suburbLower) && !suburbLower.includes(profileSuburb)) continue;

    // Find most recent sale
    const saleHistory = Array.isArray(d.saleHistory) ? d.saleHistory : [];
    if (saleHistory.length === 0) continue;
    const mostRecent = saleHistory[0] as Record<string, unknown>;
    const price = typeof mostRecent.price === 'number' ? mostRecent.price : undefined;
    if (!price) continue;
    const saleDate = typeof mostRecent.date === 'string' ? mostRecent.date : '';

    // Scoring
    let score = 100;
    const rowBeds = typeof d.bedrooms === 'number' ? d.bedrooms : undefined;
    const rowBaths = typeof d.bathrooms === 'number' ? d.bathrooms : undefined;
    const rowType = typeof d.propertyType === 'string' ? d.propertyType : '';

    if (beds !== undefined && rowBeds !== undefined) {
      if (rowBeds === beds) score += 20;
      else if (Math.abs(rowBeds - beds) === 1) score += 10;
    }
    if (baths !== undefined && rowBaths !== undefined) {
      if (rowBaths === baths) score += 10;
      else if (Math.abs(rowBaths - baths) === 1) score += 5;
    }
    if (propertyType && rowType && rowType.toLowerCase() === propertyType.toLowerCase()) {
      score += 10;
    }
    if (saleDate) {
      try {
        if (new Date(saleDate) >= twoYearsAgo) score += 10;
      } catch {
        // Invalid date string — skip recency bonus
      }
    }

    // Build address string
    const addrStr = addrObj
      ? (typeof addrObj.fullAddress === 'string' ? addrObj.fullAddress :
         typeof addrObj.displayAddress === 'string' ? addrObj.displayAddress : slug)
      : slug;

    comparables.push({
      address: addrStr,
      suburb: profileSuburb,
      price,
      saleDate,
      beds: rowBeds,
      baths: rowBaths,
      landAreaSqm: typeof d.landAreaSqm === 'number' ? d.landAreaSqm : undefined,
      similarityScore: score,
      imageUrl: firstPhotoUrl(d),
    });
  }

  const deduped = dedupeComparables(comparables);
  deduped.sort((a, b) => b.similarityScore - a.similarityScore);
  return deduped;
}

/**
 * GET /api/comparable-sales
 *
 * Query params:
 *   suburb       — required
 *   state        — optional (defaults to "VIC")
 *   postcode     — optional, used for future filtering
 *   beds         — optional number
 *   baths        — optional number
 *   propertyType — optional string
 *   excludeSlug  — optional, exclude this address slug from results
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const suburb = searchParams.get('suburb') ?? '';
  const state = (searchParams.get('state') ?? 'VIC').toUpperCase();
  const beds = searchParams.get('beds') ? Number(searchParams.get('beds')) : undefined;
  const baths = searchParams.get('baths') ? Number(searchParams.get('baths')) : undefined;
  const propertyType = searchParams.get('propertyType') ?? '';
  const excludeSlug = searchParams.get('excludeSlug') ?? '';

  if (!suburb) {
    return NextResponse.json(
      { error: 'suburb query param is required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!isSupabaseConfigured()) {
    // Fall back to in-memory cache — search across all cached profiles for this suburb
    const comparables = findComparablesFromCache(suburb, beds, baths, propertyType, excludeSlug);
    return NextResponse.json(
      { comparables: comparables.slice(0, 4) },
      { status: 200, headers: OK_HEADERS }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    // Fetch candidates from property_cache matching the suburb.
    // raw_data is a MergedPropertyProfile, so suburb lives at raw_data -> data -> address ->> suburb
    // (not at the top-level raw_data ->> suburb as previously queried).
    // NOTE: requires Supabase configured to verify — use a functional index on this path for performance.
    let query = supabase
      .from('property_cache')
      .select('address_slug, raw_data, cached_at')
      .ilike("raw_data->data->address->>'suburb'", suburb)
      .order('cached_at', { ascending: false })
      .limit(20);

    if (excludeSlug) {
      query = query.neq('address_slug', excludeSlug);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[comparable-sales] Supabase error:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch comparable sales' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const comparables: ComparableResult[] = [];

    for (const row of data ?? []) {
      const rawData = row.raw_data as Record<string, unknown>;
      const innerData = (rawData.data ?? {}) as Record<string, unknown>;

      // Extract sale history — first entry is most recent
      const saleHistory = Array.isArray(innerData.saleHistory)
        ? innerData.saleHistory
        : [];

      if (saleHistory.length === 0) continue;

      const mostRecent = saleHistory[0] as Record<string, unknown>;
      const priceRaw = mostRecent.price as Record<string, unknown> | number | undefined;
      let price: number | undefined;
      if (typeof priceRaw === 'number') {
        price = priceRaw;
      } else if (priceRaw && typeof priceRaw === 'object' && typeof priceRaw.amount === 'number') {
        price = priceRaw.amount;
      }

      if (!price) continue;

      const saleDate = typeof mostRecent.saleDate === 'string' ? mostRecent.saleDate : '';

      // ── Scoring ──────────────────────────────────────────────────────────
      let score = 100;

      const rowBeds = typeof innerData.bedrooms === 'number' ? innerData.bedrooms : undefined;
      const rowBaths = typeof innerData.bathrooms === 'number' ? innerData.bathrooms : undefined;
      const rowType = typeof innerData.propertyType === 'string' ? innerData.propertyType : '';

      if (beds !== undefined && rowBeds !== undefined) {
        if (rowBeds === beds) score += 20;
        else if (Math.abs(rowBeds - beds) === 1) score += 10;
      }

      if (baths !== undefined && rowBaths !== undefined) {
        if (rowBaths === baths) score += 10;
        else if (Math.abs(rowBaths - baths) === 1) score += 5;
      }

      if (propertyType && rowType && rowType.toLowerCase() === propertyType.toLowerCase()) {
        score += 10;
      }

      if (saleDate) {
        const saleDateObj = new Date(saleDate);
        if (!isNaN(saleDateObj.getTime()) && saleDateObj >= twoYearsAgo) {
          score += 10;
        }
      }

      const landAreaSqm =
        typeof innerData.landAreaSqm === 'number' ? innerData.landAreaSqm : undefined;
      const rowSuburb =
        typeof innerData.suburb === 'string' ? innerData.suburb : suburb;

      comparables.push({
        address: extractAddress(rawData),
        suburb: rowSuburb,
        price,
        saleDate,
        beds: rowBeds,
        baths: rowBaths,
        landAreaSqm,
        similarityScore: score,
        imageUrl: firstPhotoUrl(innerData),
      });
    }

    // ── Supplement with structured VG / property_sales data ─────────────────
    // getSalesForSuburb() queries the property_sales table which holds
    // Valuer-General individual sale records ingested via /api/cron/ingest-vg.
    try {
      const vgSales = await getSalesForSuburb(suburb, state, 730);

      for (const vg of vgSales) {
        if (!vg.sale_price) continue;

        let score = 90; // Slightly lower base than property_cache matches
        // Note: VG data rarely carries bedroom/bathroom counts so those signals
        // are not available for scoring here — property type and recency only.
        if (propertyType && vg.property_type &&
            vg.property_type.toLowerCase() === propertyType.toLowerCase()) {
          score += 10;
        }
        if (vg.sale_date) {
          const saleDateObj = new Date(vg.sale_date);
          if (!isNaN(saleDateObj.getTime()) && saleDateObj >= twoYearsAgo) {
            score += 10;
          }
        }

        comparables.push({
          address: vg.raw_address,
          suburb: vg.suburb ?? suburb,
          price: vg.sale_price,
          saleDate: vg.sale_date ?? '',
          landAreaSqm: vg.land_area_sqm ?? undefined,
          similarityScore: score,
          imageUrl: vg.image_url ?? undefined,
        });
      }
    } catch (vgErr) {
      // Non-fatal — log and continue with property_cache results only
      console.warn('[comparable-sales] VG sales query failed:', vgErr);
    }

    // Dedup across property_cache and VG sources (same property can appear
    // in both), then sort by score descending and return top 4.
    const deduped = dedupeComparables(comparables);
    deduped.sort((a, b) => b.similarityScore - a.similarityScore);
    const top4 = deduped.slice(0, 4);

    return NextResponse.json(
      { comparables: top4 },
      { status: 200, headers: OK_HEADERS }
    );
  } catch (err) {
    console.error('[comparable-sales] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
