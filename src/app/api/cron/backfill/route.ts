import { NextRequest, NextResponse } from 'next/server';
import { runBackfillTick } from '@/lib/jobs/backfill-casey-cardinia';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function isAuthorised(request: NextRequest): boolean {
  if (!CRON_SECRET) return true; // dev mode
  const auth = request.headers.get('authorization') ?? request.headers.get('x-cron-secret');
  return auth === `Bearer ${CRON_SECRET}` || auth === CRON_SECRET;
}

/**
 * Run one Casey/Cardinia backfill tick: enqueue capped property-profile crawl
 * jobs for the next (or specified) suburb. The process-queue cron drains them.
 *
 * POST /api/cron/backfill                      — scheduled tick (next ranked suburb)
 * GET/POST /api/cron/backfill?suburb=Cranbourne&cap=50&daily=200
 *
 * Auth: Bearer {CRON_SECRET} (skipped if unset).
 */
async function handle(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const suburb = sp.get('suburb') ?? undefined;
  const cap = sp.get('cap');
  const daily = sp.get('daily');

  try {
    const result = await runBackfillTick({
      suburb,
      perSuburbCap: cap ? Number(cap) : undefined,
      dailyCap: daily ? Number(daily) : undefined,
    });
    return NextResponse.json({ status: 'completed', result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/backfill] Error:', message);
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
