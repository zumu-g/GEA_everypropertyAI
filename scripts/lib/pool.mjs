// ============================================================
// Bounded-concurrency async map for the scheduled ingest scripts.
//
// The Web Unlocker feeds were fetching suburbs SERIALLY, so 28 suburbs × slow
// (retry-heavy) responses regularly blew past the 45-min GitHub job timeout and
// got cancelled mid-run (daily-domain-scrape #15/#17/#18). Running fetches with a
// small concurrency cap turns ~45 min into ~8-10 min while staying polite to the
// upstream (and to the Web Unlocker rate limits).
//
// Preserves input order in the results array so callers can pair results back to
// their inputs. `fn` rejections are NOT caught here — callers that need
// per-item error handling should catch inside `fn` and return a sentinel.
// ============================================================

/**
 * Map `items` through async `fn` with at most `limit` in flight at once.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit  max concurrent calls (>=1)
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} results in input order
 */
export async function mapPool(items, limit, fn) {
  const n = items.length;
  const results = new Array(n);
  const cap = Math.max(1, Math.min(limit, n || 1));
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: cap }, worker));
  return results;
}
