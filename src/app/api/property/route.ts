import { NextRequest, NextResponse } from 'next/server';
import type { StructuredAddress, MergedPropertyProfile as PropertyProfile } from '@/types/property';
import type { CrawlResult } from '@/types/crawl';
import { propertyCache } from '@/lib/cache';
import { toSlug, formatAddress } from '@/lib/utils/address';
import { crawlProperty } from '@/lib/firecrawl/orchestrator';
import { extractPropertyData } from '@/lib/extraction/extractor';
import { mergePropertyData } from '@/lib/extraction/merger';

const PIPELINE_TIMEOUT_MS = 60_000; // 60 seconds

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

  // 1. Check cache
  const cached = propertyCache.get(slug);
  if (cached) {
    return NextResponse.json(
      { profile: cached, source: 'cache' },
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

    return NextResponse.json(
      { profile, source: 'fresh' },
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
 * Run the full crawl -> extract -> merge pipeline with a timeout.
 */
async function runPipelineWithTimeout(
  address: StructuredAddress,
  slug: string
): Promise<PropertyProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  try {
    const profile = await runPipeline(address, slug, controller.signal);
    return profile;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Core pipeline: crawl sources, extract data, merge into a unified profile.
 */
async function runPipeline(
  address: StructuredAddress,
  slug: string,
  signal: AbortSignal
): Promise<PropertyProfile> {
  // Step 1: Crawl property data from multiple sources
  const crawlResults: CrawlResult[] = await crawlProperty(address);
  console.log(`[pipeline] Crawl complete: ${crawlResults.length} sources, statuses: ${crawlResults.map(r => `${r.source}=${r.status}`).join(', ')}`);

  if (signal.aborted) {
    throw new Error('Pipeline timed out during crawl phase');
  }

  const successful = crawlResults.filter((result) => result.status === 'success');
  console.log(`[pipeline] Successful crawls: ${successful.length}, extracting...`);

  // Step 2: Extract structured data from each crawl result
  const fullAddress = formatAddress(address);
  const extractions = await Promise.all(
    successful.map((result) => extractPropertyData(result.markdown ?? '', result.source, fullAddress))
  );
  console.log(`[pipeline] Extractions complete: ${extractions.length}, fields: ${extractions.map(e => Object.keys(e.raw).join(',')).join(' | ')}`);

  if (signal.aborted) {
    throw new Error('Pipeline timed out during extraction phase');
  }

  // Step 3: Merge all extractions into a unified PropertyProfile
  const profile = mergePropertyData(extractions);

  // Step 4: Cache the result
  propertyCache.set(slug, profile);

  return profile;
}
