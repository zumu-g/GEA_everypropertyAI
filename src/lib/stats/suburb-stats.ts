/**
 * Suburb market statistics (KTD6, R14–R19, R26). computeBlock is pure; the
 * serve/persist layer around it reads frozen rows from suburb_stats_history and
 * recomputes open or unsettled periods on call.
 */
import { filterQualifyingSales, dedupeSales } from '@/lib/values/suburb-values';
import { propertyClass } from '@/lib/comps/property-class';
import { normaliseSuburbAlias } from '@/lib/utils/address';
import { median } from './median';
import { computeSentiment, type SentimentBasis, type SentimentInputs } from './sentiment';
import {
  addDays, melbourneDate, melbourneEndExclusive, melbourneStartOfDay, resolvePeriod,
  type PeriodBounds, type PeriodType,
} from './periods';
import {
  fetchListingsForStats, fetchPriceHistory, fetchRentalsForStats, fetchSalesForStats,
  getFrozenMonthlyRows, getStatsHistoryRow, upsertStatsHistory,
  type PriceHistoryRow, type StatsListingRow, type StatsRentalRow, type StatsSaleRow, type SuburbStatsHistoryRow,
} from '@/lib/db/stats-queries';

export const STATS_SCHEMA_VERSION = 1;
/** A closed period is provisional until this many days after its end (R17). */
export const SETTLE_DAYS = 60;
/** Two sweeps (a fortnight for REA) after go-live: closures inside this window are crawl noise, not withdrawals. */
export const SWEEP_EXCLUSION_DAYS = 14;
/** Lifecycle go-live (ISO date). Override with STATS_LIFECYCLE_GO_LIVE once Phase A ships. */
export const LIFECYCLE_GO_LIVE = process.env.STATS_LIFECYCLE_GO_LIVE ?? '2026-10-01';
const MIN_DENOMINATOR = 5;
const R21_MAX_DAYS = 400;
const CLEARANCE_WINDOW_DAYS = 14;
const TRAILING_SUPPLY_DAYS = 91; // ~3 months of sales for months-of-supply

export interface SuburbStatsBlock {
  activeListings: number;
  newListings: number;
  medianAsking: number | null;
  medianDaysOnMarket: number | null;
  priceCutCount: number;
  priceCutMedianPct: number | null;
  withdrawnCount: number;
  salesCount: number;
  medianSalePrice: number | null;
  medianSalePriceHouse: number | null;
  monthsOfSupply: number | null;
  saleToListRatio: number | null;
  auctionsHeld: number;
  auctionsCleared: number;
  auctionClearanceRate: number | null;
  privateSalesClosed: number;
  privateSalesSold: number;
  privateSaleConversionRate: number | null;
  rentalListings: number;
  medianRent: number | null;
  sentimentIndex: number | null;
  sentimentBasis: SentimentBasis;
}

export interface BlockInput {
  bounds: Pick<PeriodBounds, 'start' | 'end'>;
  goLive: string;
  listings: StatsListingRow[];
  rentals: StatsRentalRow[];
  history: PriceHistoryRow[];
  /** Sales from (end - TRAILING_SUPPLY_DAYS) to end inclusive. */
  sales: StatsSaleRow[];
  /** Trailing frozen months for the sentiment index; omitted = insufficient history. */
  sentimentHistory?: SentimentInputs[];
}

const DAY_MS = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Whole calendar days from one ISO date to another. */
const daysBetweenDates = (fromIso: string, toIso: string) => Math.round((ms(toIso) - ms(fromIso)) / DAY_MS);
const ratio = (num: number, den: number) => (den >= MIN_DENOMINATOR ? round2(num / den) : null);

function midpoint(low?: number | null, high?: number | null): number | null {
  if (low != null && high != null) return (low + high) / 2;
  return low ?? high ?? null;
}
function firstSeen(l: { listed_date?: string; campaign_started_at?: string; created_at?: string }): string | undefined {
  return l.campaign_started_at ?? l.created_at;
}
/** Days-on-market basis (R9): source listed date, else campaign start, else first sight. */
function domBasis(l: StatsListingRow): string | undefined {
  return l.listed_date ?? firstSeen(l);
}
function closedAt(l: { removed_at?: string | null; leased_at?: string | null; active?: boolean; last_seen_at?: string }): string | null {
  return l.removed_at ?? l.leased_at ?? (l.active === false ? l.last_seen_at ?? null : null);
}
const slugOf = (r: { address_slug?: string; raw_address: string }) =>
  r.address_slug ?? r.raw_address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function computeBlock(input: BlockInput): SuburbStatsBlock {
  const { bounds, listings, rentals, history, goLive } = input;
  const startMs = melbourneStartOfDay(bounds.start).getTime();
  const endExMs = melbourneEndExclusive(bounds.end).getTime();
  const exclusionEndMs = melbourneStartOfDay(addDays(goLive, SWEEP_EXCLUSION_DAYS)).getTime();
  const inPeriod = (iso: string | null | undefined) => iso != null && ms(iso) >= startMs && ms(iso) < endExMs;
  const inPeriodDate = (d: string | null | undefined) => d != null && d >= bounds.start && d <= bounds.end;

  // ── Listings ──
  const openAtEnd = (l: { lifecycle_status?: string | null } & Parameters<typeof firstSeen>[0] & Parameters<typeof closedAt>[0]) => {
    if (l.lifecycle_status === 'sold') return false;
    const seen = firstSeen(l);
    const closed = closedAt(l);
    return seen != null && ms(seen) < endExMs && (closed == null || ms(closed) >= endExMs);
  };
  const activeAtEnd = listings.filter(openAtEnd);
  const newListings = listings.filter((l) => inPeriod(firstSeen(l))).length;
  const medianAsking = median(activeAtEnd.map((l) => midpoint(l.price_low, l.price_high)).filter((v): v is number => v != null));
  const medianDaysOnMarket = median(
    activeAtEnd.map(domBasis).filter((d): d is string => d != null)
      .map((d) => Math.max(0, daysBetweenDates(melbourneDate(new Date(d)), bounds.end))),
  );
  const withdrawnCount = listings.filter((l) => {
    const c = closedAt(l);
    return l.lifecycle_status === 'withdrawn' && inPeriod(c) && ms(c!) >= exclusionEndMs;
  }).length;

  // ── Price history: cuts and last-midpoint-before-sale ──
  const byIdentity = new Map<string, PriceHistoryRow[]>();
  for (const h of history) {
    if (h.table_name !== 'listings') continue;
    const key = `${h.raw_address}|${h.source}`;
    (byIdentity.get(key) ?? byIdentity.set(key, []).get(key)!).push(h);
  }
  const cuts: number[] = [];
  for (const rows of byIdentity.values()) {
    rows.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    for (let i = 1; i < rows.length; i++) {
      const prev = midpoint(rows[i - 1].price_low, rows[i - 1].price_high);
      const next = midpoint(rows[i].price_low, rows[i].price_high);
      if (prev == null || next == null || prev <= 0 || next >= prev || !inPeriod(rows[i].observed_at)) continue;
      cuts.push(((prev - next) / prev) * 100);
    }
  }
  const priceCutMedian = median(cuts);

  // ── Sales ──
  const qualifying = dedupeSales(filterQualifyingSales(input.sales));
  const periodSales = qualifying.filter((s) => inPeriodDate(s.sale_date));
  const trailingSales = qualifying.filter((s) => s.sale_date! > addDays(bounds.end, -TRAILING_SUPPLY_DAYS) && s.sale_date! <= bounds.end);
  const meanMonthlySales = trailingSales.length / 3;
  const monthsOfSupply = meanMonthlySales > 0 ? round2(activeAtEnd.length / meanMonthlySales) : null;

  // R21 match: listing on the same slug first seen within 400 days before the sale.
  const listingsBySlug = new Map<string, StatsListingRow[]>();
  for (const l of listings) {
    const k = slugOf(l);
    (listingsBySlug.get(k) ?? listingsBySlug.set(k, []).get(k)!).push(l);
  }
  const matchListing = (sale: StatsSaleRow): StatsListingRow | undefined => {
    const saleMs = ms(sale.sale_date!);
    return (listingsBySlug.get(slugOf(sale)) ?? []).find((l) => {
      const seen = firstSeen(l);
      if (!seen) return false;
      const gap = (saleMs - ms(seen)) / DAY_MS;
      return gap >= 0 && gap <= R21_MAX_DAYS;
    });
  };
  const ratios: number[] = [];
  for (const s of periodSales) {
    const l = matchListing(s);
    if (!l) continue;
    const before = (byIdentity.get(`${l.raw_address}|${l.source}`) ?? []).filter((h) => ms(h.observed_at) < ms(s.sale_date!));
    const last = before.length ? midpoint(before[before.length - 1].price_low, before[before.length - 1].price_high) : null;
    if (last != null && last > 0) ratios.push(s.sale_price! / last);
  }
  const saleToListRatio = ratios.length >= MIN_DENOMINATOR ? round2(median(ratios)!) : null;

  // ── Auctions (R26) ──
  const salesBySlug = new Map<string, StatsSaleRow[]>();
  for (const s of qualifying) {
    const k = slugOf(s);
    (salesBySlug.get(k) ?? salesBySlug.set(k, []).get(k)!).push(s);
  }
  const auctions = listings.filter((l) => l.sale_method === 'auction' && inPeriodDate(l.auction_date));
  const cleared = auctions.filter((l) => {
    const deadline = addDays(l.auction_date!, CLEARANCE_WINDOW_DAYS);
    const deadlineMs = melbourneEndExclusive(deadline).getTime();
    const c = closedAt(l);
    if (l.lifecycle_status === 'sold' && (c == null || ms(c) < deadlineMs)) return true;
    // A sale clears the auction only if it lands inside the campaign: on/after
    // campaign start (else first sight, else auction − 30 days) and by the deadline.
    const seen = firstSeen(l);
    const campaignStart = seen != null ? melbourneDate(new Date(seen)) : addDays(l.auction_date!, -30);
    return (salesBySlug.get(slugOf(l)) ?? []).some((s) => s.sale_date! >= campaignStart && s.sale_date! <= deadline);
  });

  // ── Private sales (R26) ──
  const privateClosed = listings.filter((l) =>
    l.sale_method !== 'auction' && (l.lifecycle_status === 'sold' || l.lifecycle_status === 'withdrawn') && inPeriod(closedAt(l)));
  const privateSold = privateClosed.filter((l) => l.lifecycle_status === 'sold');

  // ── Rentals ──
  const rentalsAtEnd = rentals.filter(openAtEnd);

  const auctionClearanceRate = ratio(cleared.length, auctions.length);
  const block = {
    activeListings: activeAtEnd.length,
    newListings,
    medianAsking,
    medianDaysOnMarket,
    priceCutCount: cuts.length,
    priceCutMedianPct: priceCutMedian == null ? null : Math.round(priceCutMedian * 10) / 10,
    withdrawnCount,
    salesCount: periodSales.length,
    medianSalePrice: median(periodSales.map((s) => s.sale_price!)),
    medianSalePriceHouse: median(periodSales.filter((s) => propertyClass(s.property_type) === 'house').map((s) => s.sale_price!)),
    monthsOfSupply,
    saleToListRatio,
    auctionsHeld: auctions.length,
    auctionsCleared: cleared.length,
    auctionClearanceRate,
    privateSalesClosed: privateClosed.length,
    privateSalesSold: privateSold.length,
    privateSaleConversionRate: ratio(privateSold.length, privateClosed.length),
    rentalListings: rentalsAtEnd.length,
    medianRent: median(rentalsAtEnd.map((r) => r.weekly_rent).filter((v): v is number => v != null)),
  };
  return { ...block, ...computeSentiment(sentimentInputs(block), input.sentimentHistory ?? []) };
}

/** The five KTD7 inputs from a block; priceCutShare = cuts over active listings. */
export function sentimentInputs(b: Omit<SuburbStatsBlock, 'sentimentIndex' | 'sentimentBasis'>): SentimentInputs {
  return {
    saleToListRatio: b.saleToListRatio,
    monthsOfSupply: b.monthsOfSupply,
    priceCutShare: b.activeListings > 0 ? b.priceCutCount / b.activeListings : null,
    medianDaysOnMarket: b.medianDaysOnMarket,
    auctionClearanceRate: b.auctionClearanceRate,
  };
}

// ─── Serve / persist ──────────────────────────────────────────────────────────

export interface ServedBlock {
  block: SuburbStatsBlock;
  provisional: boolean;
  reconstructed: boolean;
  computedAt: string;
}

export interface SuburbStatsResponse {
  suburb: string;
  state: string;
  period: PeriodType;
  periodStart: string;
  periodEnd: string;
  current: SuburbStatsBlock;
  prior: SuburbStatsBlock | null;
  yearAgo: SuburbStatsBlock | null;
  provisional: boolean;
  reconstructed: boolean;
  computedAt: string;
  schemaVersion: number;
}

async function computeFromDb(suburb: string, state: string, start: string, end: string): Promise<SuburbStatsBlock> {
  const endEx = melbourneEndExclusive(end).toISOString();
  const [listings, rentals, sales, frozen] = await Promise.all([
    fetchListingsForStats(suburb, state, endEx),
    fetchRentalsForStats(suburb, state, endEx),
    fetchSalesForStats(suburb, state, addDays(end, -TRAILING_SUPPLY_DAYS), end),
    getFrozenMonthlyRows(suburb, state, addDays(start.slice(0, 7) + '-01', -366), start),
  ]);
  const history = await fetchPriceHistory([...new Set(listings.map((l) => l.raw_address))], endEx);
  const sentimentHistory = frozen.slice(-12).map((r) => sentimentInputs(r.stats as unknown as SuburbStatsBlock));
  return computeBlock({ bounds: { start, end }, goLive: LIFECYCLE_GO_LIVE, listings, rentals, history, sales, sentimentHistory });
}

/** Serve rule (KTD6/R17/R18): frozen row wins; otherwise compute, flag, upsert. */
export async function computeAndPersist(
  suburb: string, state: string, periodType: PeriodType, start: string, end: string, now: Date = new Date(),
): Promise<ServedBlock> {
  const existing = await getStatsHistoryRow(suburb, state, periodType, start);
  if (existing && !existing.provisional) {
    return { block: existing.stats as unknown as SuburbStatsBlock, provisional: false, reconstructed: existing.reconstructed, computedAt: existing.computed_at };
  }
  const block = await computeFromDb(suburb, state, start, end);
  const settleMs = melbourneEndExclusive(end).getTime() + SETTLE_DAYS * DAY_MS;
  const provisional = settleMs > now.getTime();
  const reconstructed = end < addDays(LIFECYCLE_GO_LIVE, SWEEP_EXCLUSION_DAYS);
  const computedAt = now.toISOString();
  const row: SuburbStatsHistoryRow = {
    suburb, state, period_type: periodType, period_start: start, period_end: end,
    stats: block as unknown as Record<string, unknown>,
    provisional, reconstructed, computed_at: computedAt, schema_version: STATS_SCHEMA_VERSION,
  };
  await upsertStatsHistory(row);
  return { block, provisional, reconstructed, computedAt };
}

const isEmpty = (b: SuburbStatsBlock) => b.activeListings === 0 && b.salesCount === 0 && b.rentalListings === 0 && b.newListings === 0;

export async function getSuburbStats(
  suburbRaw: string, state: string, period: PeriodType, asOf: string = melbourneDate(), now: Date = new Date(),
): Promise<SuburbStatsResponse> {
  const suburb = normaliseSuburbAlias(suburbRaw);
  const b = resolvePeriod(period, asOf);
  const [current, prior, yearAgo] = await Promise.all([
    computeAndPersist(suburb, state, period, b.start, b.end, now),
    computeAndPersist(suburb, state, period, b.priorStart, b.priorEnd, now),
    computeAndPersist(suburb, state, period, b.yearAgoStart, b.yearAgoEnd, now),
  ]);
  return {
    suburb, state, period, periodStart: b.start, periodEnd: b.end,
    current: current.block,
    prior: isEmpty(prior.block) ? null : prior.block,
    yearAgo: isEmpty(yearAgo.block) ? null : yearAgo.block,
    provisional: current.provisional,
    reconstructed: current.reconstructed,
    computedAt: current.computedAt,
    schemaVersion: STATS_SCHEMA_VERSION,
  };
}
