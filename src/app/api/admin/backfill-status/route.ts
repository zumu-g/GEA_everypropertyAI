import { NextResponse } from 'next/server';
import { isSupabaseConfigured, getSupabaseServerClient } from '@/lib/db/supabase';
import { getSuburbSalesCounts, getSuburbAddressCounts, getSuburbProgress } from '@/lib/db/queries';
import { CASEY_CARDINIA_POSTCODES, STATE } from '@/data/casey-cardinia';

/**
 * GET /api/admin/backfill-status
 *
 * Casey/Cardinia backfill dashboard: suburbs ranked by VG sales count, each with
 * its crawl progress (last_crawled / next_due), plus global queue + cache stats.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayIso = startOfDay.toISOString();

  try {
    // Prefer the addresses universe for ranking; fall back to sales counts.
    let ranked = await getSuburbAddressCounts(STATE, CASEY_CARDINIA_POSTCODES);
    let rankedBy: 'addresses' | 'sales' = 'addresses';
    if (ranked.length === 0) {
      ranked = await getSuburbSalesCounts(STATE, CASEY_CARDINIA_POSTCODES);
      rankedBy = 'sales';
    }

    const [progress, queuePending, queueFailed, profilesToday, cacheTotal] =
      await Promise.all([
        getSuburbProgress(STATE),
        supabase.from('crawl_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('crawl_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase
          .from('crawl_queue')
          .select('id', { count: 'exact', head: true })
          .eq('job_type', 'property-profile')
          .gte('created_at', todayIso),
        supabase.from('property_cache').select('address_slug', { count: 'exact', head: true }),
      ]);

    const progressBySuburb = new Map(progress.map((p) => [p.suburb.toLowerCase(), p]));

    const suburbs = ranked.map((r) => {
      const p = progressBySuburb.get(r.suburb.toLowerCase());
      return {
        suburb: r.suburb,
        postcode: r.postcode,
        count: r.count,
        lastCrawled: (p as { last_crawled?: string } | undefined)?.last_crawled ?? null,
        nextDue: p?.next_due ?? null,
        started: Boolean(p),
      };
    });

    return NextResponse.json({
      rankedBy,
      suburbs,
      totals: {
        suburbs: suburbs.length,
        records: suburbs.reduce((n, s) => n + s.count, 0),
        cachedProfiles: cacheTotal.count ?? 0,
      },
      queue: {
        pending: queuePending.count ?? 0,
        failed: queueFailed.count ?? 0,
        profileJobsEnqueuedToday: profilesToday.count ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[backfill-status] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
