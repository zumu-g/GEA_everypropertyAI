/**
 * Market-time adjustment of historical sale prices to "today" (plan 002 U4).
 *
 * Two strategies, preferred order:
 *  1. **Price index** — when a suburb price series (e.g. monthly median levels)
 *     is available, adjust by the ratio of the index level now to the level at
 *     the sale month: `adjusted = price × level_now / level_at_sale`. This
 *     captures NON-CONSTANT market movement (a suburb that rose then fell),
 *     which a single annual-growth rate cannot.
 *  2. **Constant growth (fallback)** — compound a single suburb annual-growth
 *     rate monthly. This is the legacy behaviour; used when no index series
 *     exists or the series is too thin to be trustworthy.
 *
 * Pure module (no I/O). The index series is supplied by the caller; today it
 * comes from the suburb median series we already collect (`market-data.ts`).
 * A later hedonic time-dummy index (services/avm, U5+) can feed the SAME seam
 * with a better series without changing this module's interface.
 */

/** One point of a suburb price index: a month and its level (e.g. median price). */
export interface IndexPoint {
  /** 'YYYY-MM' or any ISO date string. */
  month: string;
  /** Index level (relative levels are fine; only ratios are used). */
  value: number;
}

// Multiplier clamp — guards against a wild ratio from a dirty/short series.
export const GROWTH_CLAMP_LO = 0.33;
export const GROWTH_CLAMP_HI = 3.0;

// Below this many valid points the series is treated as too thin to index on
// (fall back to constant growth rather than risk a noisy ratio).
export const MIN_INDEX_POINTS = 6;

/** Whole calendar months between `date` and now (>= 0). */
export function monthsSince(date: string, now: Date = new Date()): number {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

/** Convert a 'YYYY-MM'/ISO month to an absolute month ordinal (year*12+month), or null. */
function monthOrdinal(s: string): number | null {
  const d = new Date(s.length === 7 ? `${s}-01` : s);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() * 12 + d.getMonth();
}

/** Time-adjust by compounded constant monthly growth, clamped (legacy fallback). */
export function timeAdjust(price: number, monthsAgo: number, monthlyGrowth: number): number {
  const adj = price * Math.pow(1 + monthlyGrowth, monthsAgo);
  return Math.round(Math.max(price * GROWTH_CLAMP_LO, Math.min(price * GROWTH_CLAMP_HI, adj)));
}

/**
 * Index level at a target month: the level of the nearest series point in time,
 * clamping to the series ends (no extrapolation). Returns null for an empty
 * series or a non-positive nearest level.
 */
export function indexLevelAt(series: IndexPoint[], targetMonth: string): number | null {
  const target = monthOrdinal(targetMonth);
  if (target == null) return null;
  let best: { dist: number; value: number } | null = null;
  for (const p of series) {
    const ord = monthOrdinal(p.month);
    if (ord == null || !(p.value > 0)) continue;
    const dist = Math.abs(ord - target);
    if (!best || dist < best.dist) best = { dist, value: p.value };
  }
  return best ? best.value : null;
}

/**
 * Index multiplier `level_now / level_at_sale`, clamped, or null when the series
 * is too thin (< MIN_INDEX_POINTS valid points) or either level is unusable.
 */
export function indexMultiplier(
  series: IndexPoint[] | null | undefined,
  saleDate: string,
  now: Date = new Date(),
): number | null {
  if (!series) return null;
  const valid = series.filter((p) => p.value > 0 && monthOrdinal(p.month) != null);
  if (valid.length < MIN_INDEX_POINTS) return null;

  const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const levelNow = indexLevelAt(valid, nowMonth);
  const levelAtSale = indexLevelAt(valid, saleDate);
  if (!levelNow || !levelAtSale) return null;

  const ratio = levelNow / levelAtSale;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.max(GROWTH_CLAMP_LO, Math.min(GROWTH_CLAMP_HI, ratio));
}

/**
 * Adjust a historical sale price to today. Uses the price-index multiplier when
 * a usable series is supplied; otherwise falls back to constant-growth
 * compounding. Always returns a rounded, clamped figure.
 */
export function timeAdjustToToday(
  price: number,
  saleDate: string,
  series: IndexPoint[] | null | undefined,
  monthlyGrowth: number,
  now: Date = new Date(),
): number {
  const mult = indexMultiplier(series, saleDate, now);
  if (mult != null) return Math.round(price * mult);
  return timeAdjust(price, monthsSince(saleDate, now), monthlyGrowth);
}
