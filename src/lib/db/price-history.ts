import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';
import { fetchListingsForStats, fetchRentalsForStats } from './stats-queries';

export interface PriceHistoryEntry {
  observedAt: string;
  displayPrice: string | null;
  priceLow: number | null;
  priceHigh: number | null;
}

export const priceHistoryKey = (r: { raw_address: string; source: string }) => `${r.raw_address}|${r.source}`;

/**
 * One batched read of listing_price_history for a page of listing rows, keyed
 * `${raw_address}|${source}` → observations oldest first (R12). Missing table
 * (pre-015) or any error → empty map; the routes then emit priceHistory: [].
 */
export async function getPriceHistoryFor(
  table: 'listings' | 'rentals',
  rows: { raw_address: string; source: string }[],
): Promise<Map<string, PriceHistoryEntry[]>> {
  const out = new Map<string, PriceHistoryEntry[]>();
  if (!isSupabaseConfigured() || rows.length === 0) return out;
  const addresses = [...new Set(rows.map((r) => r.raw_address))];
  const sources = [...new Set(rows.map((r) => r.source))];
  // ponytail: address IN + source IN over-fetches across sources; exact pair filter if it ever matters.
  const PAGE = 1000;
  const data: { raw_address: string; source: string; observed_at: string; display_price: string | null; price_low: number | null; price_high: number | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await getSupabaseServerClient()
      .from('listing_price_history')
      .select('raw_address, source, observed_at, display_price, price_low, price_high')
      .eq('table_name', table)
      .in('raw_address', addresses)
      .in('source', sources)
      .order('observed_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('[getPriceHistoryFor]', error.message); return out; }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }
  for (const h of data) {
    const key = priceHistoryKey(h);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({
      observedAt: h.observed_at,
      displayPrice: h.display_price ?? null,
      priceLow: h.price_low === null || h.price_low === undefined ? null : Number(h.price_low),
      priceHigh: h.price_high === null || h.price_high === undefined ? null : Number(h.price_high),
    });
  }
  return out;
}

export interface PriceChange {
  listingUrl: string | null;
  address: string;
  suburb: string;
  table: 'listings' | 'rentals';
  previousDisplayPrice: string | null;
  currentDisplayPrice: string | null;
  previousMid: number;
  currentMid: number;
  /** Midpoint change, one decimal place. */
  changePct: number;
  changedAt: string;
  priceHistory: PriceHistoryEntry[];
}

const midpoint = (h: PriceHistoryEntry) => (h.priceLow === null || h.priceHigh === null ? null : (h.priceLow + h.priceHigh) / 2);

/**
 * Asking-price changes in a suburb inside the last `sinceDays` (R13). Every
 * listing identity (both feed tables, active and closed) with ≥2 observations
 * whose latest observation is in the window; the latest row is paired with its
 * predecessor and kept only when both midpoints exist and differ. Newest first.
 */
export async function getPriceChanges(suburb: string, state: string, sinceDays: number): Promise<PriceChange[]> {
  const nowIso = new Date().toISOString();
  const sinceMs = Date.now() - sinceDays * 86_400_000;
  const [listings, rentals] = await Promise.all([
    fetchListingsForStats(suburb, state, nowIso),
    fetchRentalsForStats(suburb, state, nowIso),
  ]);
  const out: PriceChange[] = [];
  for (const [table, rows] of [['listings', listings], ['rentals', rentals]] as const) {
    const byKey = new Map(rows.map((r) => [priceHistoryKey(r), r]));
    // ponytail: 200-address chunks, same as fetchPriceHistory; a suburb view would make this one query.
    const rowList = [...byKey.values()];
    for (let i = 0; i < rowList.length; i += 200) {
      const history = await getPriceHistoryFor(table, rowList.slice(i, i + 200));
      for (const [key, obs] of history) {
        const row = byKey.get(key);
        if (!row || obs.length < 2) continue;
        const cur = obs[obs.length - 1];
        const prev = obs[obs.length - 2];
        if (new Date(cur.observedAt).getTime() < sinceMs) continue;
        const curMid = midpoint(cur);
        const prevMid = midpoint(prev);
        if (curMid === null || prevMid === null || prevMid === 0 || curMid === prevMid) continue;
        out.push({
          listingUrl: row.listing_url ?? null,
          address: row.raw_address,
          suburb: row.suburb ?? suburb,
          table,
          previousDisplayPrice: prev.displayPrice,
          currentDisplayPrice: cur.displayPrice,
          previousMid: prevMid,
          currentMid: curMid,
          changePct: Math.round(((curMid - prevMid) / prevMid) * 1000) / 10,
          changedAt: cur.observedAt,
          priceHistory: obs,
        });
      }
    }
  }
  return out.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}
