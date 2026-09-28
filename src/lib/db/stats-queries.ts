/**
 * DB access for suburb market statistics (U8). Kept out of queries.ts so the
 * stats module has one small dependency surface: period-bounded fetches of the
 * feed tables plus read/upsert of suburb_stats_history on its natural key.
 */
import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';
import { normaliseSuburbAlias } from '@/lib/utils/address';
import type { PropertyListingRecord, PropertyRentalRecord, PropertySaleRecord } from './queries';

function supabase() {
  return getSupabaseServerClient();
}

/** property_listings row with the migration-015 lifecycle columns. */
export type StatsListingRow = PropertyListingRecord & {
  lifecycle_status?: 'active' | 'under_offer' | 'sold' | 'withdrawn';
  removed_at?: string | null;
  campaign_started_at?: string;
  sale_method?: 'auction' | 'private' | 'unknown';
  auction_date?: string | null;
};

export type StatsRentalRow = PropertyRentalRecord & {
  lifecycle_status?: 'active' | 'under_offer' | 'sold' | 'withdrawn';
  leased_at?: string | null;
  campaign_started_at?: string;
};

export type StatsSaleRow = PropertySaleRecord;

export interface PriceHistoryRow {
  table_name: 'listings' | 'rentals';
  raw_address: string;
  source: string;
  observed_at: string;
  price_low?: number | null;
  price_high?: number | null;
}

export interface SuburbStatsHistoryRow {
  suburb: string;
  state: string;
  period_type: 'week' | 'month';
  period_start: string;
  period_end: string;
  stats: Record<string, unknown>;
  provisional: boolean;
  reconstructed: boolean;
  computed_at: string;
  schema_version: number;
}

const PAGE = 1000;
const MAX_PAGES = 50;

async function pageAll<T>(label: string, build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  if (!isSupabaseConfigured()) return [];
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { console.error(`[${label}]`, error.message); break; }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Every listing row for the suburb first seen before `beforeIso` (R21 matching needs up to 400 days of history). */
export function fetchListingsForStats(suburb: string, state: string, beforeIso: string): Promise<StatsListingRow[]> {
  return pageAll('fetchListingsForStats', (from, to) =>
    supabase().from('property_listings').select('*')
      .ilike('suburb', normaliseSuburbAlias(suburb)).eq('state', state.toUpperCase())
      .lt('created_at', beforeIso).range(from, to));
}

export function fetchRentalsForStats(suburb: string, state: string, beforeIso: string): Promise<StatsRentalRow[]> {
  return pageAll('fetchRentalsForStats', (from, to) =>
    supabase().from('property_rentals').select('*')
      .ilike('suburb', normaliseSuburbAlias(suburb)).eq('state', state.toUpperCase())
      .lt('created_at', beforeIso).range(from, to));
}

/** Price observations for the given listing addresses (history has no suburb column). */
export async function fetchPriceHistory(rawAddresses: string[], beforeIso: string): Promise<PriceHistoryRow[]> {
  if (!isSupabaseConfigured() || rawAddresses.length === 0) return [];
  const out: PriceHistoryRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < rawAddresses.length; i += CHUNK) {
    const chunk = rawAddresses.slice(i, i + CHUNK);
    out.push(...await pageAll<PriceHistoryRow>('fetchPriceHistory', (from, to) =>
      supabase().from('listing_price_history').select('*')
        .eq('table_name', 'listings').in('raw_address', chunk).lt('observed_at', beforeIso)
        .order('observed_at', { ascending: true }).range(from, to)));
  }
  return out;
}

export function fetchSalesForStats(suburb: string, state: string, fromDate: string, toDate: string): Promise<StatsSaleRow[]> {
  return pageAll('fetchSalesForStats', (from, to) =>
    supabase().from('property_sales').select('*')
      .ilike('suburb', normaliseSuburbAlias(suburb)).eq('state', state.toUpperCase())
      .gte('sale_date', fromDate).lte('sale_date', toDate).range(from, to));
}

export async function getStatsHistoryRow(
  suburb: string, state: string, periodType: 'week' | 'month', periodStart: string,
): Promise<SuburbStatsHistoryRow | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase().from('suburb_stats_history').select('*')
    .eq('suburb', suburb).eq('state', state).eq('period_type', periodType).eq('period_start', periodStart)
    .maybeSingle();
  if (error) { console.error('[getStatsHistoryRow]', error.message); return null; }
  return data ?? null;
}

/** Frozen (non-provisional, non-reconstructed) monthly rows with period_start in [fromStart, beforeStart). */
export async function getFrozenMonthlyRows(
  suburb: string, state: string, fromStart: string, beforeStart: string,
): Promise<SuburbStatsHistoryRow[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase().from('suburb_stats_history').select('*')
    .eq('suburb', suburb).eq('state', state).eq('period_type', 'month')
    .eq('provisional', false).eq('reconstructed', false)
    .gte('period_start', fromStart).lt('period_start', beforeStart)
    .order('period_start', { ascending: true });
  if (error) { console.error('[getFrozenMonthlyRows]', error.message); return []; }
  return data ?? [];
}

export async function upsertStatsHistory(row: SuburbStatsHistoryRow): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase().from('suburb_stats_history')
    .upsert(row, { onConflict: 'suburb,state,period_type,period_start' });
  if (error) console.error('[upsertStatsHistory]', error.message);
}
