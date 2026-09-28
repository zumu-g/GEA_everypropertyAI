import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';

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
  const { data, error } = await getSupabaseServerClient()
    .from('listing_price_history')
    .select('raw_address, source, observed_at, display_price, price_low, price_high')
    .eq('table_name', table)
    .in('raw_address', addresses)
    .in('source', sources)
    .order('observed_at', { ascending: true });
  if (error) { console.error('[getPriceHistoryFor]', error.message); return out; }
  for (const h of data ?? []) {
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
