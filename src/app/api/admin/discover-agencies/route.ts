import { NextRequest, NextResponse } from 'next/server';
import { runAgencyDiscovery } from '@/lib/jobs/discover-agencies';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/db/supabase';

// ─── Auth ────────────────────────────────────────────────────────────────────

const CRON_SECRET = process.env.CRON_SECRET ?? '';

function isAuthorized(request: NextRequest): boolean {
  // Dev mode: skip auth when no secret is configured
  if (!CRON_SECRET) return true;

  const auth = request.headers.get('authorization');
  return auth === `Bearer ${CRON_SECRET}`;
}

// ─── CORS ────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── POST /api/admin/discover-agencies ───────────────────────────────────────
// Triggers the agency discovery job.

let isRunning = false;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  if (isRunning) {
    return NextResponse.json(
      { error: 'Discovery job is already running' },
      { status: 409, headers: CORS_HEADERS }
    );
  }

  isRunning = true;

  try {
    await runAgencyDiscovery();

    // Count agencies saved (best-effort — ignore errors)
    let count = 0;
    if (isSupabaseConfigured()) {
      try {
        const { count: c } = await getSupabaseServerClient()
          .from('agencies')
          .select('*', { count: 'exact', head: true });
        count = c ?? 0;
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json(
      {
        discovered: count,
        message: `Agency discovery complete. ${count} agencies in database.`,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[POST /api/admin/discover-agencies]', message);
    return NextResponse.json(
      { error: `Discovery job failed: ${message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  } finally {
    isRunning = false;
  }
}

// ─── GET /api/admin/discover-agencies ────────────────────────────────────────
// Returns agency count from the database, broken down by state.

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        message: 'Supabase not configured — using hardcoded agency list.',
        counts: {},
        total: 0,
      },
      { headers: CORS_HEADERS }
    );
  }

  try {
    const client = getSupabaseServerClient();

    // Total count
    const { count: total, error: totalError } = await client
      .from('agencies')
      .select('*', { count: 'exact', head: true });

    if (totalError) {
      throw new Error(totalError.message);
    }

    // Count by state
    const { data: byState, error: stateError } = await client
      .from('agencies')
      .select('state')
      .eq('enabled', true);

    if (stateError) {
      throw new Error(stateError.message);
    }

    const counts: Record<string, number> = {};
    for (const row of byState ?? []) {
      const st = (row as { state: string }).state ?? 'unknown';
      counts[st] = (counts[st] ?? 0) + 1;
    }

    return NextResponse.json(
      {
        configured: true,
        total: total ?? 0,
        enabled: byState?.length ?? 0,
        counts,
        isRunning,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[GET /api/admin/discover-agencies]', message);
    return NextResponse.json(
      { error: `Failed to query agencies: ${message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
