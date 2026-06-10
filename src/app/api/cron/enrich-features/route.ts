import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db/supabase';
import { runFeatureEnrichment } from '@/lib/jobs/feature-enrichment';

/**
 * GET /api/cron/enrich-features
 *
 * Batch-populates property_features (planning zone/overlays + nearest train
 * station) for sold addresses, keyed by address_slug (migration 009 + plan U3).
 * Idempotent — slugs enriched within the freshness TTL are skipped.
 *
 * Auth: ?token= or x-ingest-token must equal INGEST_SECRET (or CRON_SECRET),
 * matching the other cron routes.
 *
 * Optional: ?maxRows=<n> caps work (default 5000).
 *
 * Long-running: hits external geo providers under a rate limit. Allow headroom.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.INGEST_SECRET ?? process.env.CRON_SECRET;
  const token = request.nextUrl.searchParams.get('token') ?? request.headers.get('x-ingest-token');
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const maxRowsParam = Number(request.nextUrl.searchParams.get('maxRows'));
  const maxRows = Number.isFinite(maxRowsParam) && maxRowsParam > 0 ? maxRowsParam : undefined;

  const result = await runFeatureEnrichment({ maxRows });
  return NextResponse.json({ ok: true, ...result });
}
