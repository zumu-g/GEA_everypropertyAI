import { NextRequest, NextResponse } from 'next/server';
import {
  runDailyListingsCrawl,
  DEFAULT_VIC_SUBURBS,
  type DailyJobConfig,
} from '@/lib/jobs/daily-listings';

// Simple auth token for cron jobs (set in .env.local)
const CRON_SECRET = process.env.CRON_SECRET ?? '';

// Track running job to prevent concurrent execution
let isRunning = false;
let lastResult: Record<string, unknown> | null = null;

/**
 * POST /api/cron/daily-listings
 *
 * Triggers the daily listings crawl. Can be called by:
 * - Vercel Cron (with CRON_SECRET header)
 * - Manual trigger via API
 *
 * Body (optional):
 * {
 *   "suburbs": [{ "name": "Berwick", "state": "VIC", "postcode": "3806" }],
 *   "types": ["buy", "sold"],
 *   "maxPerSuburb": 10
 * }
 */
export async function POST(request: NextRequest) {
  // Verify auth (skip in dev if no secret configured)
  if (CRON_SECRET) {
    const auth =
      request.headers.get('authorization') ??
      request.headers.get('x-cron-secret');
    if (auth !== `Bearer ${CRON_SECRET}` && auth !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (isRunning) {
    return NextResponse.json(
      { error: 'Daily crawl is already running', lastResult },
      { status: 409 }
    );
  }

  // Parse optional config from body
  let config: DailyJobConfig = { suburbs: DEFAULT_VIC_SUBURBS };
  try {
    const body = await request.json().catch(() => null);
    if (body?.suburbs) config.suburbs = body.suburbs;
    if (body?.types) config.types = body.types;
    if (body?.maxPerSuburb) config.maxPerSuburb = body.maxPerSuburb;
  } catch {
    // Use defaults
  }

  isRunning = true;

  try {
    const result = await runDailyListingsCrawl(config);
    lastResult = result as unknown as Record<string, unknown>;

    return NextResponse.json({
      status: 'completed',
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { status: 'failed', error: message },
      { status: 500 }
    );
  } finally {
    isRunning = false;
  }
}

/**
 * GET /api/cron/daily-listings
 *
 * Returns the status and last result of the daily crawl.
 */
export async function GET() {
  return NextResponse.json({
    isRunning,
    lastResult,
  });
}
