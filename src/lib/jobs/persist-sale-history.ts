/**
 * Write-back of a merged profile's saleHistory[] into property_sales
 * (source='profile-crawl'), so on-demand crawls permanently top up sale
 * history rather than living only in property_cache. Best-effort: never
 * throws into the profile-fetch flow. Idempotent via insertPropertySales'
 * upsert on (raw_address, sale_date, sale_price, source).
 */

import type { MergedPropertyProfile, SaleHistoryEntry } from '@/types/property';
import { insertPropertySales, type PropertySaleRecord } from '@/lib/db/queries';

const SOURCE = 'profile-crawl';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse a freeform sale-date string to YYYY-MM-DD. Requires a full date —
 * month-only strings ("Mar 2019") return null, to avoid near-duplicate
 * timelines against exact-dated rows. Exported for tests.
 */
export function parseFullSaleDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/); // 12 Mar 2019
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[1]) : null;
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY (AU)
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

/**
 * Map a profile's saleHistory entries to property_sales rows. Only entries
 * with a parseable full date AND a numeric price > 0 (null prices break the
 * dedup key; confidential sales skipped). Pure — exported for tests.
 */
export function mapSaleHistoryToRecords(
  profile: MergedPropertyProfile,
  slug: string
): PropertySaleRecord[] {
  const addr = profile.data.address as Record<string, unknown> | undefined;
  const state = typeof addr?.state === 'string' ? addr.state : undefined;
  const rawAddress =
    typeof addr?.displayAddress === 'string' ? addr.displayAddress : undefined;
  if (!slug || !rawAddress || !state) return [];

  const history = Array.isArray(profile.data.saleHistory)
    ? (profile.data.saleHistory as SaleHistoryEntry[])
    : [];

  const rows: PropertySaleRecord[] = [];
  for (const entry of history) {
    const saleDate = parseFullSaleDate(entry.date);
    const price = typeof entry.price === 'number' && entry.price > 0 ? entry.price : null;
    if (!saleDate || price === null || entry.isConfidential) continue;
    const settlement = parseFullSaleDate(entry.settlementDate);
    rows.push({
      address_slug: slug,
      raw_address: rawAddress,
      suburb: typeof addr?.suburb === 'string' ? addr.suburb : undefined,
      state,
      postcode: typeof addr?.postcode === 'string' ? addr.postcode : undefined,
      sale_date: saleDate,
      sale_price: price,
      ...(entry.agency ? { agency_name: entry.agency } : {}),
      ...(entry.agentName ? { agent_name: entry.agentName } : {}),
      ...(settlement ? { settlement_date: settlement } : {}),
      source: SOURCE,
      raw_data: entry as unknown as Record<string, unknown>,
    });
  }
  return rows;
}

/**
 * Persist a profile's saleHistory into property_sales. Gated on the saleHistory
 * field's OWN merge provenance (fieldConfidences.saleHistory): confidence ≥ 50
 * with at least one contributing source, i.e. the history was really extracted
 * from a crawled source, not seeded. (The address field can't gate anything —
 * seedResolvedAddress stamps it at confidence 100 for every profile.) A slug
 * and displayAddress are still required. Never throws; a failure must not
 * affect the profile fetch.
 */
export async function persistSaleHistory(
  profile: MergedPropertyProfile,
  slug: string
): Promise<void> {
  try {
    const sh = profile.fieldConfidences['saleHistory'];
    if (!slug || !sh || sh.confidence < 50 || (sh.contributedBy?.length ?? 0) === 0) {
      console.warn(
        `[persist-sale-history] Skipping "${slug}" — saleHistory provenance untrusted (confidence ${sh?.confidence ?? 0}, sources ${sh?.contributedBy?.length ?? 0})`
      );
      return;
    }
    const rows = mapSaleHistoryToRecords(profile, slug);
    if (rows.length === 0) return;
    await insertPropertySales(rows);
    console.log(`[persist-sale-history] Offered ${rows.length} sale row(s) for "${slug}"`);
  } catch (e) {
    console.warn(`[persist-sale-history] Write-back failed for "${slug}":`, e);
  }
}
