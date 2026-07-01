import { NextRequest, NextResponse, after } from 'next/server';
import type { StructuredAddress, MergedPropertyProfile as PropertyProfile } from '@/types/property';
import { propertyCache } from '@/lib/cache';
import { toSlug } from '@/lib/utils/address';
import { fetchAndCacheProfile } from '@/lib/jobs/fetch-profile';
import { getCachedProfile, getOverrides, deleteCachedProfile } from '@/lib/db/queries';

// Allow headroom for the stealth fallback (browser fetch ~10-15s/portal) on a
// fresh, uncached lookup. Cached lookups return instantly. Declared maxDuration
// keeps the serverless function alive long enough on Vercel (Pro).
export const maxDuration = 120;
const PIPELINE_TIMEOUT_MS = 110_000; // 110s — just under maxDuration (hard backstop)
// Soft crawl budget for user-facing lookups: stop waiting on blocked portals
// (REA/view/etc. burn the whole hard timeout on doomed stealth-retries) and
// proceed with whatever completed — the feed-seed step still yields a usable
// profile. Successful sources return well within this; only the doomed ones are
// cut. This is what stops a search hanging ~110s then 500ing.
const USER_CRAWL_SOFT_DEADLINE_MS = 45_000;
// FAST path (e.g. CRM enrich): short synchronous crawl of high-value sources, then
// the full crawl runs in the background to fill the cache. Keeps the caller snappy.
const FAST_TIMEOUT_MS = 12_000;

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
  let body: { address: StructuredAddress; fast?: boolean; refresh?: boolean };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { address, fast = false } = body;
  // Cache-bust: `?refresh=1` (or `{refresh:true}`) skips the cache read, evicts
  // the stale record (in-memory + Supabase), and re-runs the pipeline so a wrong
  // cached profile can be corrected (plan 008).
  const refresh =
    body.refresh === true || ['1', 'true'].includes(request.nextUrl.searchParams.get('refresh') ?? '');

  if (!address || (!address.streetName && !address.displayAddress)) {
    return NextResponse.json(
      { error: 'Address must include at least streetName or displayAddress.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const slug = toSlug(address);

  // On refresh, evict both caches up front so the pipeline re-crawls and overwrites.
  if (refresh) {
    propertyCache.invalidate(slug);
    await deleteCachedProfile(slug);
  }

  // 1. Check in-memory cache. A full (non-fast) request must NOT be served a
  // previously-cached fast partial — fall through to a complete crawl instead.
  const cached = refresh ? undefined : propertyCache.get(slug);
  if (cached && (fast || cached.crawlMode !== 'fast')) {
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

  // 1b. Try Supabase cache (persistent, survives restarts). Same fast-partial
  // guard as the in-memory cache above. Skipped on refresh.
  const supabaseCached = refresh ? null : await getCachedProfile(slug);
  if (supabaseCached && (fast || supabaseCached.crawlMode !== 'fast')) {
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

  // 2. Cache miss. In FAST mode (e.g. CRM enrich): kick off the full crawl in the
  // background to fill the cache, then run a short trimmed crawl for an immediate
  // (possibly partial) response. In normal mode: the full blocking pipeline.
  if (fast) {
    // Fill the cache with the full crawl in the background. Single mechanism only
    // (no extra enqueue) so a new address triggers ONE background crawl, not two —
    // fetchAndCacheProfile dedupes/reuses the cache, so repeat work is avoided.
    after(async () => {
      try {
        await fetchAndCacheProfile(address); // full crawl → fills cache
      } catch (e) {
        console.warn('[/api/property] background full crawl failed:', e);
      }
    });
  }

  try {
    const profile = await runPipelineWithTimeout(address, {
      fast,
      timeoutMs: fast ? FAST_TIMEOUT_MS : PIPELINE_TIMEOUT_MS,
    });
    const overrides = await getOverrides(slug);
    const finalProfile = applyOverrides(profile, overrides);
    const empty =
      (profile.sources?.length ?? 0) === 0 || Object.keys(profile.data ?? {}).length === 0;

    return NextResponse.json(
      {
        profile: finalProfile,
        source: empty ? 'queued' : 'fresh',
        addressSlug: slug,
        ...(fast && empty
          ? { warning: 'Enriching in background — re-fetch in a minute for full data.' }
          : {}),
      },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'X-Cache-Status': fast ? 'FAST' : 'MISS',
          'X-Sources-Found': String(profile.sources?.length ?? 0),
          'X-Crawl-Status': fast ? 'fast' : 'complete',
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

    // Fast mode: the background full crawl is already running — don't 500, tell the
    // caller it's being enriched so it can re-fetch shortly.
    if (fast) {
      return NextResponse.json(
        {
          profile: { data: {}, fieldConfidences: {}, overallConfidence: 0, sources: [], mergedAt: new Date() },
          source: 'queued',
          addressSlug: slug,
          warning: 'Enriching in background — re-fetch in a minute for full data.',
        },
        { status: 200, headers: { ...CORS_HEADERS, 'X-Cache-Status': 'QUEUED', 'X-Crawl-Status': 'queued' } }
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
 * `fast` trims to high-value sources with short timeouts (see fetch-profile).
 */
async function runPipelineWithTimeout(
  address: StructuredAddress,
  opts: { fast: boolean; timeoutMs: number }
): Promise<PropertyProfile> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Pipeline timed out')), opts.timeoutMs)
  );
  const { profile } = await Promise.race([
    fetchAndCacheProfile(address, {
      fast: opts.fast,
      // Non-fast user lookups get a soft crawl budget so blocked portals don't
      // consume the whole hard timeout before the feed-seed step runs.
      softDeadlineMs: opts.fast ? undefined : USER_CRAWL_SOFT_DEADLINE_MS,
    }),
    timeout,
  ]);
  return profile;
}
