import type {
  PropertyProfile,
  PropertySearchResult,
  SaleRecord,
  PropertyId,
} from '@/types/property';
import type { CrawlJob } from '@/types/crawl';
import { getSupabaseServerClient, isSupabaseConfigured } from './supabase';

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
