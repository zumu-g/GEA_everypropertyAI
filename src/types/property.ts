// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PropertyId = Brand<string, 'PropertyId'>;
export type SuburbId = Brand<string, 'SuburbId'>;
export type ListingId = Brand<string, 'ListingId'>;
export type SaleId = Brand<string, 'SaleId'>;
export type RentalId = Brand<string, 'RentalId'>;
export type CrawlJobId = Brand<string, 'CrawlJobId'>;

// ─── Address ─────────────────────────────────────────────────────────────────

export interface StructuredAddress {
  unitNumber?: string;
  /** @deprecated Use unitNumber instead */
  unit?: string;
  streetNumber: string;
  streetName: string;
  streetType: string; // "Street" | "Road" | "Avenue" etc.
  suburb: string;
  state: AustralianState | string;
  postcode: string;
  /** Full formatted address string */
  displayAddress?: string;
  /** @deprecated Use displayAddress instead */
  fullAddress?: string;
  /** GPS coordinates */
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  /** Lot/plan identifiers from title */
  lot?: string;
  plan?: string;
  /** Council / LGA name */
  localGovernmentArea?: string;
}

export type AustralianState =
  | 'NSW'
  | 'VIC'
  | 'QLD'
  | 'SA'
  | 'WA'
  | 'TAS'
  | 'NT'
  | 'ACT';

// ─── Property Attributes ────────────────────────────────────────────────────

export type PropertyType =
  | 'house'
  | 'apartment'
  | 'townhouse'
  | 'villa'
  | 'duplex'
  | 'studio'
  | 'land'
  | 'rural'
  | 'commercial'
  | 'industrial'
  | 'other';

export type ConstructionType =
  | 'brick'
  | 'brick-veneer'
  | 'weatherboard'
  | 'fibro'
  | 'concrete'
  | 'steel'
  | 'timber'
  | 'stone'
  | 'rendered'
  | 'clad'
  | 'other';

export type RoofType =
  | 'tile'
  | 'colorbond'
  | 'slate'
  | 'flat'
  | 'metal'
  | 'concrete'
  | 'other';

export interface PhysicalAttributes {
  propertyType: PropertyType;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  garages?: number;
  landAreaSqm?: number;
  buildingAreaSqm?: number;
  frontageMetres?: number;
  depthMetres?: number;
  yearBuilt?: number;
  construction?: ConstructionType;
  roofType?: RoofType;
  storeys?: number;
  features: string[];
  /** e.g. "pool", "solar", "granny-flat" */
  outdoorFeatures: string[];
  /** e.g. "ducted-ac", "alarm", "intercom" */
  indoorFeatures: string[];
  /** Strata or body corporate details */
  strata?: {
    planNumber?: string;
    totalUnitsInBlock?: number;
    strataLevy?: MoneyAmount;
    levyFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'annually';
    managingAgent?: string;
  };
}

// ─── Financial ───────────────────────────────────────────────────────────────

export interface MoneyAmount {
  amount: number;
  currency: 'AUD';
}

export interface Valuation {
  estimatedValue: MoneyAmount;
  lowRange: MoneyAmount;
  highRange: MoneyAmount;
  confidence: ConfidenceScore;
  valuationDate: string; // ISO date
  source: DataSource;
}

export interface CouncilValuation {
  capitalValue?: MoneyAmount;
  landValue?: MoneyAmount;
  improvementsValue?: MoneyAmount;
  valuationDate?: string;
  ratingAuthority?: string;
}

// ─── Sale History ────────────────────────────────────────────────────────────

export type SaleType =
  | 'private-treaty'
  | 'auction'
  | 'expression-of-interest'
  | 'tender'
  | 'off-market'
  | 'unknown';

export interface SaleRecord {
  id: SaleId;
  saleDate: string; // ISO date
  price: MoneyAmount;
  saleType: SaleType;
  /** Days on market before sold */
  daysOnMarket?: number;
  /** Sold price vs listing price */
  listingPrice?: MoneyAmount;
  agency?: string;
  agentName?: string;
  buyers?: string;
  sellers?: string;
  isConfidential: boolean;
  settlementDate?: string;
  contractDate?: string;
  source: DataSource;
}

// ─── Rental History ──────────────────────────────────────────────────────────

export interface RentalRecord {
  id: RentalId;
  leaseStartDate?: string;
  leaseEndDate?: string;
  weeklyRent: MoneyAmount;
  bond?: MoneyAmount;
  leaseTerm?: string; // e.g. "12 months"
  agency?: string;
  propertyManager?: string;
  daysOnMarket?: number;
  source: DataSource;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export type ListingStatus =
  | 'active'
  | 'under-offer'
  | 'sold'
  | 'withdrawn'
  | 'off-market'
  | 'leased';

export type ListingType = 'sale' | 'rent' | 'auction';

export interface ListingRecord {
  id: ListingId;
  listingType: ListingType;
  status: ListingStatus;
  /** Display price text, e.g. "Offers over $1.2m" */
  priceText?: string;
  /** Parsed numeric price if available */
  price?: MoneyAmount;
  priceFrom?: MoneyAmount;
  priceTo?: MoneyAmount;
  auctionDate?: string;
  auctionVenue?: string;
  dateFirstListed: string;
  dateLastUpdated: string;
  daysOnMarket: number;
  headline: string;
  description: string;
  agency: string;
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
  inspectionTimes: InspectionTime[];
  sourceUrl: string;
  source: DataSource;
}

export interface InspectionTime {
  startDateTime: string; // ISO datetime
  endDateTime: string;
  isBookingRequired: boolean;
}

// ─── Location ────────────────────────────────────────────────────────────────

export interface SuburbProfile {
  id: SuburbId;
  name: string;
  state: AustralianState;
  postcode: string;
  medianHousePrice?: MoneyAmount;
  medianUnitPrice?: MoneyAmount;
  medianRentHouse?: MoneyAmount;
  medianRentUnit?: MoneyAmount;
  annualGrowthPercent?: number;
  rentalYieldPercent?: number;
  populationCount?: number;
  medianAge?: number;
  medianHouseholdIncome?: MoneyAmount;
  ownerOccupiedPercent?: number;
  renterPercent?: number;
  familyHouseholdsPercent?: number;
  /** Stock on market as percent of total dwellings */
  stockOnMarketPercent?: number;
  averageDaysOnMarket?: number;
  auctionClearanceRatePercent?: number;
  /** Demand/supply indicator */
  demandLevel?: 'very-low' | 'low' | 'balanced' | 'high' | 'very-high';
  /** Top amenities / character descriptors */
  suburbCharacter: string[];
  source: DataSource;
}

export interface SchoolInfo {
  name: string;
  type: 'primary' | 'secondary' | 'combined' | 'special';
  sector: 'government' | 'catholic' | 'independent';
  distanceKm: number;
  ranking?: number;
  icseaScore?: number;
  enrolmentCount?: number;
  website?: string;
}

export interface TransportInfo {
  type: 'train' | 'bus' | 'tram' | 'ferry' | 'light-rail';
  name: string;
  distanceKm: number;
  /** Walking time in minutes */
  walkingMinutes?: number;
  routes?: string[];
}

export type RiskLevel = 'negligible' | 'low' | 'moderate' | 'high' | 'extreme';

export interface EnvironmentalRisk {
  floodRisk: RiskLevel;
  floodZone?: string;
  bushfireRisk: RiskLevel;
  bushfireAttackLevel?: 'BAL-LOW' | 'BAL-12.5' | 'BAL-19' | 'BAL-29' | 'BAL-40' | 'BAL-FZ';
  coastalErosionRisk?: RiskLevel;
  contaminationRisk?: RiskLevel;
  mineSubsidenceRisk?: RiskLevel;
  /** Heritage listing status */
  heritageListed: boolean;
  heritageDetails?: string;
  source: DataSource;
}

export interface ZoningInfo {
  zoneCode: string;
  zoneName: string;
  /** e.g. "R2 - Low Density Residential" */
  zoneDescription?: string;
  minimumLotSize?: number;
  maximumBuildingHeight?: number;
  floorSpaceRatio?: number;
  permittedUses?: string[];
  prohibitedUses?: string[];
  overlays: string[];
  source: DataSource;
}

export interface LocationData {
  suburbProfile?: SuburbProfile;
  nearbySchools: SchoolInfo[];
  nearbyTransport: TransportInfo[];
  environmentalRisk?: EnvironmentalRisk;
  zoning?: ZoningInfo;
  /** Distance to CBD in km */
  distanceToCbdKm?: number;
  /** Walkability / amenity scores */
  walkScore?: number;
  transitScore?: number;
}

// ─── Planning ────────────────────────────────────────────────────────────────

export type PlanningApplicationType =
  | 'development-application'
  | 'complying-development'
  | 'building-approval'
  | 'modification'
  | 'review'
  | 'strata-subdivision'
  | 'subdivision'
  | 'rezoning';

export type PlanningStatus =
  | 'lodged'
  | 'under-assessment'
  | 'on-exhibition'
  | 'determined-approved'
  | 'determined-refused'
  | 'withdrawn'
  | 'deferred'
  | 'appealed';

export interface PlanningRecord {
  applicationNumber: string;
  applicationType: PlanningApplicationType;
  status: PlanningStatus;
  lodgementDate: string;
  determinationDate?: string;
  description: string;
  estimatedCost?: MoneyAmount;
  assessmentAuthority: string;
  applicant?: string;
  /** Nearby DAs (not on this property but within radius) */
  isNearby: boolean;
  distanceMetres?: number;
  documentUrls: string[];
  source: DataSource;
}

// ─── Media ───────────────────────────────────────────────────────────────────

export interface PropertyMedia {
  photos: MediaItem[];
  floorplans: MediaItem[];
  videos: MediaItem[];
  virtualTours: MediaItem[];
}

export interface MediaItem {
  url: string;
  caption?: string;
  /** Order for display */
  order: number;
  width?: number;
  height?: number;
  source: DataSource;
}

// ─── Data Provenance ─────────────────────────────────────────────────────────

export interface DataSource {
  name: string;
  url?: string;
  crawledAt: string; // ISO datetime
  /** How fresh is this data? */
  dataAsOf?: string; // ISO date
}

export type ConfidenceLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface ConfidenceScore {
  level: ConfidenceLevel;
  /** 0-1 numeric score */
  score: number;
  /** Number of independent sources confirming this data */
  sourceCount: number;
  /** Fields that conflicted across sources */
  conflicts?: string[];
  reasoning?: string;
}

export interface FieldProvenance<T = unknown> {
  value: T;
  confidence: ConfidenceScore;
  sources: DataSource[];
  /** When sources disagree, all observed values */
  alternateValues?: { value: T; source: DataSource }[];
  lastVerified: string; // ISO datetime
}

// ─── Unified Property Profile ────────────────────────────────────────────────

export interface PropertyProfile {
  id: PropertyId;
  address: StructuredAddress;
  physicalAttributes: PhysicalAttributes;

  /** Current automated valuation */
  valuation?: Valuation;
  /** Council / rates valuation */
  councilValuation?: CouncilValuation;

  /** Chronological sale history, newest first */
  saleHistory: SaleRecord[];
  /** Chronological rental history, newest first */
  rentalHistory: RentalRecord[];

  /** Current active listing, if any */
  currentListing?: ListingRecord;
  /** Past listings */
  listingHistory: ListingRecord[];

  /** Location intelligence */
  location: LocationData;

  /** Planning applications on or near the property */
  planningHistory: PlanningRecord[];

  /** Photos, floorplans, videos */
  media: PropertyMedia;

  /** Per-field confidence and provenance for key fields */
  fieldProvenance: {
    bedrooms?: FieldProvenance<number>;
    bathrooms?: FieldProvenance<number>;
    carSpaces?: FieldProvenance<number>;
    landAreaSqm?: FieldProvenance<number>;
    buildingAreaSqm?: FieldProvenance<number>;
    yearBuilt?: FieldProvenance<number>;
    estimatedValue?: FieldProvenance<MoneyAmount>;
    [key: string]: FieldProvenance | undefined;
  };

  /** Overall data quality */
  overallConfidence: ConfidenceScore;

  /** All sources that contributed to this profile */
  dataSources: DataSource[];

  /** Timestamps */
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  /** Next scheduled refresh */
  nextRefreshAt?: string;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface PropertySearchResult {
  id: PropertyId;
  address: StructuredAddress;
  propertyType: PropertyType;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landAreaSqm?: number;
  estimatedValue?: MoneyAmount;
  lastSalePrice?: MoneyAmount;
  lastSaleDate?: string;
  currentlyListed: boolean;
  listingPrice?: MoneyAmount;
  thumbnailUrl?: string;
  /** Relevance score for the search, 0-1 */
  matchScore: number;
  /** Summary snippet */
  snippet?: string;
}

export interface PropertySearchRequest {
  query?: string;
  address?: Partial<StructuredAddress>;
  propertyTypes?: PropertyType[];
  bedroomsMin?: number;
  bedroomsMax?: number;
  bathroomsMin?: number;
  priceMin?: number;
  priceMax?: number;
  landAreaMin?: number;
  landAreaMax?: number;
  suburbs?: string[];
  states?: AustralianState[];
  postcodes?: string[];
  listingStatus?: ListingStatus[];
  sortBy?: 'relevance' | 'price-asc' | 'price-desc' | 'date-listed' | 'date-sold';
  page: number;
  pageSize: number;
}

export interface PropertySearchResponse {
  results: PropertySearchResult[];
  totalResults: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets?: {
    propertyTypes: { type: PropertyType; count: number }[];
    priceRanges: { label: string; min: number; max: number; count: number }[];
    suburbs: { name: string; count: number }[];
  };
}

// ─── Legacy / Backward-Compatible Aliases ────────────────────────────────────
// These types maintain compatibility with existing extraction and merger code
// that was written before the comprehensive type system above.

/**
 * Raw extraction result from a single source (used by extractor.ts).
 * Represents what Claude returns after processing a single page.
 */
export interface ExtractedPropertyData {
  source: string;
  raw: Record<string, unknown>;
  data?: Record<string, unknown>;
  extractedAt: Date;
  validationErrors?: { path: string; message: string }[];
  error?: string;
}

/**
 * AI-generated property summary.
 */
export interface PropertySummary {
  headline: string;
  description: string;
  highlights: string[];
  concerns: string[];
  investmentOutlook?: string;
}

/**
 * Per-field confidence metadata (used by merger.ts).
 */
export interface FieldConfidence {
  confidence: number;
  contributedBy: string[];
}

/**
 * A single sale history entry from raw extraction.
 */
export interface SaleHistoryEntry {
  date?: string;
  price?: number;
  type?: string;
  agency?: string;
  agentName?: string;
  daysOnMarket?: number;
  listingPrice?: number;
  isConfidential?: boolean;
  description?: string;
  settlementDate?: string;
  source?: string;
}

/**
 * A single rental history entry from raw extraction.
 */
export interface RentalHistoryEntry {
  date?: string;
  weeklyRent?: number;
  bond?: number;
  agency?: string;
  agentName?: string;
  daysOnMarket?: number;
  leaseTerm?: string;
  description?: string;
}

/**
 * Legacy merged property profile shape returned by the merger.
 * This is the intermediate representation before building a full PropertyProfile.
 */
export interface MergedPropertyProfile {
  data: Record<string, unknown>;
  fieldConfidences: Record<string, FieldConfidence>;
  overallConfidence: number;
  sources: {
    name: string;
    extractedAt: Date;
    hasErrors: boolean;
  }[];
  mergedAt: Date;
}
