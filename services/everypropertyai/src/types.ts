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
  source?: string | null;
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
