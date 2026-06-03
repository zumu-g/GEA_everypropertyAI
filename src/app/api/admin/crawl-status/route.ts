import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getSupabaseServerClient } from '@/lib/db/supabase';
import { propertyCache } from '@/lib/cache';

/**
 * GET /api/admin/crawl-status
 *
 * Returns a JSON dashboard of the crawl system state, including queue stats,
 * suburb progress, agency counts, property sales totals, and cache size.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Run all queries in parallel
    const [
      queuePending,
      queueRunning,
      queueFailed,
      queueCompletedToday,
      suburbsTotalVic,
      suburbsCrawledLast7Days,
      suburbsOverdue,
      agenciesTotal,
      agenciesVerified,
      agenciesDisabled,
      salesTotal,
      salesNsw,
      salesWa,
      salesVic,
    ] = await Promise.all([
      // Queue: pending
      supabase
        .from('crawl_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),

      // Queue: running
      supabase
        .from('crawl_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running'),

      // Queue: failed
      supabase
        .from('crawl_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),

      // Queue: completed today
      supabase
        .from('crawl_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('updated_at', todayIso),

      // Suburbs: total VIC in progress table
      supabase
        .from('suburb_crawl_progress')
        .select('suburb', { count: 'exact', head: true })
        .eq('state', 'VIC'),

      // Suburbs: crawled in last 7 days
      supabase
        .from('suburb_crawl_progress')
        .select('suburb', { count: 'exact', head: true })
        .eq('state', 'VIC')
        .gte('last_crawled', sevenDaysAgo),

      // Suburbs: overdue (next_due is in the past or null)
      supabase
        .from('suburb_crawl_progress')
        .select('suburb', { count: 'exact', head: true })
        .eq('state', 'VIC')
        .or(`next_due.is.null,next_due.lte.${new Date().toISOString()}`),

      // Agencies: total enabled
      supabase
        .from('agencies')
        .select('id', { count: 'exact', head: true }),

      // Agencies: verified
      supabase
        .from('agencies')
        .select('id', { count: 'exact', head: true })
        .eq('url_verified', true),

      // Agencies: disabled
      supabase
        .from('agencies')
        .select('id', { count: 'exact', head: true })
        .eq('enabled', false),

      // Property sales: total
      supabase
        .from('property_sales')
        .select('id', { count: 'exact', head: true }),

      // Property sales: NSW VG
      supabase
        .from('property_sales')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'nsw-vg'),

      // Property sales: WA Landgate
      supabase
        .from('property_sales')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'wa-landgate'),

      // Property sales: VIC VG aggregate
      supabase
        .from('property_sales')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'vic-vg-aggregate'),
    ]);

    return NextResponse.json({
      queue: {
        pending: queuePending.count ?? 0,
        running: queueRunning.count ?? 0,
        failed: queueFailed.count ?? 0,
        completed_today: queueCompletedToday.count ?? 0,
      },
      suburbs: {
        total_vic: suburbsTotalVic.count ?? 0,
        crawled_last_7_days: suburbsCrawledLast7Days.count ?? 0,
        overdue: suburbsOverdue.count ?? 0,
      },
      agencies: {
        total: agenciesTotal.count ?? 0,
        verified: agenciesVerified.count ?? 0,
        disabled: agenciesDisabled.count ?? 0,
      },
      property_sales: {
        total: salesTotal.count ?? 0,
        nsw_vg: salesNsw.count ?? 0,
        wa_landgate: salesWa.count ?? 0,
        vic_vg: salesVic.count ?? 0,
      },
      cache: {
        in_memory_size: propertyCache.size,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[crawl-status] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
