/**
 * Write-back of a merged profile's rentalHistory[] into property_rental_history
 * (source='profile-crawl'), so on-demand crawls permanently top up rental
 * history rather than living only in property_cache. Best-effort: never
 * throws into the profile-fetch flow. Idempotent via insertPropertyRentalHistory's
 * upsert on (raw_address, lease_date, weekly_rent, source).
 *
 * Mirrors persist-sale-history.ts — see that file for the sibling (sales) path.
 */

import type { MergedPropertyProfile, RentalHistoryEntry } from '@/types/property';
import {
  insertPropertyRentalHistory,
  type PropertyRentalHistoryRecord,
} from '@/lib/db/queries';
import { parseFullSaleDate } from '@/lib/jobs/persist-sale-history';

const SOURCE = 'profile-crawl';

/**
 * Map a profile's rentalHistory entries to property_rental_history rows. Only
 * entries with a parseable full date AND a numeric weekly rent > 0 (a null
 * rent would break the dedup key). Pure — exported for tests.
 */
export function mapRentalHistoryToRecords(
  profile: MergedPropertyProfile,
  slug: string
): PropertyRentalHistoryRecord[] {
  const addr = profile.data.address as Record<string, unknown> | undefined;
  const state = typeof addr?.state === 'string' ? addr.state : undefined;
  const rawAddress =
    typeof addr?.displayAddress === 'string' ? addr.displayAddress : undefined;
  if (!slug || !rawAddress || !state) return [];

  const history = Array.isArray(profile.data.rentalHistory)
    ? (profile.data.rentalHistory as RentalHistoryEntry[])
    : [];

  const rows: PropertyRentalHistoryRecord[] = [];
  for (const entry of history) {
    const leaseDate = parseFullSaleDate(entry.date);
    const rent =
      typeof entry.weeklyRent === 'number' && entry.weeklyRent > 0 ? entry.weeklyRent : null;
    if (!leaseDate || rent === null) continue;
    rows.push({
      address_slug: slug,
      raw_address: rawAddress,
      suburb: typeof addr?.suburb === 'string' ? addr.suburb : undefined,
      state,
      postcode: typeof addr?.postcode === 'string' ? addr.postcode : undefined,
      weekly_rent: rent,
      lease_date: leaseDate,
      ...(typeof entry.bond === 'number' && entry.bond > 0 ? { bond: entry.bond } : {}),
      ...(entry.leaseTerm ? { lease_term: entry.leaseTerm } : {}),
      ...(entry.agency ? { agency_name: entry.agency } : {}),
      ...(entry.agentName ? { agent_name: entry.agentName } : {}),
      source: SOURCE,
      raw_data: entry as unknown as Record<string, unknown>,
    });
  }
  return rows;
}

/**
 * Persist a profile's rentalHistory into property_rental_history. Gated on the
 * rentalHistory field's OWN merge provenance (fieldConfidences.rentalHistory):
 * confidence ≥ 50 with at least one contributing source, i.e. the history was
 * really extracted from a crawled source, not seeded. Never throws; a failure
 * must not affect the profile fetch.
 */
export async function persistRentalHistory(
  profile: MergedPropertyProfile,
  slug: string
): Promise<void> {
  try {
    const rh = profile.fieldConfidences['rentalHistory'];
    if (!slug || !rh || rh.confidence < 50 || (rh.contributedBy?.length ?? 0) === 0) {
      console.warn(
        `[persist-rental-history] Skipping "${slug}" — rentalHistory provenance untrusted (confidence ${rh?.confidence ?? 0}, sources ${rh?.contributedBy?.length ?? 0})`
      );
      return;
    }
    const rows = mapRentalHistoryToRecords(profile, slug);
    if (rows.length === 0) return;
    await insertPropertyRentalHistory(rows);
    console.log(`[persist-rental-history] Offered ${rows.length} rental row(s) for "${slug}"`);
  } catch (e) {
    console.warn(`[persist-rental-history] Write-back failed for "${slug}":`, e);
  }
}
