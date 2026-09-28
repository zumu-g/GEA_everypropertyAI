import { NextRequest, NextResponse } from 'next/server';
import { computeAndPersist, SETTLE_DAYS } from '@/lib/stats/suburb-stats';
import { addDays, melbourneDate, resolvePeriod, type PeriodType } from '@/lib/stats/periods';
import { SERVICE_AREA_SUBURBS } from '@/lib/utils/service-area';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function isAuthorised(request: NextRequest): boolean {
  if (!CRON_SECRET) return true; // dev mode -- no secret set
  const auth = request.headers.get('authorization') ?? request.headers.get('x-cron-secret');
  return auth === `Bearer ${CRON_SECRET}` || auth === CRON_SECRET;
}

// ─── GET|POST /api/cron/suburb-stats ──────────────────────────────────────────
//
// Nightly freeze (KTD6, R17). A period settles at the start of the day
// period_end + SETTLE_DAYS + 1 (see computeAndPersist), so a period whose end
// is today-61 settles today and today-62 settled yesterday. Both are frozen
// every night: the second day is the catch-up for a missed run, and re-freezing
// is a no-op because computeAndPersist returns the frozen row untouched.
//
// Auth: Authorization: Bearer {CRON_SECRET} (skipped if CRON_SECRET not set)

const CATCH_UP_DAYS = 2;
const CONCURRENCY = 3;
const PERIOD_TYPES: PeriodType[] = ['week', 'month'];

/** Periods (week and month) that end on one of the days that settled in the last CATCH_UP_DAYS. */
function settledPeriods(today: string): { type: PeriodType; start: string; end: string }[] {
  const out: { type: PeriodType; start: string; end: string }[] = [];
  for (let k = 0; k < CATCH_UP_DAYS; k++) {
    const end = addDays(today, -(SETTLE_DAYS + 1 + k));
    for (const type of PERIOD_TYPES) {
      const b = resolvePeriod(type, end);
      if (b.end === end) out.push({ type, start: b.start, end });
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const periods = settledPeriods(melbourneDate(now));
  let periodsFrozen = 0, skipped = 0;
  const errors: string[] = [];

  const freezeSuburb = async (suburb: string) => {
    for (const p of periods) {
      try {
        const r = await computeAndPersist(suburb, 'VIC', p.type, p.start, p.end, now);
        if (r.provisional) skipped++; else periodsFrozen++;
      } catch (e) {
        errors.push(`${suburb} ${p.type} ${p.start}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  for (let i = 0; i < SERVICE_AREA_SUBURBS.length; i += CONCURRENCY) {
    await Promise.all(SERVICE_AREA_SUBURBS.slice(i, i + CONCURRENCY).map(freezeSuburb));
  }
  if (errors.length) console.error('[cron/suburb-stats] errors:', errors);
  return NextResponse.json({ suburbs: SERVICE_AREA_SUBURBS.length, periodsFrozen, skipped, errors });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
