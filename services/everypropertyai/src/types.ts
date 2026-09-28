/**
 * Response shapes for the PropertyIQ HTTP API that everypropertyAI wraps.
 * Kept local (not imported from ../../src) so this package stays self-contained,
 * mirroring services/scraper. The profile `data` map is intentionally loose —
 * the app merges 20+ sources into it; consumers read fields by name.
 */

export interface StructuredAddress {
  unitNumber?: string;
  streetNumber: string;
  streetName: string;
  streetType: string;
  suburb: string;
  state: string;
  postcode: string;
  displayAddress?: string;
  coordinates?: { latitude: number; longitude: number };
}

export interface AddressSuggestion {
  placeId?: string;
  description: string;
  structured: StructuredAddress;
}

/** Shape returned by /api/address-suggest (REA) — clean suburb/state/postcode. */
export interface ReaSuggestion {
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  fullAddress: string;
  display?: string;
}

/** What POST /api/property returns. `data` holds the merged property fields. */
export interface MergedPropertyProfile {
  data: Record<string, unknown>;
  fieldConfidences: Record<string, { confidence: number; contributedBy: string[] }>;
  overallConfidence: number;
  sources: { name: string; extractedAt: string; hasErrors: boolean }[];
  mergedAt: string;
}

export interface PropertyResponse {
  profile: MergedPropertyProfile;
  source: "cache" | "fresh" | "partial";
  addressSlug: string;
  warning?: string;
}

export interface ComparableResult {
  address: string;
  suburb: string;
  price: number;
  saleDate: string;
  beds?: number;
  baths?: number;
  landAreaSqm?: number;
  similarityScore: number;
}

export interface SoldSaleResult {
  rawAddress: string;
  suburb: string;
  salePrice: number;
  saleDate: string;
  settlementDate?: string | null;
  landAreaSqm?: number | null;
  propertyType?: string | null;
  agencyName?: string | null;
  agentName?: string | null;
  source?: string | null;
  firstListedDate?: string | null;
  daysOnMarket?: number | null;
  firstListedDateBasis?: 'listed' | 'first_seen' | null;
}

export interface OnMarketListing {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  displayPrice: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  status: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landAreaSqm: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  agencyName: string | null;
  agentName: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  source: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  listedDate: string | null;
  /** Lifecycle fields (additive; absent from servers predating migration 015). */
  lifecycleStatus?: string | null;
  removedAt?: string | null;
  daysOnMarket?: number | null;
  daysOnMarketBasis?: 'listed' | 'first_seen';
  priceHistory?: ListingPriceObservation[];
  saleMethod?: string | null;
  auctionDate?: string | null;
}

export interface ListingPriceObservation {
  observedAt: string;
  displayPrice: string | null;
  /** weekly rent for rentals */
  priceLow: number | null;
  priceHigh: number | null;
}

export interface RentalListing {
  rawAddress: string;
  suburb: string | null;
  postcode: string | null;
  displayPrice: string | null;
  weeklyRent: number | null;
  status: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landAreaSqm: number | null;
  propertyType: string | null;
  latitude: number | null;
  longitude: number | null;
  agencyName: string | null;
  agentName: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  source: string;
  listedDate: string | null;
  /** Lifecycle fields (additive; absent from servers predating migration 015). */
  lifecycleStatus?: string | null;
  removedAt?: string | null;
  leasedAt?: string | null;
  daysOnMarket?: number | null;
  daysOnMarketBasis?: 'listed' | 'first_seen';
  priceHistory?: ListingPriceObservation[];
}

export interface StreetRow {
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  slug: string;
  propertyHref: string;
  landAreaSqm: number | null;
  buildingAreaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garage: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  lastListedDate: string | null;
  listedPrice: number | null;
}

export interface EnrichResponse {
  coordinates?: { lat: number; lng: number } | null;
  planning?: unknown;
  schools?: unknown[];
  transport?: unknown[];
  childcare?: unknown[];
  suburbStats?: unknown;
  buyerDemand?: unknown;
  marketData?: unknown;
}

// ── Composite (everypropertyAI-shaped) ──────────────────────────────────────

export interface CmaPack {
  address: string;
  addressSlug: string;
  source: string;
  subject: {
    bedrooms?: number;
    bathrooms?: number;
    carSpaces?: number;
    landAreaSqm?: number;
    propertyType?: string;
    overallConfidence: number;
  };
  priceEstimate?: unknown;
  comparables: ComparableResult[];
  recentSuburbSales: SoldSaleResult[];
  suburbStats?: unknown;
  marketData?: unknown;
  generatedAt: string;
}

export interface ProposalPropertyData {
  address: string;
  addressSlug: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landAreaSqm?: number;
  propertyType?: string;
  priceEstimate?: unknown;
  formattedEstimate?: string;
  agency?: string;
  agentName?: string;
  heroPhotos: string[];
  suburb?: string;
  description?: string;
  confidence: number;
}

/** One row from GET /api/agents/listings (a listing or a sold sale). */
export interface AgentReferenceListing {
  address: string;
  suburb: string | null;
  status: string;
  price: string | null;
  date: string | null;
  url: string | null;
  imageUrl: string | null;
}

/** GET /api/agents/listings — unknown agent returns { agent: null, listings: [] }. */
export interface AgentListingsResponse {
  agent: { name: string; agency: string | null } | null;
  listings: AgentReferenceListing[];
}

/** One nearby comparable in a vendor report (sold or on-market). */
export interface VendorReportRow {
  rawAddress?: string;
  suburb: string | null;
  distanceMetres: number;
  [key: string]: unknown;
}

/** GET /api/vendor-report — 3 closest sold sales + 3 newest listings around a point. */
export interface VendorReportResponse {
  solds: VendorReportRow[];
  listings: VendorReportRow[];
  [key: string]: unknown;
}

/** One observed asking price for a listing identity (oldest first in priceHistory). */
export interface PriceHistoryEntry {
  observedAt: string;
  displayPrice: string | null;
  priceLow: number | null;
  priceHigh: number | null;
}

/** One asking-price change: latest observation paired with its predecessor. Rentals: low = high = weekly rent. */
export interface PriceChange {
  listingUrl: string | null;
  address: string;
  suburb: string;
  table: "listings" | "rentals";
  previousDisplayPrice: string | null;
  currentDisplayPrice: string | null;
  previousMid: number;
  currentMid: number;
  /** Percentage change on the midpoint, one decimal place; never null or zero. */
  changePct: number;
  changedAt: string;
  priceHistory: PriceHistoryEntry[];
}

/** GET /api/price-changes — newest change first. */
export interface PriceChangesResponse {
  count: number;
  results: PriceChange[];
}

export interface SentimentBasisInput {
  name: "saleToListRatio" | "monthsOfSupply" | "priceCutShare" | "medianDaysOnMarket" | "auctionClearanceRate";
  value: number;
  rangeLow: number;
  rangeHigh: number;
  scaled: number;
  weight: number;
}

export interface SentimentBasis {
  formula: string;
  window: number;
  inputs: SentimentBasisInput[];
  reason?: "insufficient-history";
}

/** One period block of suburb market statistics (R15). Nullable fields are null when the denominator is too small. */
export interface SuburbStatsBlock {
  activeListings: number;
  newListings: number;
  medianAsking: number | null;
  medianDaysOnMarket: number | null;
  priceCutCount: number;
  priceCutMedianPct: number | null;
  withdrawnCount: number;
  salesCount: number;
  medianSalePrice: number | null;
  medianSalePriceHouse: number | null;
  monthsOfSupply: number | null;
  saleToListRatio: number | null;
  auctionsHeld: number;
  auctionsCleared: number;
  auctionClearanceRate: number | null;
  privateSalesClosed: number;
  privateSalesSold: number;
  privateSaleConversionRate: number | null;
  rentalListings: number;
  medianRent: number | null;
  sentimentIndex: number | null;
  sentimentBasis: SentimentBasis;
}

/** GET /api/suburb-stats — current period plus prior and year-ago blocks (null when no data). */
export interface SuburbStatsResponse {
  suburb: string;
  state: string;
  period: "month" | "week";
  periodStart: string;
  periodEnd: string;
  current: SuburbStatsBlock;
  prior: SuburbStatsBlock | null;
  yearAgo: SuburbStatsBlock | null;
  provisional: boolean;
  reconstructed: boolean;
  computedAt: string;
  schemaVersion: number;
}
