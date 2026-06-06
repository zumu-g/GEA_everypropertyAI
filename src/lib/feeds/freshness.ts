// Feed-freshness SLA logic — pure functions so the staleness rules are testable
// without a DB. A feed is "stale" when its newest row is older than the SLA window
// for its category (or when there is no data at all).

export type FeedCategory = 'sold' | 'on-market' | 'rent';
export type FreshnessStatus = 'fresh' | 'stale' | 'no-data';

/** Max acceptable age of a feed's newest row before it's considered stale. */
export const FEED_SLA_HOURS: Record<FeedCategory, number> = {
  sold: 36,        // daily feed + headroom for a missed run
  'on-market': 36, // daily feed
  rent: 192,       // weekly feed (8 days)
};

export interface FeedFreshness {
  category: FeedCategory;
  newestRowAt: string | null;
  ageHours: number | null;
  slaHours: number;
  status: FreshnessStatus;
}

/**
 * Classify a feed's freshness from its newest-row timestamp.
 * - no-data: never ingested anything
 * - stale:   newest row older than the SLA window
 * - fresh:   within the window
 */
export function classifyFreshness(
  category: FeedCategory,
  newestRowAt: string | null,
  now: number,
): FeedFreshness {
  const slaHours = FEED_SLA_HOURS[category];
  if (!newestRowAt) {
    return { category, newestRowAt: null, ageHours: null, slaHours, status: 'no-data' };
  }
  const t = new Date(newestRowAt).getTime();
  if (!Number.isFinite(t)) {
    return { category, newestRowAt, ageHours: null, slaHours, status: 'no-data' };
  }
  const ageHours = (now - t) / 3_600_000;
  return {
    category,
    newestRowAt,
    ageHours,
    slaHours,
    status: ageHours > slaHours ? 'stale' : 'fresh',
  };
}

/** True when any feed needs attention (stale or never populated). */
export function anyUnhealthy(feeds: FeedFreshness[]): boolean {
  return feeds.some((f) => f.status !== 'fresh');
}
