// ============================================================
// Pure selection for the daily 55-day and withdrawn listing reports.
// See docs/plans/2026-11-23-1311-feat-daily-55day-withdrawn-reports-plan.html (U2).
// Rows are property_listings rows; all are Casey/Cardinia (guarded at ingest).
// ============================================================

export const DAYS = 55;
const DAY_MS = 86_400_000;
const ms = (iso) => Date.parse(iso);

/** Days-on-market basis: portal listed date, else first seen (which understates). */
export function domBasis(r) {
  if (r.listed_date) return { date: r.listed_date, firstSeen: false };
  return { date: r.campaign_started_at ?? r.created_at, firstSeen: true };
}

/** One row per address; REA, Domain and Homely each carry their own copy. Latest-seen wins. */
export function dedupeBySlug(rows) {
  const by = new Map();
  for (const r of rows) {
    const cur = by.get(r.address_slug);
    if (!cur || (r.last_seen_at ?? '') > (cur.last_seen_at ?? '')) by.set(r.address_slug, r);
  }
  return [...by.values()];
}

/** Active listings whose day 55 falls in (since, now]. */
export function select55Day(rows, since, now) {
  const active = rows.filter((x) => x.active);
  // Earliest start across an address's portal copies (a real listed date first), so the
  // latest-seen copy changing day to day cannot skip or repeat the crossing.
  const basisBySlug = new Map();
  for (const r of active) {
    const b = domBasis(r), cur = basisBySlug.get(r.address_slug);
    if (!cur || (cur.firstSeen && !b.firstSeen) || (cur.firstSeen === b.firstSeen && ms(b.date) < ms(cur.date))) basisBySlug.set(r.address_slug, b);
  }
  const out = [];
  for (const r of dedupeBySlug(active)) {
    const b = basisBySlug.get(r.address_slug);
    const crossed = ms(b.date) + DAYS * DAY_MS;
    if (crossed > ms(since) && crossed <= ms(now)) {
      out.push({ ...r, daysOnMarket: Math.floor((ms(now) - ms(b.date)) / DAY_MS), firstSeen: b.firstSeen });
    }
  }
  return out;
}

/**
 * Listings the source sweep withdrew in (since, now], minus sales and addresses
 * still live on another portal. Backstop ('stale') closures are only counted.
 */
export function selectWithdrawn(rows, since, now) {
  const inWindow = (r) => r.removed_at && ms(r.removed_at) > ms(since) && ms(r.removed_at) <= ms(now);
  const liveSlugs = new Set(rows.filter((r) => r.active).map((r) => r.address_slug));
  const staleCount = new Set(rows.filter((r) => r.close_reason === 'stale' && r.lifecycle_status === 'withdrawn' && inWindow(r)).map((r) => r.address_slug)).size;
  const picked = rows.filter((r) => !r.active && r.lifecycle_status === 'withdrawn' && r.close_reason === 'sweep'
    && inWindow(r) && !liveSlugs.has(r.address_slug));
  const out = dedupeBySlug(picked).map((r) => {
    const b = domBasis(r);
    return { ...r, daysOnMarket: Math.floor((ms(r.removed_at) - ms(b.date)) / DAY_MS), firstSeen: b.firstSeen };
  });
  return { rows: out, staleCount };
}

/** Asking-price cuts across a listing's price history (oldest first by observed_at). */
export function priceCutSummary(history) {
  const mids = [...history].sort((a, b) => ms(a.observed_at) - ms(b.observed_at))
    .map((h) => (h.price_low != null && h.price_high != null ? (Number(h.price_low) + Number(h.price_high)) / 2 : null))
    .filter((v) => v != null);
  let cuts = 0;
  for (let i = 1; i < mids.length; i++) if (mids[i] < mids[i - 1]) cuts++;
  if (!cuts) return { cuts: 0, pct: null };
  return { cuts, pct: Math.round(((mids.at(-1) - mids[0]) / mids[0]) * 1000) / 10 };
}

/** [[suburb, rows sorted by address]] sorted by suburb. */
export function groupBySuburb(rows) {
  const by = new Map();
  for (const r of rows) (by.get(r.suburb) ?? by.set(r.suburb, []).get(r.suburb)).push(r);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([s, rs]) => [s, rs.sort((a, b) => a.raw_address.localeCompare(b.raw_address, 'en', { numeric: true }))]);
}
