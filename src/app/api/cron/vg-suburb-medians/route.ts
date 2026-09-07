import { NextRequest, NextResponse } from 'next/server';
import { ingestSuburbMedians } from '@/lib/jobs/vg-suburb-medians';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/db/supabase';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function isAuthorised(request: NextRequest): boolean {
  if (!CRON_SECRET) return true; // dev mode -- no secret set
  const auth = request.headers.get('authorization') ?? request.headers.get('x-cron-secret');
  return auth === `Bearer ${CRON_SECRET}` || auth === CRON_SECRET;
}

// ─── POST /api/cron/vg-suburb-medians ─────────────────────────────────────────
//
// Dedicated weekly ingest for suburb_medians (Valuer-General quarterly + yearly
// suburb median files). Kept separate from /api/cron/ingest-vg (NSW/VIC/WA
// individual-sale ingestion) so a failure in an unrelated state's scrape can
// never mask whether this suburb-medians step ran, per U1 (see
// docs/plans/2026-09-07-1735-feat-casey-cardinia-values-guide-plan.md).
//
// Auth: Authorization: Bearer {CRON_SECRET} (skipped if CRON_SECRET not set)

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let previousServiceAreaHits: number | null = null;
  if (isSupabaseConfigured()) {
    const { count } = await getSupabaseServerClient()
      .from('suburb_medians')
      .select('suburb', { count: 'exact', head: true });
    previousServiceAreaHits = count ?? null;
  }

  try {
    const result = await ingestSuburbMedians(previousServiceAreaHits);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/vg-suburb-medians] Error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
