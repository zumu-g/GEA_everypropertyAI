import { NextRequest, NextResponse } from 'next/server';
import { processQueue } from '@/lib/jobs/process-crawl-queue';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

/**
 * POST /api/cron/process-queue
 *
 * Processes up to 10 queued crawl jobs per invocation.
 * Runs on a 15-minute Vercel Cron schedule.
 *
 * Auth: Authorization: Bearer {CRON_SECRET} (skipped if CRON_SECRET not set)
 */
export async function POST(request: NextRequest) {
  if (CRON_SECRET) {
    const auth =
      request.headers.get('authorization') ??
      request.headers.get('x-cron-secret');
    if (auth !== `Bearer ${CRON_SECRET}` && auth !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await processQueue(10, 50_000);

    return NextResponse.json({
      status: 'completed',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/process-queue] Error:', message);
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 });
  }
}
