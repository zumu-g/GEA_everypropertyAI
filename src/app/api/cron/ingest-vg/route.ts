import { NextRequest, NextResponse } from 'next/server';
import {
  runValuerGeneralIngestion,
  ingestVicSalesCsvUrl,
  backfillVicIndividualSalesHistory,
} from '@/lib/jobs/ingest-vg-data';
import { CASEY_CARDINIA_POSTCODES } from '@/data/casey-cardinia';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

// ─── Authentication helper ────────────────────────────────────────────────────

function isAuthorised(request: NextRequest): boolean {
  if (!CRON_SECRET) return true; // dev mode — no secret set
  const auth =
    request.headers.get('authorization') ??
    request.headers.get('x-cron-secret');
  return auth === `Bearer ${CRON_SECRET}` || auth === CRON_SECRET;
}

// ─── POST /api/cron/ingest-vg ─────────────────────────────────────────────────
//
// Triggers Valuer General bulk data ingestion for NSW, VIC, and WA.
// Runs on a weekly Vercel Cron schedule (Monday 2am UTC).
//
// Auth: Authorization: Bearer {CRON_SECRET} (skipped if CRON_SECRET not set)

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runValuerGeneralIngestion({ nsw: true, vic: true, wa: true });

    return NextResponse.json({
      status: 'completed',
      sources: ['nsw-vg', 'vic-vg', 'wa-landgate'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/ingest-vg] Error:', message);
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 });
  }
}

// ─── GET /api/cron/ingest-vg?csvUrl=<url> ────────────────────────────────────
//
// Manually ingest a VIC Valuer-General individual property sales CSV file.
// Accepts the CSV URL as a query parameter so Stuart can trigger ingestion by
// pasting the download URL from:
//   https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics
//
// Filters rows to Casey / Cardinia postcodes before inserting.
//
// Example:
//   GET /api/cron/ingest-vg?csvUrl=https://s3.data.vic.gov.au/...quarterly_sales.csv
//
// Auth: same CRON_SECRET header as POST (skipped in dev)

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // One-time historical backfill: enumerate every download link the VIC
  // individual-sales statistics page exposes (not just the current quarter)
  // and ingest each. Deliberately a separate, explicit trigger from the
  // recurring cron — see plan docs/plans/2026-07-15-001-feat-vic-property-sales-history-plan.md.
  if (request.nextUrl.searchParams.get('backfill') === 'true') {
    console.log('[cron/ingest-vg] Manual VIC historical backfill triggered');
    const result = await backfillVicIndividualSalesHistory();
    return NextResponse.json({
      status: 'completed',
      source: 'vic-vg-backfill',
      ...result,
    });
  }

  const csvUrl = request.nextUrl.searchParams.get('csvUrl');

  if (!csvUrl) {
    return NextResponse.json(
      {
        error: 'csvUrl query param is required',
        hint: 'Pass the full URL to a VIC Valuer-General quarterly sales CSV. ' +
          'Download links are available at: ' +
          'https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics',
        postcodes: Array.from(CASEY_CARDINIA_POSTCODES).sort(),
      },
      { status: 400 },
    );
  }

  try {
    new URL(csvUrl); // validate it's a proper URL
  } catch {
    return NextResponse.json(
      { error: 'csvUrl is not a valid URL' },
      { status: 400 },
    );
  }

  console.log(`[cron/ingest-vg] Manual VIC CSV ingest from: ${csvUrl}`);

  const result = await ingestVicSalesCsvUrl(csvUrl);

  if (result.error) {
    return NextResponse.json(
      { status: 'failed', ...result },
      { status: 502 },
    );
  }

  return NextResponse.json({
    status: 'completed',
    source: 'vic-vg',
    csvUrl,
    ...result,
  });
}
