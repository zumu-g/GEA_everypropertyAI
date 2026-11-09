/**
 * Pure mapper: translate a feed row (property_sales / property_listings /
 * property_rentals) into merger field keys so a property profile can be seeded
 * from the structured data we already hold when the live crawl yields nothing.
 *
 * The output is layered onto the merged profile as a LOW-confidence
 * `property-feed` source — gap-fill only, so a real crawl extraction always
 * wins (see `doFetchAndCacheProfile`).
 */

import type { FieldConfidence, MergedPropertyProfile } from '@/types/property';
import type { FeedKind } from '@/lib/db/queries';

/** Source name registered in `profile.sources` for feed-seeded fields. */
export const FEED_SOURCE = 'property-feed';

/**
 * Confidence tiers for feed-seeded fields. Deliberately low so the merger's
 * crawl-derived values (50–100) always take precedence; the feed only fills
 * gaps the crawl left empty.
 */
const FEED_CONFIDENCE = 40;
const FEED_PHOTO_CONFIDENCE = 35;

export interface FeedSeedFields {
  data: Record<string, unknown>;
  fieldConfidences: Record<string, FieldConfidence>;
}

/** Coerce to a finite number, or undefined. Rejects null/''/NaN. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce to a non-empty trimmed string, or undefined. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/** Parse the first dollar amount out of a display price like "$1,200,000" or "Offers above $850k". */
function priceFromDisplay(v: unknown): number | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!m) return undefined;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') n *= 1_000;
  else if (suffix === 'm') n *= 1_000_000;
  return n > 0 ? n : undefined;
}

/**
 * Derive priceLow / priceMid / priceHigh / priceSource for the proposal CLI,
 * which reads those keys (not raw sale_price). Mirrors the merger's bands.
 * Returns an empty object when no usable price exists (rentals, blank rows).
 */
function derivePrice(row: Record<string, unknown>, feed: FeedKind): Record<string, unknown> {
  if (feed === 'sold') {
    const sale = num(row.sale_price);
    if (sale && sale > 50_000) {
      return {
        priceNumeric: sale,
        priceLow: Math.round(sale * 0.9),
        priceMid: sale,
        priceHigh: Math.round(sale * 1.1),
        priceSource: 'feed-sold',
      };
    }
    return {};
  }

  if (feed === 'on-market') {
    const lo = num(row.price_low);
    const hi = num(row.price_high);
    if (lo && hi) {
      const low = Math.min(lo, hi);
      const high = Math.max(lo, hi);
      return {
        priceLow: low,
        priceHigh: high,
        priceMid: Math.round((low + high) / 2),
        priceSource: 'feed-listing',
      };
    }
    const single = lo ?? hi ?? priceFromDisplay(row.display_price);
    if (single && single > 100_000) {
      return {
        priceNumeric: single,
        priceLow: Math.round(single * 0.95),
        priceMid: single,
        priceHigh: Math.round(single * 1.05),
        priceSource: 'feed-listing',
      };
    }
    return {};
  }

  // Rentals carry weekly rent, not a sale/listing valuation — no price band.
  return {};
}

/**
 * Map a feed row to merger field keys plus matching low-tier field confidences.
 * Null/missing columns are omitted entirely (never written as 0 / '').
 */
export function mapFeedRowToProfileFields(
  row: Record<string, unknown>,
  feed: FeedKind
): FeedSeedFields {
  const data: Record<string, unknown> = {};

  const set = (key: string, value: unknown) => {
    if (value !== undefined) data[key] = value;
  };

  set('propertyType', str(row.property_type));
  set('bedrooms', num(row.bedrooms));
  set('bathrooms', num(row.bathrooms));
  set('carSpaces', num(row.car_spaces));
  set('landArea', num(row.land_area_sqm));
  set('buildingArea', num(row.building_area_sqm));
  set('yearBuilt', num(row.year_built));
  set('agencyName', str(row.agency_name));
  set('agentName', str(row.agent_name));

  const lat = num(row.latitude);
  const lng = num(row.longitude);
  set('latitude', lat);
  set('longitude', lng);

  Object.assign(data, derivePrice(row, feed));

  // The proposal CLI reads `photos` (string[] | {url}[]) for heroPhotos.
  const photo = str(row.image_url);
  if (photo) data.photos = [photo];

  const fieldConfidences: Record<string, FieldConfidence> = {};
  for (const key of Object.keys(data)) {
    const confidence = key === 'photos' ? FEED_PHOTO_CONFIDENCE : FEED_CONFIDENCE;
    fieldConfidences[key] = { confidence, contributedBy: [FEED_SOURCE] };
  }

  return { data, fieldConfidences };
}

/**
 * Gap-fill the merged profile with feed-mapped fields: only writes a field the
 * profile does NOT already carry, so a crawl-derived value always wins (R3).
 * Mutates `profile.data`/`fieldConfidences` and pushes a `property-feed` source
 * when anything was seeded. Returns true if at least one field was filled.
 */
export function applyFeedSeed(
  profile: Pick<MergedPropertyProfile, 'data' | 'fieldConfidences' | 'sources'>,
  fields: FeedSeedFields
): boolean {
  let seededAny = false;
  for (const [key, value] of Object.entries(fields.data)) {
    if (profile.data[key] !== undefined) continue; // crawl wins
    profile.data[key] = value;
    profile.fieldConfidences[key] = fields.fieldConfidences[key];
    seededAny = true;
  }

  if (seededAny) {
    profile.sources.push({ name: FEED_SOURCE, extractedAt: new Date(), hasErrors: false });
  }

  return seededAny;
}

// ── DB history top-up ─────────────────────────────────────────────────────────

interface DbSaleRow {
  sale_price?: number | null;
  sale_date?: string | null;
  agency_name?: string | null;
  agent_name?: string | null;
  source?: string;
}
interface DbRentalRow {
  weekly_rent?: number | null;
  listed_date?: string | null;
  campaign_started_at?: string | null;
  created_at?: string | null;
  leased_at?: string | null;
  removed_at?: string | null;
  last_seen_at?: string | null;
  /** listing_price_history observations for this campaign, oldest first. */
  price_history?: Array<{ observed_at: string; price_low?: number | null }>;
  agency_name?: string | null;
  agent_name?: string | null;
  source?: string;
}
/** A for-sale campaign from property_listings — listed, then withdrawn or sold. */
interface DbListingRow {
  listed_date?: string | null;
  campaign_started_at?: string | null;
  created_at?: string | null;
  lifecycle_status?: string | null;
  removed_at?: string | null;
  last_seen_at?: string | null;
  display_price?: string | null;
  price_low?: number | null;
  agency_name?: string | null;
  agent_name?: string | null;
  source?: string;
}

/** Month+price dedup key — VG contract dates and portal dates drift within a month. */
const saleKey = (date?: string | null, price?: number | null) =>
  `${(date ?? '').slice(0, 7)}:${price ?? ''}`;

type PriceObs = { listing_url?: string | null; observed_at: string; price_low?: number | null };

/**
 * A rental row is one identity (raw_address, source); a relist reopens it and
 * resets campaign_started_at, so earlier campaigns survive only in price
 * history. Split that history by listing_url (oldest first): earlier URLs
 * become their own campaigns, the row's own URL keeps the row's lifecycle.
 */
export function splitRentalCampaigns<R extends DbRentalRow & { listing_url?: string | null }>(
  row: R,
  history: PriceObs[]
): Array<R | DbRentalRow> {
  const groups = new Map<string, PriceObs[]>();
  for (const h of history) {
    const key = h.listing_url && h.listing_url !== row.listing_url ? h.listing_url : '';
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const prior: DbRentalRow[] = [...groups].filter(([k]) => k).map(([, obs]) => ({
    campaign_started_at: obs[0].observed_at,
    last_seen_at: obs[obs.length - 1].observed_at,
    weekly_rent: obs[obs.length - 1].price_low,
    source: row.source,
    price_history: obs,
  }));
  return [...prior, { ...row, price_history: groups.get('') ?? [] }];
}

const DAY_MS = 86_400_000;
const fmtRent = (n: number) => `$${n.toLocaleString('en-AU')}/wk`;

/** One rental campaign → its listing event (opening rent + days on market) and one event per rent change. */
function rentalEvents(r: DbRentalRow) {
  const start = r.listed_date ?? r.campaign_started_at ?? r.created_at;
  const date = (start ?? '').slice(0, 10);
  const prices = (r.price_history ?? []).filter((h) => h.price_low != null && h.price_low > 0);
  const opening = prices[0]?.price_low ?? r.weekly_rent;
  if (!date || opening == null) return [];

  const end = r.leased_at ?? r.removed_at ?? r.last_seen_at;
  const days = end ? (Date.parse(end.slice(0, 10)) - Date.parse(date)) / DAY_MS : NaN; // calendar days
  const who = {
    ...(r.agency_name ? { agency: r.agency_name } : {}),
    ...(r.agent_name ? { agentName: r.agent_name } : {}),
  };
  const events: Array<{ date: string; weeklyRent: number; daysOnMarket?: number; description?: string; agency?: string; agentName?: string }> = [
    { date, weeklyRent: opening, ...(days >= 0 ? { daysOnMarket: days } : {}), ...who },
  ];
  for (let i = 1; i < prices.length; i++) {
    const [prev, cur] = [prices[i - 1].price_low!, prices[i].price_low!];
    if (cur === prev) continue;
    events.push({
      date: prices[i].observed_at.slice(0, 10),
      weeklyRent: cur,
      description: `Rent ${cur < prev ? 'reduced' : 'increased'} from ${fmtRent(prev)} to ${fmtRent(cur)}`,
      ...who,
    });
  }
  if (r.leased_at) {
    events.push({ date: r.leased_at.slice(0, 10), weeklyRent: prices.at(-1)?.price_low ?? opening, description: 'Leased', ...who });
  }
  return events;
}

const daysBetween = (start: string, end?: string | null) =>
  end ? (Date.parse(end.slice(0, 10)) - Date.parse(start)) / DAY_MS : NaN;

/** One for-sale campaign → a 'listed' (still on market) or 'withdrawn' sale-history event. */
function listingEvent(r: DbListingRow) {
  const date = (r.listed_date ?? r.campaign_started_at ?? r.created_at ?? '').slice(0, 10);
  if (!date) return null;
  const days = daysBetween(date, r.removed_at ?? r.last_seen_at);
  return {
    date,
    type: r.lifecycle_status === 'withdrawn' ? 'withdrawn' : 'listed',
    ...(r.price_low != null && r.price_low > 0 ? { listingPrice: r.price_low } : {}),
    ...(r.display_price ? { description: `Listed for sale: ${r.display_price}` } : {}),
    ...(days >= 0 ? { daysOnMarket: days } : {}),
    ...(r.agency_name ? { agency: r.agency_name } : {}),
    ...(r.agent_name ? { agentName: r.agent_name } : {}),
    source: r.source ?? 'property-feed',
  };
}

/**
 * Merge our own sold/rental feed rows for this address into the profile's
 * saleHistory/rentalHistory. Crawl-sourced entries win; DB rows only add
 * events the crawl didn't know about (e.g. VG sales when portals are blocked).
 * Mutates the profile; returns true when anything was added.
 */
export function applyDbHistory(
  profile: Pick<MergedPropertyProfile, 'data'>,
  sales: DbSaleRow[],
  rentals: DbRentalRow[],
  listings: DbListingRow[] = []
): boolean {
  let added = false;

  if (sales.length > 0 || listings.length > 0) {
    const existing = Array.isArray(profile.data.saleHistory)
      ? (profile.data.saleHistory as Array<{ date?: string; price?: number; listingPrice?: number }>)
      : [];
    const seen = new Set(existing.map((s) => saleKey(s.date, s.price ?? s.listingPrice)));
    const extra: Array<Record<string, unknown> & { date: string }> = sales
      .filter((r) => r.sale_date && !seen.has(saleKey(r.sale_date, r.sale_price)))
      .map((r) => ({
        date: r.sale_date!,
        ...(r.sale_price != null && r.sale_price > 0 ? { price: r.sale_price } : {}),
        ...(r.agency_name ? { agency: r.agency_name } : {}),
        ...(r.agent_name ? { agentName: r.agent_name } : {}),
        type: 'sold',
        source: r.source ?? 'property-feed',
      }));
    for (const r of listings) {
      const e = listingEvent(r);
      if (e && !seen.has(saleKey(e.date, e.listingPrice))) extra.push(e);
    }
    if (extra.length > 0) {
      profile.data.saleHistory = [...existing, ...extra].sort((a, b) =>
        String(b.date ?? '').localeCompare(String(a.date ?? ''))
      );
      added = true;
    }
  }

  if (rentals.length > 0) {
    const existing = Array.isArray(profile.data.rentalHistory)
      ? (profile.data.rentalHistory as Array<{ date?: string; weeklyRent?: number }>)
      : [];
    const seen = new Set(existing.map((r) => saleKey(r.date, r.weeklyRent)));
    const extra = rentals
      .flatMap((r) => rentalEvents(r))
      .filter((e) => !seen.has(saleKey(e.date, e.weeklyRent)));
    if (extra.length > 0) {
      profile.data.rentalHistory = [...existing, ...extra].sort((a, b) =>
        String(b.date ?? '').localeCompare(String(a.date ?? ''))
      );
      added = true;
    }
  }

  return added;
}
