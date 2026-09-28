// ============================================================
// Pure mappers from source text to the normalised lifecycle columns (KTD3, R3, R25).
// No I/O; shared by the feed-write module and its tests. `status` stays raw (R1).
// ============================================================

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * @param {string|null|undefined} statusText raw source status text
 * @param {{ sold?: boolean }} [extra] out-of-band signals (Homely soldOn → sold: true)
 * @returns {'active'|'under_offer'|'sold'}
 */
export function lifecycleFromSource(statusText, extra = {}) {
  const t = String(statusText || '').toLowerCase();
  if (extra.sold || /\bsold\b/.test(t)) return 'sold';
  if (/under\s+(offer|contract)/.test(t)) return 'under_offer';
  return 'active';
}

/** Dollar amounts in a display string; "$800k" → 800000. */
function dollarAmounts(text) {
  return [...String(text || '').matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m)?\b/gi)]
    .map((m) => Number(m[1].replace(/,/g, '')) * (m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** @returns {{ low: number|null, high: number|null }} */
export function parsePriceRange(text) {
  const a = dollarAmounts(text);
  return a.length ? { low: Math.min(...a), high: Math.max(...a) } : { low: null, high: null };
}

/**
 * Case- and whitespace-insensitive form of display text, for text-only diffs (KTD4).
 * Day names and day-month tokens are dropped so "Auction Sat 6 Jun" → "Auction Sat 13 Jun"
 * is not a price change.
 */
export function normaliseDisplay(text) {
  return String(text || '').toLowerCase()
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Day-month in text ("Sat 14 Nov", "14 November", "14/11") → YYYY-MM-DD, year chosen so the
 * date is the next occurrence on or after `now` minus 7 days.
 */
function parseDayMonth(text, now) {
  const t = String(text || '');
  let d, m;
  const named = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\b/);
  if (named && MONTHS.includes(named[2].slice(0, 3).toLowerCase())) { d = Number(named[1]); m = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()); }
  else { const num = t.match(/\b(\d{1,2})\/(\d{1,2})\b/); if (num) { d = Number(num[1]); m = Number(num[2]) - 1; } }
  if (d == null || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const floor = new Date(now.getTime() - 7 * 86400_000);
  let y = floor.getUTCFullYear();
  if (Date.UTC(y, m, d) < Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth(), floor.getUTCDate())) y += 1;
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * @param {string|null|undefined} priceText display price
 * @param {string|null|undefined} statusText raw status
 * @param {Date} [now]
 * @returns {{ sale_method: 'auction'|'private'|'unknown', auction_date: string|null }}
 */
export function saleMethodFromText(priceText, statusText, now = new Date()) {
  const both = `${priceText || ''} ${statusText || ''}`;
  if (/auction/i.test(both)) return { sale_method: 'auction', auction_date: parseDayMonth(both, now) };
  if (dollarAmounts(priceText).length || /private|for sale|offers/i.test(both)) return { sale_method: 'private', auction_date: null };
  return { sale_method: 'unknown', auction_date: null };
}
