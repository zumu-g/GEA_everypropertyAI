import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getSupabaseServerClient } from '@/lib/db/supabase';
import { classifyFreshness, anyUnhealthy, type FeedCategory } from '@/lib/feeds/freshness';

/**
 * GET /api/cron/feed-freshness
 *
 * Scheduled health check: for each feed (sold | on-market | rent) compares the
 * newest row's created_at to the feed's SLA window. Returns 200 when all feeds are
 * fresh, and a non-2xx (503) when any feed is stale / never populated — so the
 * scheduler's failure-alert fires (same pattern as the ingest route's blocked 502).
 * Pairs with feed_health (migration 007) for blocked-vs-broken context.
 *
 * Auth: ?token= or x-ingest-token must equal INGEST_SECRET (or CRON_SECRET).
 */
const FEEDS: { category: FeedCategory; table: string }[] = [
  { category: 'sold', table: 'property_sales' },
  { category: 'on-market', table: 'property_listings' },
  { category: 'rent', table: 'property_rentals' },
];

export async function GET(request: NextRequest) {
  const secret = process.env.INGEST_SECRET ?? process.env.CRON_SECRET;
  const token = request.nextUrl.searchParams.get('token') ?? request.headers.get('x-ingest-token');
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  const now = Date.now();

  const feeds = await Promise.all(
    FEEDS.map(async ({ category, table }) => {
      const { data } = await supabase
        .from(table)
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newest = (data as { created_at?: string } | null)?.created_at ?? null;
      return classifyFreshness(category, newest, now);
    }),
  );

  const unhealthy = anyUnhealthy(feeds);
  return NextResponse.json(
    {
      checkedAt: new Date(now).toISOString(),
      healthy: !unhealthy,
      feeds,
      // Surface the actionable subset prominently for the alert payload.
      attention: feeds.filter((f) => f.status !== 'fresh'),
    },
    { status: unhealthy ? 503 : 200 },
  );
}
