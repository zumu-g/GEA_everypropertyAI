import { NextRequest, NextResponse } from 'next/server';
import { parseAddress } from '@/lib/utils/address';
import { isServiceAreaSuburb } from '@/lib/utils/service-area';
import {
  mapItem,
  CATEGORY_TABLE,
  type IngestCategory,
} from '@/lib/ingest/domain-mapper';
import { retriggerDomainRun, MAX_RUN_ATTEMPTS } from '@/lib/ingest/domain-run';
import {
  insertPropertySales,
  insertPropertyListings,
  insertPropertyRentals,
  insertAddresses,
  expireNotSeen,
  type PropertySaleRecord,
  type PropertyListingRecord,
  type PropertyRentalRecord,
  type AddressRecord,
} from '@/lib/db/queries';

export const maxDuration = 300;

const APIFY_BASE = 'https://api.apify.com/v2';

/**
 * POST /api/ingest/domain?category=sold|on-market|rent
 *
 * Apify webhook target: on a Domain actor run SUCCEEDED, Apify POSTs here. We page
 * the run's dataset, map items, dedup-upsert into the right table, link/augment
 * `addresses`, and (for listings/rentals) bump last_seen_at + expire rows no longer
 * on-market. Idempotent — re-POSTing the same dataset does not create duplicates.
 *
 * Auth: ?token= or x-ingest-token header must equal INGEST_SECRET (or CRON_SECRET).
 * Dataset id: ?datasetId= or the Apify webhook payload's resource.defaultDatasetId.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const secret = process.env.INGEST_SECRET ?? process.env.CRON_SECRET;
  const token = searchParams.get('token') ?? request.headers.get('x-ingest-token');
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const category = searchParams.get('category') as IngestCategory | null;
  if (!category || !(category in CATEGORY_TABLE)) {
    return NextResponse.json({ error: 'category must be sold | on-market | rent' }, { status: 400 });
  }

  // Which scrape attempt this is (1 = the original scheduled run). The webhook
  // bumps this each time it re-triggers a blocked/empty run, so we stop after
  // MAX_RUN_ATTEMPTS instead of looping (and burning $) forever.
  const attempt = Math.max(1, Number(searchParams.get('attempt')) || 1);

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: 'APIFY_API_TOKEN not set' }, { status: 500 });
  }

  // Dataset id from query or the Apify webhook payload.
  let datasetId = searchParams.get('datasetId') ?? undefined;
  if (!datasetId) {
    try {
      const body = await request.json();
      datasetId = body?.resource?.defaultDatasetId ?? body?.datasetId;
    } catch {
      /* no body */
    }
  }
  if (!datasetId) {
    return NextResponse.json({ error: 'datasetId required (query or webhook payload)' }, { status: 400 });
  }

  const runStart = new Date().toISOString();
  const { table } = CATEGORY_TABLE[category];

  const sales: PropertySaleRecord[] = [];
  const listings: PropertyListingRecord[] = [];
  const rentals: PropertyRentalRecord[] = [];
  const addressBySlug = new Map<string, AddressRecord>();
  const suburbs = new Set<string>();
  let processed = 0;
  let skipped = 0;

  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const url = `${APIFY_BASE}/datasets/${datasetId}/items?token=${apifyToken}&clean=true&offset=${offset}&limit=${PAGE}`;
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: `Apify items HTTP ${res.status}` }, { status: 502 });
    }
    const items = (await res.json()) as unknown[];
    if (!Array.isArray(items) || items.length === 0) break;

    for (const it of items) {
      const row = mapItem(category, it as Parameters<typeof mapItem>[1]);
      if (!row) { skipped++; continue; }
      // Hard service-area guard: never store anything outside Casey/Cardinia,
      // even if a suburb page surfaces a neighbouring locality.
      if (!isServiceAreaSuburb(row.suburb)) { skipped++; continue; }
      processed++;
      if (row.suburb) suburbs.add(row.suburb);

      // Augment the address universe from the scraped record.
      if (row.address_slug && !addressBySlug.has(row.address_slug)) {
        const a = parseAddress(row.raw_address);
        addressBySlug.set(row.address_slug, {
          address_slug: row.address_slug,
          raw_address: row.raw_address,
          street_number: a.streetNumber || undefined,
          street_name: a.streetName || undefined,
          street_type: a.streetType || undefined,
          suburb: row.suburb,
          state: row.state,
          postcode: row.postcode,
          lat: row.latitude,
          lng: row.longitude,
          source: 'domain',
        });
      }

      if (category === 'sold') {
        sales.push(row as PropertySaleRecord);
      } else if (category === 'on-market') {
        listings.push({ ...(row as PropertyListingRecord), last_seen_at: runStart, active: true });
      } else {
        rentals.push({ ...(row as PropertyRentalRecord), last_seen_at: runStart, active: true });
      }
    }

    offset += items.length;
    if (items.length < PAGE) break;
  }

  // ── Blocked/empty-run guard ────────────────────────────────────────────────
  // The actor exits SUCCEEDED with 0 items when Domain's anti-bot blocks it.
  // We must NOT treat that as a healthy run: do not expire live listings, and
  // re-trigger a fresh run (blocking is transient) until we get data or exhaust
  // MAX_RUN_ATTEMPTS — then return non-2xx so the schedule's failure alert fires.
  if (processed === 0) {
    if (attempt < MAX_RUN_ATTEMPTS) {
      try {
        const origin = process.env.INGEST_PUBLIC_ORIGIN || request.nextUrl.origin;
        const runId = await retriggerDomainRun(
          category,
          origin,
          token!,
          attempt + 1,
        );
        return NextResponse.json({
          category, datasetId, processed: 0,
          status: 'retrying',
          attempt,
          retriggeredRunId: runId,
          message: `Empty/blocked run — re-triggered attempt ${attempt + 1}/${MAX_RUN_ATTEMPTS}.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        return NextResponse.json(
          { category, datasetId, status: 'retrigger-failed', attempt, error: message },
          { status: 502 },
        );
      }
    }
    // Exhausted: surface a failure (non-2xx) so notifications fire. No expiry.
    return NextResponse.json(
      {
        category, datasetId, processed: 0,
        status: 'blocked',
        attempt,
        message: `Scraper returned 0 items after ${MAX_RUN_ATTEMPTS} attempts — Domain is blocking. Existing data left untouched.`,
      },
      { status: 502 },
    );
  }

  // Upsert (dedup via the table's UNIQUE key).
  if (sales.length) await insertPropertySales(sales);
  if (listings.length) await insertPropertyListings(listings);
  if (rentals.length) await insertPropertyRentals(rentals);

  // Augment addresses (ignore-duplicates on slug).
  if (addressBySlug.size) await insertAddresses([...addressBySlug.values()]);

  // Expire on-market rows no longer seen (listings/rentals only).
  let expired = 0;
  if (category !== 'sold') {
    expired = await expireNotSeen(table as 'property_listings' | 'property_rentals', [...suburbs], runStart);
  }

  return NextResponse.json({
    category,
    table,
    datasetId,
    processed,
    skipped,
    upserted: sales.length + listings.length + rentals.length,
    addressesAugmented: addressBySlug.size,
    suburbs: [...suburbs],
    expired,
  });
}
