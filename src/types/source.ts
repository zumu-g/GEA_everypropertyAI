import type { DataSource, ConfidenceScore } from './property';

// ─── Data Source Names ───────────────────────────────────────────────────────

/**
 * All supported property data portals / sources.
 * Used as a discriminator across the system.
 */
export type DataSourceName =
  // Major listing portals (hyphenated canonical form + dot-notation aliases)
  | 'realestate-com-au'
  | 'realestate.com.au'
  | 'domain-com-au'
  | 'domain.com.au'
  | 'allhomes'
  | 'homely'
  // Data / analytics platforms
  | 'corelogic'
  | 'pricefinder'
  | 'sqm-research'
  | 'htw'
  // Government / council sources
  | 'nsw-valuer-general'
  | 'vic-valuer-general'
  | 'qld-valuer-general'
  | 'sa-valuer-general'
  | 'wa-landgate'
  | 'tas-valuer-general'
  | 'nt-valuer-general'
  | 'act-revenue'
  // Planning portals
  | 'nsw-planning-portal'
  | 'vic-planning-portal'
  | 'council-da-tracker'
  // Environmental / risk
  | 'nsw-flood-data'
  | 'nsw-bushfire-map'
  | 'vic-flood-data'
  // School / education
  | 'myschool'
  | 'better-education'
  // Other
  | 'google-maps'
  | 'openstreetmap'
  | 'abs-census'
  | 'manual-entry';

/** Human-readable labels for each source */
export const DATA_SOURCE_LABELS: Record<DataSourceName, string> = {
  'realestate-com-au': 'realestate.com.au',
  'realestate.com.au': 'realestate.com.au',
  'domain-com-au': 'Domain',
  'domain.com.au': 'Domain',
  'allhomes': 'Allhomes',
  'homely': 'Homely',
  'corelogic': 'CoreLogic',
  'pricefinder': 'PriceFinder',
  'sqm-research': 'SQM Research',
  'htw': 'Herron Todd White',
  'nsw-valuer-general': 'NSW Valuer General',
  'vic-valuer-general': 'VIC Valuer General',
  'qld-valuer-general': 'QLD Valuer General',
  'sa-valuer-general': 'SA Valuer General',
  'wa-landgate': 'WA Landgate',
  'tas-valuer-general': 'TAS Valuer General',
  'nt-valuer-general': 'NT Valuer General',
  'act-revenue': 'ACT Revenue',
  'nsw-planning-portal': 'NSW Planning Portal',
  'vic-planning-portal': 'VIC Planning Portal',
  'council-da-tracker': 'Council DA Tracker',
  'nsw-flood-data': 'NSW Flood Data',
  'nsw-bushfire-map': 'NSW Bushfire Map',
  'vic-flood-data': 'VIC Flood Data',
  'myschool': 'My School',
  'better-education': 'Better Education',
  'google-maps': 'Google Maps',
  'openstreetmap': 'OpenStreetMap',
  'abs-census': 'ABS Census',
  'manual-entry': 'Manual Entry',
};

// ─── Source Extraction ───────────────────────────────────────────────────────

/**
 * Raw extraction from a single source, before merging.
 * Fields are all optional because any given source may only have partial data.
 */
export interface SourceExtraction {
  sourceName: DataSourceName;
  sourceUrl: string;
  crawledAt: string; // ISO datetime
  /** Raw HTML or text that was processed */
  rawContentHash?: string;

  // Address fields
  address?: {
    unitNumber?: string;
    streetNumber?: string;
    streetName?: string;
    streetType?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    displayAddress?: string;
    latitude?: number;
    longitude?: number;
  };

  // Physical attributes
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  garages?: number;
  landAreaSqm?: number;
  buildingAreaSqm?: number;
  yearBuilt?: number;
  construction?: string;
  roofType?: string;
  storeys?: number;
  features?: string[];

  // Pricing / listing
  priceText?: string;
  priceNumeric?: number;
  priceFrom?: number;
  priceTo?: number;
  listingType?: string;
  listingStatus?: string;
  headline?: string;
  description?: string;
  dateFirstListed?: string;
  daysOnMarket?: number;
  auctionDate?: string;

  // Agent
  agencyName?: string;
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;

  // Sale history (array of raw records)
  saleHistory?: Array<{
    date?: string;
    price?: number;
    type?: string;
    agency?: string;
    isConfidential?: boolean;
  }>;

  // Rental history
  rentalHistory?: Array<{
    date?: string;
    weeklyRent?: number;
    agency?: string;
  }>;

  // Valuation
  estimatedValue?: number;
  estimatedValueLow?: number;
  estimatedValueHigh?: number;
  councilValuation?: {
    capitalValue?: number;
    landValue?: number;
    improvementsValue?: number;
    valuationDate?: string;
  };

  // Media
  photoUrls?: string[];
  floorplanUrls?: string[];
  videoUrls?: string[];
  virtualTourUrl?: string;

  // Location
  nearbySchools?: Array<{
    name?: string;
    type?: string;
    sector?: string;
    distanceKm?: number;
  }>;
  nearbyTransport?: Array<{
    type?: string;
    name?: string;
    distanceKm?: number;
  }>;

  // Planning
  planningApplications?: Array<{
    applicationNumber?: string;
    type?: string;
    status?: string;
    lodgementDate?: string;
    description?: string;
    estimatedCost?: number;
  }>;

  // Zoning
  zoneCode?: string;
  zoneName?: string;

  // Risk
  floodRisk?: string;
  bushfireRisk?: string;
  heritageListed?: boolean;

  // Suburb stats (from sources like CoreLogic, SQM)
  suburbStats?: {
    medianHousePrice?: number;
    medianUnitPrice?: number;
    medianRentHouse?: number;
    medianRentUnit?: number;
    annualGrowthPercent?: number;
    rentalYieldPercent?: number;
    population?: number;
    averageDaysOnMarket?: number;
  };

  /** Any additional unstructured data the extraction found */
  metadata?: Record<string, unknown>;
}

// ─── Merged Field ────────────────────────────────────────────────────────────

export type MergeStrategy = 'highest-trust' | 'most-recent' | 'majority-vote' | 'average' | 'manual';

/**
 * A single field after merging data from multiple sources.
 * Tracks which sources contributed and how the final value was chosen.
 */
export interface MergedField<T = unknown> {
  /** The resolved value after merging */
  value: T;
  /** How the value was chosen */
  mergeStrategy: MergeStrategy;
  /** Confidence in the merged value */
  confidence: ConfidenceScore;
  /** All source values that were considered */
  sourceValues: Array<{
    value: T;
    source: DataSource;
    /** Trust rank of this source (lower = more trusted) */
    trustRank: number;
  }>;
  /** Did sources agree? */
  hasConflict: boolean;
  /** If conflict, describe the discrepancy */
  conflictDescription?: string;
  /** Timestamp of the merge */
  mergedAt: string; // ISO datetime
}

/**
 * The full set of merged fields for a property, used during
 * the merge phase before building the final PropertyProfile.
 */
export interface MergedPropertyData {
  extractions: SourceExtraction[];
  mergedFields: {
    propertyType?: MergedField<string>;
    bedrooms?: MergedField<number>;
    bathrooms?: MergedField<number>;
    carSpaces?: MergedField<number>;
    landAreaSqm?: MergedField<number>;
    buildingAreaSqm?: MergedField<number>;
    yearBuilt?: MergedField<number>;
    construction?: MergedField<string>;
    estimatedValue?: MergedField<number>;
    [key: string]: MergedField | undefined;
  };
  /** Overall merge quality */
  overallConfidence: ConfidenceScore;
  mergedAt: string;
}
