import { NextRequest, NextResponse } from 'next/server';
import type { StructuredAddress, MergedPropertyProfile as PropertyProfile } from '@/types/property';
import { propertyCache } from '@/lib/cache';
import { toSlug } from '@/lib/utils/address';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';
import { getCachedProfile, getOverrides } from '@/lib/db/queries';

// Allow headroom for the stealth fallback (browser fetch ~10-15s/portal) on a
// fresh, uncached lookup. Cached lookups return instantly. Declared maxDuration
// keeps the serverless function alive long enough on Vercel (Pro).
export const maxDuration = 120;
const PIPELINE_TIMEOUT_MS = 110_000; // 110s — just under maxDuration

function applyOverrides(
  profile: PropertyProfile,
  overrides: Record<string, string>
): PropertyProfile {
  if (Object.keys(overrides).length === 0) return profile;

  const NUMERIC_FIELDS = new Set(['bedrooms', 'bathrooms', 'carSpaces', 'landArea', 'yearBuilt']);

  const patchedData = { ...profile.data };
  const patchedConfidences = { ...profile.fieldConfidences };

  for (const [field, rawValue] of Object.entries(overrides)) {
    const value = NUMERIC_FIELDS.has(field) ? Number(rawValue) : rawValue;
    patchedData[field] = value;
    patchedConfidences[field] = { confidence: 100, contributedBy: ['user-override'] };
  }

  return { ...profile, data: patchedData, fieldConfidences: patchedConfidences };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * OPTIONS /api/property — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/property
 *
 * Accepts a structured address and returns a unified PropertyProfile
 * by orchestrating: cache check -> crawl -> extract -> merge -> cache.
 */
export async function POST(request: NextRequest) {
  let body: { address: StructuredAddress };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { address } = body;

  if (!address || (!address.streetName && !address.displayAddress)) {
    return NextResponse.json(
      { error: 'Address must include at least streetName or displayAddress.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const slug = toSlug(address);

  // 1. Check in-memory cache
  const cached = propertyCache.get(slug);
  if (cached) {
    const overrides = await getOverrides(slug);
    const finalProfile = applyOverrides(cached, overrides);
    return NextResponse.json(
      { profile: finalProfile, source: 'cache', addressSlug: slug },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'X-Cache-Status': 'HIT',
        },
      }
    );
  }

  // 1b. Try Supabase cache (persistent, survives restarts)
  const supabaseCached = await getCachedProfile(slug);
  if (supabaseCached) {
    propertyCache.set(slug, supabaseCached); // warm in-memory cache
    const overrides = await getOverrides(slug);
    const finalProfile = applyOverrides(supabaseCached, overrides);
    return NextResponse.json(
      { profile: finalProfile, source: 'cache', addressSlug: slug },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'X-Cache-Status': 'HIT',
        },
      }
    );
  }

  // 2. Run the full pipeline with a timeout
  try {
    const profile = await runPipelineWithTimeout(address, slug);
    const overrides = await getOverrides(slug);
    const finalProfile = applyOverrides(profile, overrides);

    return NextResponse.json(
      { profile: finalProfile, source: 'fresh', addressSlug: slug },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'X-Cache-Status': 'MISS',
          'X-Sources-Found': String(profile.sources?.length ?? 0),
          'X-Crawl-Status': 'complete',
        },
      }
    );
  } catch (error) {
    console.error('[/api/property] Pipeline error:', error);

    const message =
      error instanceof Error ? error.message : 'Unknown pipeline error';

    // If it was a timeout, check if we have partial data in cache
    const partial = propertyCache.get(slug);
    if (partial) {
      return NextResponse.json(
        { profile: partial, source: 'partial', warning: 'Pipeline timed out, returning partial data.' },
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'X-Cache-Status': 'PARTIAL',
            'X-Crawl-Status': 'timeout',
          },
        }
      );
    }

    return NextResponse.json(
      { error: `Property lookup failed: ${message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Run the shared crawl -> extract -> merge -> cache pipeline with a timeout.
 */
async function runPipelineWithTimeout(
  address: StructuredAddress,
  _slug: string
): Promise<PropertyProfile> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Pipeline timed out')), PIPELINE_TIMEOUT_MS)
  );
  const { profile } = await Promise.race([fetchAndCacheProfile(address), timeout]);
  return profile;
}
