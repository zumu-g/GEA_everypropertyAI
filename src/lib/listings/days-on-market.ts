/**
 * Days on market, derived on read (KTD5 / R9). Never stored.
 *
 * Basis = listed_date ?? campaign_started_at ?? created_at, labelled 'listed'
 * when listed_date supplied it, else 'first_seen'. Closing timestamp for a
 * closed row = removed_at (sales) or leased_at (rentals); active rows use `now`.
 */
export type DaysOnMarketBasis = 'listed' | 'first_seen';

export interface LifecycleColumns {
  listed_date?: string | null;
  campaign_started_at?: string | null;
  created_at?: string | null;
  removed_at?: string | null;
  leased_at?: string | null;
}

export function daysOnMarket(
  row: LifecycleColumns,
  now: Date = new Date(),
): { daysOnMarket: number | null; daysOnMarketBasis: DaysOnMarketBasis } {
  const basisIso = row.listed_date ?? row.campaign_started_at ?? row.created_at ?? null;
  const daysOnMarketBasis: DaysOnMarketBasis = row.listed_date ? 'listed' : 'first_seen';
  const start = basisIso ? new Date(basisIso).getTime() : NaN;
  const closeIso = row.removed_at ?? row.leased_at ?? null;
  const end = closeIso ? new Date(closeIso).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { daysOnMarket: null, daysOnMarketBasis };
  return { daysOnMarket: Math.max(0, Math.floor((end - start) / 86_400_000)), daysOnMarketBasis };
}
