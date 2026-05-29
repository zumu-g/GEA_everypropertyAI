/**
 * Casey & Cardinia backfill orchestrator.
 *
 * Walks the Casey/Cardinia suburbs in "biggest first" order (ranked by
 * property_sales count), enumerates each suburb's addresses from property_sales,
 * skips any already cached, and enqueues `property-profile` crawl jobs — within
 * a per-suburb cap and a global daily cap to contain spend. The existing
 * crawl-queue worker (cron, every 15 min) drains the jobs.
 */

import type { StructuredAddress } from '@/types/property';
import { toSlug } from '@/lib/utils/address';
import { CASEY_CARDINIA_POSTCODES, STATE } from '@/data/casey-cardinia';
import {
  getSuburbSalesCounts,
  getSalesAddressesForSuburb,
  getSuburbAddressCounts,
  getAddressesForSuburb,
  getSuburbProgress,
  getCachedProfilesBySlugs,
  countRecentJobs,
  enqueueJob,
  markSuburbCrawled,
} from '@/lib/db/queries';

export interface BackfillOptions {
  /** Max addresses to enqueue for a single suburb in one tick. */
  perSuburbCap?: number;
  /** Max property-profile jobs to enqueue per UTC day across all suburbs. */
  dailyCap?: number;
  /** Force a specific suburb instead of picking the next ranked one. */
  suburb?: string;
}

export interface BackfillResult {
  suburb: string | null;
  enqueued: number;
  skippedCached: number;
  remainingInSuburb: number;
  dailyUsed: number;
  dailyCap: number;
  reason?: string;
}

const DEFAULT_PER_SUBURB = Number(process.env.BACKFILL_PER_SUBURB_CAP ?? 25);
const DEFAULT_DAILY = Number(process.env.BACKFILL_DAILY_CAP ?? 100);

/**
 * Parse a VG `raw_address` ("12 Smith Street Cranbourne VIC 3977") into a
 * StructuredAddress. Best-effort; the slug is recomputed for consistency.
 */
function parseRawAddress(raw: string, fallbackSuburb?: string, fallbackPostcode?: string): StructuredAddress | null {
  const m = raw.match(
    /^(\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?)\s+(.+?)\s+([A-Za-z' ]+?)\s+(VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})\s*$/i
  );
  if (m) {
    const streetTokens = m[2].trim().split(/\s+/);
    const streetType = streetTokens.length > 1 ? streetTokens[streetTokens.length - 1] : '';
    const streetName = streetTokens.length > 1 ? streetTokens.slice(0, -1).join(' ') : m[2].trim();
    return {
      streetNumber: m[1],
      streetName,
      streetType,
      suburb: m[3].trim(),
      state: m[4].toUpperCase(),
      postcode: m[5],
      displayAddress: raw,
    };
  }
  // Fallback: leading number + remainder as street name
  const n = raw.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
  if (n && fallbackSuburb) {
    return {
      streetNumber: n[1],
      streetName: n[2].replace(new RegExp(`\\s*${fallbackSuburb}.*$`, 'i'), '').trim() || n[2],
      streetType: '',
      suburb: fallbackSuburb,
      state: STATE,
      postcode: fallbackPostcode ?? '',
      displayAddress: raw,
    };
  }
  return null;
}

function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function runBackfillTick(opts: BackfillOptions = {}): Promise<BackfillResult> {
  const perSuburbCap = opts.perSuburbCap ?? DEFAULT_PER_SUBURB;
  const dailyCap = opts.dailyCap ?? DEFAULT_DAILY;

  // Global daily budget remaining
  const dailyUsed = await countRecentJobs('property-profile', startOfUtcDayIso());
  const dailyRemaining = Math.max(0, dailyCap - dailyUsed);
  if (dailyRemaining === 0) {
    return { suburb: null, enqueued: 0, skippedCached: 0, remainingInSuburb: 0, dailyUsed, dailyCap, reason: 'daily-cap-reached' };
  }

  // Choose target suburb
  let targetSuburb = opts.suburb ?? null;
  if (!targetSuburb) {
    // Prefer the addresses universe (G-NAF) for ranking; fall back to sales.
    let ranked = await getSuburbAddressCounts(STATE, CASEY_CARDINIA_POSTCODES);
    if (ranked.length === 0) ranked = await getSuburbSalesCounts(STATE, CASEY_CARDINIA_POSTCODES);
    if (ranked.length === 0) {
      return { suburb: null, enqueued: 0, skippedCached: 0, remainingInSuburb: 0, dailyUsed, dailyCap, reason: 'no-address-data' };
    }
    const progress = await getSuburbProgress(STATE);
    const now = Date.now();
    const doneUntil = new Map(progress.map((p) => [p.suburb.toLowerCase(), p.next_due ? new Date(p.next_due).getTime() : 0]));
    // Highest-ranked suburb that has no progress row or is due again
    const next = ranked.find((r) => {
      const due = doneUntil.get(r.suburb.toLowerCase());
      return due === undefined || due <= now;
    });
    if (!next) {
      return { suburb: null, enqueued: 0, skippedCached: 0, remainingInSuburb: 0, dailyUsed, dailyCap, reason: 'all-suburbs-current' };
    }
    targetSuburb = next.suburb;
  }

  // Enumerate addresses for the suburb — prefer the addresses universe (G-NAF,
  // structured components, no parsing). Fall back to property_sales addresses.
  const addrRows = await getAddressesForSuburb(targetSuburb, STATE);
  let parsed: Array<{ addr: StructuredAddress; slug: string }>;
  let postcodeForProgress = '';

  if (addrRows.length > 0) {
    postcodeForProgress = addrRows[0].postcode ?? '';
    parsed = addrRows.map((a) => {
      const addr: StructuredAddress = {
        streetNumber: a.street_number ?? '',
        streetName: a.street_name ?? '',
        streetType: a.street_type ?? '',
        suburb: a.suburb ?? targetSuburb!,
        state: a.state,
        postcode: a.postcode ?? '',
        displayAddress: a.raw_address,
      };
      return { addr, slug: a.address_slug ?? toSlug(addr) };
    });
  } else {
    const salesAddrs = await getSalesAddressesForSuburb(targetSuburb, STATE);
    if (salesAddrs.length === 0) {
      await markSuburbCrawled(targetSuburb, STATE, '', 0);
      return { suburb: targetSuburb, enqueued: 0, skippedCached: 0, remainingInSuburb: 0, dailyUsed, dailyCap, reason: 'no-addresses' };
    }
    postcodeForProgress = salesAddrs[0]?.postcode ?? '';
    parsed = salesAddrs
      .map((a) => {
        const addr = parseRawAddress(a.raw_address, a.suburb, a.postcode);
        if (!addr) return null;
        return { addr, slug: a.address_slug ?? toSlug(addr) };
      })
      .filter((x): x is { addr: StructuredAddress; slug: string } => x !== null);
  }

  const totalAddresses = parsed.length;

  // Skip already-cached addresses (no double spend)
  const cached = await getCachedProfilesBySlugs(parsed.map((p) => p.slug));
  const uncached = parsed.filter((p) => !cached.has(p.slug));
  const skippedCached = parsed.length - uncached.length;

  // Enqueue within both caps
  const budget = Math.min(perSuburbCap, dailyRemaining);
  const toEnqueue = uncached.slice(0, budget);
  for (const { addr } of toEnqueue) {
    await enqueueJob({ job_type: 'property-profile', payload: { address: addr }, priority: 5 });
  }

  const remainingInSuburb = uncached.length - toEnqueue.length;
  // Mark the suburb done only once everything is enqueued; otherwise leave it
  // due so the next tick continues it.
  if (remainingInSuburb === 0) {
    await markSuburbCrawled(targetSuburb, STATE, postcodeForProgress, totalAddresses);
  } else {
    // keep it due immediately for the next tick
    await markSuburbCrawled(targetSuburb, STATE, postcodeForProgress, totalAddresses, 0);
  }

  return {
    suburb: targetSuburb,
    enqueued: toEnqueue.length,
    skippedCached,
    remainingInSuburb,
    dailyUsed: dailyUsed + toEnqueue.length,
    dailyCap,
  };
}
