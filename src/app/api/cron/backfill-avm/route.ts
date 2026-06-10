import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db/supabase';
import { backfillAvmAttributesFromCache } from '@/lib/jobs/avm-backfill';
import type { AvmBackfillTable } from '@/lib/db/queries';

/**
 * GET /api/cron/backfill-avm
 *
 * Copies AVM attributes (building area, year built, features, per-field
 * confidence) from cached property profiles onto the property_sales /
 * property_listings / property_rentals rows the AVM trains on (migration 008 +
 * plan U2). Idempotent — only rows missing building_area_sqm are touched.
 *
 * Auth: ?token= or x-ingest-token must equal INGEST_SECRET (or CRON_SECRET),
 * matching the other cron routes.
 *
 * Optional: ?maxRows=<n> caps work per table (default 10000).
 */
const TABLES: AvmBackfillTable[] = ['property_sales', 'property_listings', 'property_rentals'];

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

  const results = [];
  for (const table of TABLES) {
    results.push(await backfillAvmAttributesFromCache(table, { maxRows }));
  }

  const updated = results.reduce((sum, r) => sum + r.updated, 0);
  return NextResponse.json({ ok: true, updated, results });
}
