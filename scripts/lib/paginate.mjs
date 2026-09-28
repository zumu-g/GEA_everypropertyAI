// ============================================================
// Follow a portal's page parameter until a short page (KTD2 "full sweep").
//
// A suburb is completely covered only when a page comes back shorter than the
// one before it, empty, or adds nothing new (Domain repeats the last page past
// the end). Hitting `cap` (KTD9: 20 pages per suburb per run) or failing after
// page 1 marks the suburb truncated so the sweep skips it; a failure on page 1
// propagates so the caller can count the suburb as blocked.
// ============================================================

/**
 * @template T
 * @param {(page: number) => Promise<T[]>} getPage 1-based
 * @param {{ cap?: number, key?: (item: T) => string }} [opts]
 * @returns {Promise<{ items: T[], pages: number, truncated: boolean, error?: string }>}
 */
export async function paginateUntilShort(getPage, { cap = 20, key } = {}) {
  const items = [];
  const seen = new Set();
  let prev = null;
  for (let page = 1; page <= cap; page++) {
    let batch;
    try { batch = await getPage(page); } catch (e) {
      if (page === 1) throw e;
      return { items, pages: page, truncated: true, error: e.message };
    }
    let added = 0;
    for (const it of batch) {
      const k = key ? key(it) : null;
      if (k != null) { if (seen.has(k)) continue; seen.add(k); }
      items.push(it); added++;
    }
    if (batch.length === 0 || added === 0 || (prev != null && batch.length < prev)) return { items, pages: page, truncated: false };
    prev = batch.length;
  }
  return { items, pages: cap, truncated: true };
}
