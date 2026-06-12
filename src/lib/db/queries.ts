import type {
  PropertyProfile,
  PropertySearchResult,
  SaleRecord,
  PropertyId,
  MergedPropertyProfile,
} from '@/types/property';
import type { CrawlJob } from '@/types/crawl';
import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';
import { normaliseSuburbAlias } from '@/lib/utils/address';

// ─── Types for DB records ───────────────────────────────────────────────────

/** Crawl job record as stored in the database (flat row, not the full CrawlJob type). */
export interface CrawlJobRecord {
  id?: string;
  property_id?: string;
  source_name: string;
  url?: string;
  status: string;
  markdown_content?: string;
  extracted_data?: Record<string, unknown>;
  confidence_score?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

// ─── In-memory fallback (MVP / no Supabase) ────────────────────────────────
// When Supabase env vars are missing, queries silently fall back to a simple
// in-memory Map so the app can still run locally for development.
//
//   const cache = new Map<string, PropertyProfile>();
//   // In each query function, check: if (!isSupabaseConfigured()) { return cache.get(slug) ?? null; }

// ─── Helpers ────────────────────────────────────────────────────────────────

function supabase() {
  return getSupabaseServerClient();
}

/**
 * Convert a PropertyProfile to a flat row for the properties table.
 */
function profileToRow(profile: PropertyProfile) {
  const addr = profile.address;
  const phys = profile.physicalAttributes;
  const val = profile.valuation;
  const council = profile.councilValuation;
  const listing = profile.currentListing;

  return {
    id: profile.id as string,
    address_slug: generateSlug(addr.displayAddress ?? ''),
    full_address: addr.displayAddress ?? '',
    unit: addr.unitNumber ?? null,
    street_number: addr.streetNumber,
    street_name: addr.streetName,
    street_type: addr.streetType,
    suburb: addr.suburb,
    state: addr.state,
    postcode: addr.postcode,
    lat: addr.coordinates?.latitude ?? null,
    lng: addr.coordinates?.longitude ?? null,
    property_type: phys.propertyType,
    bedrooms: phys.bedrooms ?? null,
    bathrooms: phys.bathrooms ?? null,
    car_spaces: phys.carSpaces ?? null,
    land_area_sqm: phys.landAreaSqm ?? null,
    building_area_sqm: phys.buildingAreaSqm ?? null,
    year_built: phys.yearBuilt ?? null,
    construction: phys.construction ?? null,
    roof_type: phys.roofType ?? null,
    features: [
      ...phys.features,
      ...phys.outdoorFeatures,
      ...phys.indoorFeatures,
    ],
    estimated_value_low: val?.lowRange?.amount ?? null,
    estimated_value_mid: val?.estimatedValue?.amount ?? null,
    estimated_value_high: val?.highRange?.amount ?? null,
    value_confidence: val?.confidence?.score ?? null,
    council_valuation_land: council?.landValue?.amount ?? null,
    council_valuation_improvements: council?.improvementsValue?.amount ?? null,
    current_listing_status: listing?.status ?? null,
    current_listing_price: listing?.price?.amount ?? null,
    current_listing_agent: listing?.agentName ?? listing?.agency ?? null,
    current_listing_url: listing?.sourceUrl ?? null,
    ai_summary: null, // populated later by AI pipeline
    overall_confidence: profile.overallConfidence.score,
  };
}

function generateSlug(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Fetch a single property by its URL-safe address slug.
 */
export async function getPropertyBySlug(
  slug: string
): Promise<PropertyProfile | null> {
  // MVP fallback: if (!isSupabaseConfigured()) { return inMemoryCache.get(slug) ?? null; }

  const { data, error } = await supabase()
    .from('properties')
    .select(
      `
      *,
      sale_history (*),
      rental_history (*),
      photos (*),
      data_sources (*),
      crawl_jobs (*)
    `
    )
    .eq('address_slug', slug)
    .single();

  if (error || !data) {
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found — not a real error
      console.error('[getPropertyBySlug] Supabase error:', error.message);
    }
    return null;
  }

  return rowToProfile(data);
}

/**
 * Insert or update a property, returning the property ID.
 * Uses Supabase upsert on the address_slug unique constraint.
 */
export async function upsertProperty(
  profile: PropertyProfile
): Promise<string> {
  // MVP fallback: if (!isSupabaseConfigured()) { inMemoryCache.set(slug, profile); return profile.id; }

  const row = profileToRow(profile);

  const { data, error } = await supabase()
    .from('properties')
    .upsert(row, { onConflict: 'address_slug' })
    .select('id')
    .single();

  if (error) {
    console.error('[upsertProperty] Supabase error:', error.message);
    throw new Error(`Failed to upsert property: ${error.message}`);
  }

  return data.id as string;
}

/**
 * Add sale history records for a property.
 * Skips duplicates by checking (property_id, sale_date, price).
 */
export async function addSaleHistory(
  propertyId: string,
  sales: SaleRecord[]
): Promise<void> {
  if (sales.length === 0) return;

  const rows = sales.map((sale) => ({
    property_id: propertyId,
    price: sale.price.amount,
    sale_date: sale.saleDate,
    sale_type: sale.saleType,
    days_on_market: sale.daysOnMarket ?? null,
    source: sale.source.name,
  }));

  const { error } = await supabase().from('sale_history').upsert(rows, {
    // There's no unique constraint on sale_history by default,
    // so this acts as a plain insert. In production, add a unique
    // constraint on (property_id, sale_date, price) and use
    // onConflict: 'property_id,sale_date,price' to deduplicate.
    ignoreDuplicates: true,
  });

  if (error) {
    console.error('[addSaleHistory] Supabase error:', error.message);
    throw new Error(`Failed to add sale history: ${error.message}`);
  }
}

/**
 * Insert a crawl job record.
 */
export async function addCrawlJob(job: CrawlJobRecord): Promise<void> {
  const { error } = await supabase().from('crawl_jobs').insert({
    property_id: job.property_id ?? null,
    source_name: job.source_name,
    url: job.url ?? null,
    status: job.status,
    markdown_content: job.markdown_content ?? null,
    extracted_data: job.extracted_data ?? null,
    confidence_score: job.confidence_score ?? null,
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
    error: job.error ?? null,
  });

  if (error) {
    console.error('[addCrawlJob] Supabase error:', error.message);
    throw new Error(`Failed to add crawl job: ${error.message}`);
  }
}

/**
 * Get recent crawl jobs for a property, ordered by most recent first.
 */
export async function getRecentCrawls(
  propertyId: string
): Promise<CrawlJobRecord[]> {
  const { data, error } = await supabase()
    .from('crawl_jobs')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[getRecentCrawls] Supabase error:', error.message);
    throw new Error(`Failed to fetch crawl jobs: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    property_id: row.property_id,
    source_name: row.source_name,
    url: row.url,
    status: row.status,
    markdown_content: row.markdown_content,
    extracted_data: row.extracted_data,
    confidence_score: row.confidence_score,
    started_at: row.started_at,
    completed_at: row.completed_at,
    error: row.error,
  }));
}

/**
 * Full-text search across properties by address.
 * Uses trigram similarity for fuzzy matching.
 */
export async function searchProperties(
  query: string
): Promise<PropertySearchResult[]> {
  // MVP fallback:
  // if (!isSupabaseConfigured()) {
  //   return [...inMemoryCache.values()]
  //     .filter(p => p.address.displayAddress.toLowerCase().includes(query.toLowerCase()))
  //     .map(profileToSearchResult);
  // }

  const { data, error } = await supabase()
    .from('properties')
    .select(
      `
      id, address_slug, full_address, suburb, state, postcode,
      property_type, bedrooms, bathrooms, car_spaces, land_area_sqm,
      estimated_value_mid, current_listing_status, current_listing_price
    `
    )
    .or(
      `full_address.ilike.%${query}%,suburb.ilike.%${query}%,postcode.eq.${query}`
    )
    .limit(20);

  if (error) {
    console.error('[searchProperties] Supabase error:', error.message);
    throw new Error(`Failed to search properties: ${error.message}`);
  }

  return (data ?? []).map(
    (row): PropertySearchResult => ({
      id: row.id as PropertyId,
      address: {
        displayAddress: row.full_address,
        suburb: row.suburb,
        state: row.state,
        postcode: row.postcode,
        streetNumber: '',
        streetName: '',
        streetType: '',
      },
      propertyType: row.property_type ?? 'other',
      bedrooms: row.bedrooms ?? undefined,
      bathrooms: row.bathrooms ?? undefined,
      carSpaces: row.car_spaces ?? undefined,
      landAreaSqm: row.land_area_sqm ?? undefined,
      estimatedValue: row.estimated_value_mid
        ? { amount: row.estimated_value_mid, currency: 'AUD' }
        : undefined,
      currentlyListed: row.current_listing_status === 'active',
      listingPrice: row.current_listing_price
        ? { amount: row.current_listing_price, currency: 'AUD' }
        : undefined,
      matchScore: 1, // TODO: implement proper scoring with pg_trgm similarity()
    })
  );
}

// ─── Row-to-type mappers ────────────────────────────────────────────────────

/**
 * Convert a raw Supabase row (with joined relations) into a PropertyProfile.
 * This is intentionally lenient — missing fields become undefined/empty arrays.
 */
function rowToProfile(row: Record<string, unknown>): PropertyProfile {
  const r = row as Record<string, any>;

  return {
    id: r.id as PropertyId,
    address: {
      displayAddress: r.full_address ?? '',
      unitNumber: r.unit ?? undefined,
      streetNumber: r.street_number ?? '',
      streetName: r.street_name ?? '',
      streetType: r.street_type ?? '',
      suburb: r.suburb ?? '',
      state: r.state ?? 'NSW',
      postcode: r.postcode ?? '',
      coordinates:
        r.lat != null && r.lng != null
          ? { latitude: r.lat, longitude: r.lng }
          : undefined,
    },
    physicalAttributes: {
      propertyType: r.property_type ?? 'other',
      bedrooms: r.bedrooms ?? undefined,
      bathrooms: r.bathrooms ?? undefined,
      carSpaces: r.car_spaces ?? undefined,
      landAreaSqm: r.land_area_sqm ?? undefined,
      buildingAreaSqm: r.building_area_sqm ?? undefined,
      yearBuilt: r.year_built ?? undefined,
      construction: r.construction ?? undefined,
      roofType: r.roof_type ?? undefined,
      features: Array.isArray(r.features) ? r.features : [],
      outdoorFeatures: [],
      indoorFeatures: [],
    },
    valuation:
      r.estimated_value_mid != null
        ? {
            estimatedValue: { amount: r.estimated_value_mid, currency: 'AUD' },
            lowRange: {
              amount: r.estimated_value_low ?? r.estimated_value_mid,
              currency: 'AUD',
            },
            highRange: {
              amount: r.estimated_value_high ?? r.estimated_value_mid,
              currency: 'AUD',
            },
            confidence: {
              level: confidenceLevelFromScore(r.value_confidence),
              score: r.value_confidence ?? 0,
              sourceCount: 1,
            },
            valuationDate: r.updated_at ?? new Date().toISOString(),
            source: { name: 'propertyiq', crawledAt: r.updated_at ?? new Date().toISOString() },
          }
        : undefined,
    councilValuation:
      r.council_valuation_land != null
        ? {
            landValue: { amount: r.council_valuation_land, currency: 'AUD' },
            improvementsValue: r.council_valuation_improvements
              ? { amount: r.council_valuation_improvements, currency: 'AUD' }
              : undefined,
          }
        : undefined,
    saleHistory: (r.sale_history ?? []).map(
      (s: Record<string, any>) => ({
        id: s.id,
        saleDate: s.sale_date,
        price: { amount: s.price, currency: 'AUD' as const },
        saleType: s.sale_type ?? 'unknown',
        daysOnMarket: s.days_on_market ?? undefined,
        isConfidential: false,
        source: { name: s.source ?? 'unknown', crawledAt: s.created_at },
      })
    ),
    rentalHistory: (r.rental_history ?? []).map(
      (rr: Record<string, any>) => ({
        id: rr.id,
        weeklyRent: { amount: rr.weekly_rent, currency: 'AUD' as const },
        leaseStartDate: rr.start_date ?? undefined,
        leaseEndDate: rr.end_date ?? undefined,
        source: { name: rr.source ?? 'unknown', crawledAt: rr.created_at },
      })
    ),
    currentListing:
      r.current_listing_status
        ? {
            id: '' as any,
            listingType: 'sale',
            status: r.current_listing_status,
            dateFirstListed: r.updated_at ?? '',
            dateLastUpdated: r.updated_at ?? '',
            daysOnMarket: 0,
            headline: '',
            description: '',
            agency: r.current_listing_agent ?? '',
            price: r.current_listing_price
              ? { amount: r.current_listing_price, currency: 'AUD' }
              : undefined,
            inspectionTimes: [],
            sourceUrl: r.current_listing_url ?? '',
            source: { name: 'listing', crawledAt: r.updated_at ?? '' },
          }
        : undefined,
    listingHistory: [],
    location: {
      nearbySchools: [],
      nearbyChildcare: [],
      nearbyTransport: [],
    },
    planningHistory: [],
    media: {
      photos: (r.photos ?? []).map((p: Record<string, any>, i: number) => ({
        url: p.url,
        caption: p.caption ?? undefined,
        order: p.sort_order ?? i,
        source: { name: p.source ?? 'unknown', crawledAt: p.created_at },
      })),
      floorplans: [],
      videos: [],
      virtualTours: [],
    },
    fieldProvenance: {},
    overallConfidence: {
      level: confidenceLevelFromScore(r.overall_confidence),
      score: r.overall_confidence ?? 0,
      sourceCount: (r.data_sources ?? []).length,
    },
    dataSources: (r.data_sources ?? []).map((ds: Record<string, any>) => ({
      name: ds.source_name,
      url: ds.url ?? undefined,
      crawledAt: ds.last_crawled ?? ds.created_at,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function confidenceLevelFromScore(
  score: number | null | undefined
): 'very-low' | 'low' | 'medium' | 'high' | 'very-high' {
  if (score == null || score < 0.2) return 'very-low';
  if (score < 0.4) return 'low';
  if (score < 0.6) return 'medium';
  if (score < 0.8) return 'high';
  return 'very-high';
}

// ─── Property Cache (Supabase-backed, cross-restart persistence) ─────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Retrieve a cached MergedPropertyProfile from Supabase.
 * Returns null if not found, expired (>24hr), or Supabase not configured.
 */
export async function getCachedProfile(
  slug: string
): Promise<MergedPropertyProfile | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const { data, error } = await supabase()
      .from('property_cache')
      .select('raw_data, cached_at')
      .eq('address_slug', slug)
      .single();

    if (error || !data) {
      if (error && error.code !== 'PGRST116') {
        console.error('[getCachedProfile] Supabase error:', error.message);
      }
      return null;
    }

    const cachedAt = new Date(data.cached_at).getTime();
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      return null;
    }

    return data.raw_data as MergedPropertyProfile;
  } catch (err) {
    console.error('[getCachedProfile] Unexpected error:', err);
    return null;
  }
}

/**
 * Save a MergedPropertyProfile to Supabase property_cache.
 * Silently no-ops if Supabase is not configured.
 */
export async function saveCachedProfile(
  slug: string,
  profile: MergedPropertyProfile
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await supabase()
      .from('property_cache')
      .upsert(
        { address_slug: slug, raw_data: profile, cached_at: new Date().toISOString() },
        { onConflict: 'address_slug' }
      );

    if (error) {
      console.error('[saveCachedProfile] Supabase error:', error.message);
    }
  } catch (err) {
    console.error('[saveCachedProfile] Unexpected error:', err);
  }
}

/**
 * Delete a cached profile row from Supabase property_cache (cache invalidation,
 * plan 008). Fail-soft: no-ops when Supabase is unconfigured and never throws,
 * so a `?refresh=1` request can force a re-crawl without depending on the DB.
 */
export async function deleteCachedProfile(slug: string): Promise<void> {
  if (!isSupabaseConfigured() || !slug) return;
  try {
    const { error } = await supabase().from('property_cache').delete().eq('address_slug', slug);
    if (error) console.error('[deleteCachedProfile] Supabase error:', error.message);
  } catch (err) {
    console.error('[deleteCachedProfile] Unexpected error:', err);
  }
}

/**
 * Batch-fetch cached MergedPropertyProfiles for many slugs in one query.
 * Unlike getCachedProfile(), this does NOT apply the 24hr TTL — for the street
 * comparison table we surface whatever is stored (staleness is acceptable).
 * Returns a Map keyed by address_slug; missing slugs are simply absent.
 */
export async function getCachedProfilesBySlugs(
  slugs: string[]
): Promise<Map<string, MergedPropertyProfile>> {
  const result = new Map<string, MergedPropertyProfile>();
  if (!isSupabaseConfigured() || slugs.length === 0) return result;

  try {
    const { data, error } = await supabase()
      .from('property_cache')
      .select('address_slug, raw_data')
      .in('address_slug', slugs);

    if (error) {
      console.error('[getCachedProfilesBySlugs] Supabase error:', error.message);
      return result;
    }

    for (const row of data ?? []) {
      result.set(row.address_slug as string, row.raw_data as MergedPropertyProfile);
    }
    return result;
  } catch (err) {
    console.error('[getCachedProfilesBySlugs] Unexpected error:', err);
    return result;
  }
}

// ─── Agency Queries ──────────────────────────────────────────────────────────

export interface AgencyRecord {
  id?: string;
  name: string;
  website: string;
  suburb?: string;
  state: string;
  postcode?: string;
  franchise_group?: string;
  search_pattern?: string;
  suburbs_covered?: string[];
  enabled?: boolean;
  url_verified?: boolean;
  last_crawled?: string;
  consecutive_failures?: number;
}

export async function getAgenciesByState(state: string): Promise<AgencyRecord[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase()
    .from('agencies')
    .select('*')
    .eq('state', state.toUpperCase())
    .eq('enabled', true)
    .order('name');
  if (error) { console.error('[getAgenciesByState]', error.message); return []; }
  return data ?? [];
}

export async function upsertAgency(agency: AgencyRecord): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase()
    .from('agencies')
    .upsert(agency, { onConflict: 'website,suburb' });
  if (error) console.error('[upsertAgency]', error.message);
}

export async function markAgencyFailure(website: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabase().rpc('increment_agency_failures', { p_website: website });
}

// ─── Crawl Queue Queries ──────────────────────────────────────────────────────

export interface CrawlQueueJob {
  id?: string;
  job_type: string;
  payload: Record<string, unknown>;
  priority?: number;
  status?: string;
  attempts?: number;
  next_attempt?: string;
}

export async function enqueueJob(job: CrawlQueueJob): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase().from('crawl_queue').insert({
    job_type: job.job_type,
    payload: job.payload,
    priority: job.priority ?? 5,
    status: 'pending',
    next_attempt: job.next_attempt ?? new Date().toISOString(),
  });
  if (error) console.error('[enqueueJob]', error.message);
}

export async function claimNextJob(jobType?: string): Promise<CrawlQueueJob | null> {
  if (!isSupabaseConfigured()) return null;
  const query = supabase()
    .from('crawl_queue')
    .select('*')
    .in('status', ['pending'])
    .lte('next_attempt', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);
  if (jobType) query.eq('job_type', jobType);
  const { data, error } = await query;
  if (error || !data?.length) return null;
  const job = data[0];
  await supabase()
    .from('crawl_queue')
    .update({ status: 'running', attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', job.id);
  return job;
}

export async function completeJob(id: string, result?: Record<string, unknown>): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabase()
    .from('crawl_queue')
    .update({ status: 'completed', result: result ?? null, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function failJob(id: string, error: string, retryAfterMs = 60_000): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { data } = await supabase().from('crawl_queue').select('attempts, max_attempts').eq('id', id).single();
  const exhausted = data && data.attempts >= data.max_attempts;
  await supabase()
    .from('crawl_queue')
    .update({
      status: exhausted ? 'failed' : 'pending',
      error,
      next_attempt: new Date(Date.now() + retryAfterMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

// ─── Suburb Progress Queries ─────────────────────────────────────────────────

export async function getSuburbsDueForCrawl(
  state: string,
  limit: number = 20
): Promise<Array<{ suburb: string; state: string; postcode: string }>> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase()
    .from('suburb_crawl_progress')
    .select('suburb, state, postcode')
    .eq('state', state.toUpperCase())
    .or(`next_due.is.null,next_due.lte.${new Date().toISOString()}`)
    .order('next_due', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) { console.error('[getSuburbsDueForCrawl]', error.message); return []; }
  return data ?? [];
}

export async function markSuburbCrawled(
  suburb: string,
  state: string,
  postcode: string,
  listingsFound: number = 0,
  nextDueMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const now = new Date().toISOString();
  const nextDue = new Date(Date.now() + nextDueMs).toISOString();
  await supabase().from('suburb_crawl_progress').upsert({
    suburb, state: state.toUpperCase(), postcode,
    last_crawled: now, next_due: nextDue, listings_found: listingsFound,
  }, { onConflict: 'suburb,state' });
}

// ─── Address Universe Queries (enumeration, e.g. G-NAF) ─────────────────────

export interface AddressRecord {
  address_slug: string;
  raw_address: string;
  street_number?: string;
  street_name?: string;
  street_type?: string;
  suburb?: string;
  state: string;
  postcode?: string;
  lat?: number;
  lng?: number;
  source?: string;
}

export async function insertAddresses(addresses: AddressRecord[]): Promise<void> {
  if (!isSupabaseConfigured() || addresses.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const { error } = await supabase()
      .from('addresses')
      .upsert(chunk, { onConflict: 'address_slug', ignoreDuplicates: true });
    if (error) console.error('[insertAddresses] chunk error:', error.message);
  }
}

/** Distinct addresses for a suburb from the addresses table (paginated). */
export async function getAddressesForSuburb(
  suburb: string,
  state: string
): Promise<AddressRecord[]> {
  if (!isSupabaseConfigured()) return [];
  const out: AddressRecord[] = [];
  const PAGE = 1000;
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase()
      .from('addresses')
      .select('*')
      .ilike('suburb', normaliseSuburbAlias(suburb))
      .eq('state', state.toUpperCase())
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { console.error('[getAddressesForSuburb]', error.message); break; }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Suburbs ranked by address count (drives "biggest first" when using G-NAF). */
export async function getSuburbAddressCounts(
  state: string,
  postcodes?: ReadonlySet<string>
): Promise<Array<{ suburb: string; postcode: string; count: number }>> {
  if (!isSupabaseConfigured()) return [];
  const counts = new Map<string, { suburb: string; postcode: string; count: number }>();
  const PAGE = 1000;
  const MAX_PAGES = 500;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase()
      .from('addresses')
      .select('suburb, postcode')
      .eq('state', state.toUpperCase())
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (postcodes) q = q.in('postcode', Array.from(postcodes));
    const { data, error } = await q;
    if (error) { console.error('[getSuburbAddressCounts]', error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const suburb = (row.suburb ?? '').trim();
      if (!suburb) continue;
      const key = suburb.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { suburb, postcode: row.postcode ?? '', count: 1 });
    }
    if (data.length < PAGE) break;
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

// ─── Property Sales Queries ───────────────────────────────────────────────────

export interface PropertySaleRecord {
  address_slug?: string;
  raw_address: string;
  suburb?: string;
  state: string;
  postcode?: string;
  lot_number?: string;
  plan_number?: string;
  land_area_sqm?: number;
  building_area_sqm?: number;
  property_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  car_spaces?: number;
  agency_name?: string;
  agent_name?: string;
  listing_url?: string;
  image_url?: string;
  sale_price?: number;
  sale_date?: string;
  listed_date?: string;
  settlement_date?: string;
  latitude?: number;
  longitude?: number;
  source: string;
  raw_data?: Record<string, unknown>;
}

export async function insertPropertySales(sales: PropertySaleRecord[]): Promise<void> {
  if (!isSupabaseConfigured() || sales.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < sales.length; i += CHUNK) {
    const chunk = sales.slice(i, i + CHUNK);
    const { error } = await supabase()
      .from('property_sales')
      .upsert(chunk, { onConflict: 'raw_address,sale_date,sale_price,source', ignoreDuplicates: true });
    if (error) console.error('[insertPropertySales] chunk error:', error.message);
  }
}

/**
 * Tally property_sales rows by suburb, restricted to an optional postcode set,
 * returning suburbs ordered by sale count (descending). Drives the
 * "biggest suburbs first" backfill order. Paginates the suburb column rather
 * than relying on a DB group-by (no RPC required).
 */
export async function getSuburbSalesCounts(
  state: string,
  postcodes?: ReadonlySet<string>
): Promise<Array<{ suburb: string; postcode: string; count: number }>> {
  if (!isSupabaseConfigured()) return [];

  const counts = new Map<string, { suburb: string; postcode: string; count: number }>();
  const PAGE = 1000;
  const MAX_PAGES = 200; // safety guard (~200k rows)

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase()
      .from('property_sales')
      .select('suburb, postcode')
      .eq('state', state.toUpperCase())
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (postcodes) q = q.in('postcode', Array.from(postcodes));

    const { data, error } = await q;
    if (error) { console.error('[getSuburbSalesCounts]', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const suburb = (row.suburb ?? '').trim();
      if (!suburb) continue;
      const key = suburb.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { suburb, postcode: row.postcode ?? '', count: 1 });
    }

    if (data.length < PAGE) break;
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

/**
 * Distinct addresses (by slug) for a suburb from property_sales — the address
 * universe the backfill enqueues crawl jobs for. Paginates; not date-limited.
 */
export async function getSalesAddressesForSuburb(
  suburb: string,
  state: string
): Promise<Array<{ address_slug: string | null; raw_address: string; suburb?: string; postcode?: string }>> {
  if (!isSupabaseConfigured()) return [];
  const seen = new Set<string>();
  const out: Array<{ address_slug: string | null; raw_address: string; suburb?: string; postcode?: string }> = [];
  const PAGE = 1000;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase()
      .from('property_sales')
      .select('address_slug, raw_address, suburb, postcode')
      .ilike('suburb', normaliseSuburbAlias(suburb))
      .eq('state', state.toUpperCase())
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { console.error('[getSalesAddressesForSuburb]', error.message); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = (row.address_slug ?? row.raw_address ?? '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** Per-suburb crawl progress rows for a state (suburb → next_due). */
export async function getSuburbProgress(
  state: string
): Promise<Array<{ suburb: string; next_due: string | null }>> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase()
    .from('suburb_crawl_progress')
    .select('suburb, next_due')
    .eq('state', state.toUpperCase());
  if (error) { console.error('[getSuburbProgress]', error.message); return []; }
  return data ?? [];
}

/** Count crawl_queue rows of a job type created since an ISO timestamp (daily-cap guard). */
export async function countRecentJobs(jobType: string, sinceIso: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { count, error } = await supabase()
    .from('crawl_queue')
    .select('id', { count: 'exact', head: true })
    .eq('job_type', jobType)
    .gte('created_at', sinceIso);
  if (error) { console.error('[countRecentJobs]', error.message); return 0; }
  return count ?? 0;
}

export async function getSalesForSuburb(
  suburb: string,
  state: string,
  limitDays: number = 730,
  limit: number = 200
): Promise<PropertySaleRecord[]> {
  if (!isSupabaseConfigured()) return [];
  const since = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data, error } = await supabase()
    .from('property_sales')
    .select('*')
    .ilike('suburb', normaliseSuburbAlias(suburb))
    .eq('state', state.toUpperCase())
    .gte('sale_date', since)
    .order('sale_date', { ascending: false })
    .limit(limit);
  if (error) { console.error('[getSalesForSuburb]', error.message); return []; }
  return data ?? [];
}

// ─── On-market Listings & Rentals (Domain Apify feeds) ───────────────────────

export interface PropertyListingRecord {
  raw_address: string;
  address_slug?: string;
  suburb?: string;
  state: string;
  postcode?: string;
  display_price?: string;
  price_low?: number;
  price_high?: number;
  status?: string;
  bedrooms?: number;
  bathrooms?: number;
  car_spaces?: number;
  land_area_sqm?: number;
  property_type?: string;
  agency_name?: string;
  agent_name?: string;
  listing_url?: string;
  image_url?: string;
  latitude?: number;
  longitude?: number;
  source: string;
  last_seen_at?: string;
  created_at?: string;
  listed_date?: string;
  active?: boolean;
  raw_data?: Record<string, unknown>;
}

export interface PropertyRentalRecord {
  raw_address: string;
  address_slug?: string;
  suburb?: string;
  state: string;
  postcode?: string;
  display_price?: string;
  weekly_rent?: number;
  status?: string;
  bedrooms?: number;
  bathrooms?: number;
  car_spaces?: number;
  land_area_sqm?: number;
  property_type?: string;
  agency_name?: string;
  agent_name?: string;
  listing_url?: string;
  image_url?: string;
  latitude?: number;
  longitude?: number;
  source: string;
  last_seen_at?: string;
  created_at?: string;
  listed_date?: string;
  active?: boolean;
  raw_data?: Record<string, unknown>;
}

async function upsertRows(table: string, rows: object[], onConflict: string): Promise<void> {
  if (!isSupabaseConfigured() || rows.length === 0) return;
  // De-dupe by the conflict key (last write wins): PostgREST rejects an upsert
  // whose batch touches the same conflict target twice.
  const cols = onConflict.split(',').map((c) => c.trim());
  const byKey = new Map<string, object>();
  for (const row of rows) {
    const key = cols.map((c) => String((row as Record<string, unknown>)[c] ?? '')).join(' ');
    byKey.set(key, row);
  }
  const deduped = [...byKey.values()];
  const CHUNK = 500;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    // merge-duplicates → re-runs update in place, never insert duplicates
    const { error } = await supabase().from(table).upsert(chunk, { onConflict, ignoreDuplicates: false });
    if (error) console.error(`[upsert ${table}] chunk error:`, error.message);
  }
}

export function insertPropertyListings(rows: PropertyListingRecord[]): Promise<void> {
  return upsertRows('property_listings', rows, 'raw_address,source');
}

export function insertPropertyRentals(rows: PropertyRentalRecord[]): Promise<void> {
  return upsertRows('property_rentals', rows, 'raw_address,source');
}

// ─── Feed-seed lookup (per-property profile fallback) ────────────────────────

export type FeedKind = 'sold' | 'on-market' | 'rent';

export interface FeedSeed {
  feed: FeedKind;
  /** The raw feed row (select('*')) — column shapes per PropertySale/Listing/RentalRecord. */
  row: Record<string, unknown>;
}

/**
 * Fetch the single best feed row for an `address_slug` to seed a property
 * profile when the live crawl yields nothing. Precedence: sold → on-market →
 * rent; most recent row within a category. Selects all columns (so newer
 * attribute columns are picked up without a code change) and fails soft —
 * Supabase unconfigured or any query error returns null rather than throwing.
 *
 * Mirrors how the healthy direct-DB endpoints read these tables; the returned
 * row is mapped into merger field keys by `mapFeedRowToProfileFields`.
 */
export async function getFeedSeedBySlug(slug: string): Promise<FeedSeed | null> {
  if (!isSupabaseConfigured() || !slug) return null;

  const lookups: Array<{ feed: FeedKind; table: string; orderBy: string }> = [
    { feed: 'sold', table: 'property_sales', orderBy: 'sale_date' },
    { feed: 'on-market', table: 'property_listings', orderBy: 'last_seen_at' },
    { feed: 'rent', table: 'property_rentals', orderBy: 'last_seen_at' },
  ];

  for (const { feed, table, orderBy } of lookups) {
    try {
      const { data, error } = await supabase()
        .from(table)
        .select('*')
        .eq('address_slug', slug)
        .order(orderBy, { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) {
        console.warn(`[getFeedSeedBySlug] ${table} error:`, error.message);
        continue;
      }
      const row = data?.[0] as Record<string, unknown> | undefined;
      if (row) return { feed, row };
    } catch (e) {
      console.warn(`[getFeedSeedBySlug] ${table} threw:`, e);
    }
  }

  return null;
}

export interface FeedHealthUpdate {
  category: 'sold' | 'on-market' | 'rent';
  source_used?: string;
  items: number;
  newest_row_at?: string | null;
  status: 'ok' | 'blocked' | 'broken';
}

/** Upsert a feed_health row after an ingest run (migration 007). Fail-soft. */
export async function writeFeedHealth(h: FeedHealthUpdate): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase()
    .from('feed_health')
    .upsert(
      {
        category: h.category,
        last_run_at: nowIso,
        source_used: h.source_used ?? null,
        items: h.items,
        newest_row_at: h.newest_row_at ?? null,
        status: h.status,
        updated_at: nowIso,
      },
      { onConflict: 'category' },
    );
  if (error) console.error('[writeFeedHealth]', error.message);
}

export interface ListingQueryFilters {
  /** Only listings listed within the last N days (by listed_date, falling back to created_at). */
  sinceDays?: number;
}

export async function getListingsForSuburb(
  suburb: string, state: string, limit = 200, filters: ListingQueryFilters = {}
): Promise<PropertyListingRecord[]> {
  if (!isSupabaseConfigured()) return [];
  // Push the date predicate into the query so it applies BEFORE the limit
  // (filtering post-limit would silently drop matches beyond the cap).
  let q = supabase()
    .from('property_listings')
    .select('*')
    .ilike('suburb', normaliseSuburbAlias(suburb))
    .eq('state', state.toUpperCase())
    .eq('active', true);
  if (filters.sinceDays && filters.sinceDays > 0) {
    const sinceIso = new Date(Date.now() - filters.sinceDays * 86_400_000).toISOString();
    q = q.or(listedSinceOrClause(sinceIso));
  }
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[getListingsForSuburb]', error.message); return []; }
  return data ?? [];
}

// A row is "listed within N days" when COALESCE(listed_date, created_at) >= since
// — i.e. the real scraped date if known, else first-seen. Expressed as a PostgREST
// .or() so it pushes into the DB query (before the limit) rather than post-filtering.
function listedSinceOrClause(sinceIso: string): string {
  return `listed_date.gte.${sinceIso},and(listed_date.is.null,created_at.gte.${sinceIso})`;
}

export interface RentalQueryFilters {
  /** Only rentals listed within the last N days (by listed_date, falling back to created_at). */
  sinceDays?: number;
  /** weekly_rent lower/upper bounds (inclusive). */
  minRent?: number;
  maxRent?: number;
}

export async function getRentalsForSuburb(
  suburb: string, state: string, limit = 200, filters: RentalQueryFilters = {}
): Promise<PropertyRentalRecord[]> {
  if (!isSupabaseConfigured()) return [];
  // Push the rent/date predicates into the query so they apply BEFORE the limit
  // (filtering post-limit would silently drop matches beyond the cap).
  let q = supabase()
    .from('property_rentals')
    .select('*')
    .ilike('suburb', normaliseSuburbAlias(suburb))
    .eq('state', state.toUpperCase())
    .eq('active', true);
  if (typeof filters.minRent === 'number') q = q.gte('weekly_rent', filters.minRent);
  if (typeof filters.maxRent === 'number') q = q.lte('weekly_rent', filters.maxRent);
  if (filters.sinceDays && filters.sinceDays > 0) {
    const sinceIso = new Date(Date.now() - filters.sinceDays * 86_400_000).toISOString();
    q = q.or(listedSinceOrClause(sinceIso));
  }
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[getRentalsForSuburb]', error.message); return []; }
  return data ?? [];
}

/**
 * Active on-market listings + recent sales attributed to an agent. Matches on the
 * comma-joined `agent_name` (ILIKE contains), optionally narrowed by agency. The
 * caller merges/sorts/caps for the agent-listings API.
 */
export async function getAgentListings(opts: {
  name: string;
  agency?: string;
  limit?: number;
}): Promise<{ listings: PropertyListingRecord[]; sales: PropertySaleRecord[] }> {
  if (!isSupabaseConfigured()) return { listings: [], sales: [] };
  const lim = opts.limit ?? 20;
  const nameLike = `%${opts.name}%`;
  const agencyLike = opts.agency ? `%${opts.agency}%` : null;

  let lq = supabase()
    .from('property_listings')
    .select('*')
    .ilike('agent_name', nameLike)
    .eq('active', true);
  if (agencyLike) lq = lq.ilike('agency_name', agencyLike);

  let sq = supabase()
    .from('property_sales')
    .select('*')
    .ilike('agent_name', nameLike);
  if (agencyLike) sq = sq.ilike('agency_name', agencyLike);

  const [l, s] = await Promise.all([
    lq.order('created_at', { ascending: false }).limit(lim),
    sq.order('sale_date', { ascending: false }).limit(lim),
  ]);
  if (l.error) console.error('[getAgentListings listings]', l.error.message);
  if (s.error) console.error('[getAgentListings sales]', s.error.message);
  return { listings: l.data ?? [], sales: s.data ?? [] };
}

/**
 * Expire on-market rows not seen in the latest sync: set active=false for rows in
 * the given suburbs whose last_seen_at predates the run start. Scoped to the
 * scraped suburbs so it never touches unrelated areas. `table` is
 * 'property_listings' | 'property_rentals'.
 */
export async function expireNotSeen(
  table: 'property_listings' | 'property_rentals',
  suburbs: string[],
  sinceIso: string,
  state = 'VIC'
): Promise<number> {
  if (!isSupabaseConfigured() || suburbs.length === 0) return 0;
  const { data, error } = await supabase()
    .from(table)
    .update({ active: false })
    .in('suburb', suburbs)
    .eq('state', state.toUpperCase())
    .eq('active', true)
    .lt('last_seen_at', sinceIso)
    .select('id');
  if (error) { console.error(`[expireNotSeen ${table}]`, error.message); return 0; }
  return data?.length ?? 0;
}

/**
 * Bounding-box fetch around a point for any table with latitude/longitude
 * columns (property_sales, property_listings, property_rentals). Callers refine
 * with a precise haversine distance in code. ~111km per degree of latitude.
 */
export async function getRowsNearby<T = Record<string, unknown>>(
  table: string,
  lat: number,
  lng: number,
  radiusKm: number,
  limit = 500
): Promise<T[]> {
  if (!isSupabaseConfigured()) return [];
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  const { data, error } = await supabase()
    .from(table)
    .select('*')
    .gte('latitude', lat - latDelta)
    .lte('latitude', lat + latDelta)
    .gte('longitude', lng - lngDelta)
    .lte('longitude', lng + lngDelta)
    .limit(limit);
  if (error) { console.error(`[getRowsNearby ${table}]`, error.message); return []; }
  return (data ?? []) as T[];
}

/** Great-circle distance in km between two lat/lng points. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ─── Property Overrides ──────────────────────────────────────────────────────

export async function getOverrides(
  slug: string
): Promise<Record<string, string>> {
  if (!isSupabaseConfigured()) return {};

  try {
    const { data, error } = await supabase()
      .from('property_overrides')
      .select('field, value')
      .eq('address_slug', slug);

    if (error) {
      console.error('[getOverrides] Supabase error:', error.message);
      return {};
    }

    return Object.fromEntries((data ?? []).map(r => [r.field, r.value]));
  } catch (err) {
    console.error('[getOverrides] Unexpected error:', err);
    return {};
  }
}

export async function saveOverride(
  slug: string,
  field: string,
  value: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await supabase()
      .from('property_overrides')
      .upsert(
        { address_slug: slug, field, value, updated_at: new Date().toISOString() },
        { onConflict: 'address_slug,field' }
      );

    if (error) {
      console.error('[saveOverride] Supabase error:', error.message);
    }
  } catch (err) {
    console.error('[saveOverride] Unexpected error:', err);
  }
}

export async function deleteOverride(
  slug: string,
  field: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await supabase()
      .from('property_overrides')
      .delete()
      .eq('address_slug', slug)
      .eq('field', field);

    if (error) {
      console.error('[deleteOverride] Supabase error:', error.message);
    }
  } catch (err) {
    console.error('[deleteOverride] Unexpected error:', err);
  }
}

// ─── User Property Tracking ──────────────────────────────────────────────────

export interface UserPropertyRecord {
  id: string;
  address_slug: string;
  full_address: string;
  claimed_at: string;
}

export async function getUserProperties(userId: string): Promise<UserPropertyRecord[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase()
      .from('user_properties')
      .select('id, address_slug, full_address, claimed_at')
      .eq('user_id', userId)
      .order('claimed_at', { ascending: false });
    if (error) { console.error('[getUserProperties] Supabase error:', error.message); return []; }
    return data ?? [];
  } catch (err) {
    console.error('[getUserProperties] Unexpected error:', err);
    return [];
  }
}

export async function claimProperty(userId: string, slug: string, fullAddress: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase()
      .from('user_properties')
      .upsert(
        { user_id: userId, address_slug: slug, full_address: fullAddress },
        { onConflict: 'user_id,address_slug' }
      );
    if (error) console.error('[claimProperty] Supabase error:', error.message);
  } catch (err) {
    console.error('[claimProperty] Unexpected error:', err);
  }
}

export async function unclaimProperty(userId: string, slug: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await supabase()
      .from('user_properties')
      .delete()
      .eq('user_id', userId)
      .eq('address_slug', slug);
    if (error) console.error('[unclaimProperty] Supabase error:', error.message);
  } catch (err) {
    console.error('[unclaimProperty] Unexpected error:', err);
  }
}

export async function isPropertyClaimed(userId: string, slug: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { data, error } = await supabase()
      .from('user_properties')
      .select('id')
      .eq('user_id', userId)
      .eq('address_slug', slug)
      .maybeSingle();
    if (error) { console.error('[isPropertyClaimed] Supabase error:', error.message); return false; }
    return data !== null;
  } catch (err) {
    console.error('[isPropertyClaimed] Unexpected error:', err);
    return false;
  }
}
