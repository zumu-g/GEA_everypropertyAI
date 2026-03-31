import { z } from 'zod';

// ─── Shared Primitives ───────────────────────────────────────────────────────

export const moneyAmountSchema = z.object({
  amount: z.number(),
  currency: z.literal('AUD'),
});

export const australianStateSchema = z.enum([
  'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT',
]);

export const confidenceLevelSchema = z.enum([
  'very-low', 'low', 'medium', 'high', 'very-high',
]);

export const confidenceScoreSchema = z.object({
  level: confidenceLevelSchema,
  score: z.number().min(0).max(1),
  sourceCount: z.number().int().min(0),
  conflicts: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
});

export const dataSourceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  crawledAt: z.string().datetime(),
  dataAsOf: z.string().optional(),
});

export const riskLevelSchema = z.enum([
  'negligible', 'low', 'moderate', 'high', 'extreme',
]);

// ─── Address ─────────────────────────────────────────────────────────────────

export const structuredAddressSchema = z.object({
  unitNumber: z.string().optional(),
  streetNumber: z.string(),
  streetName: z.string(),
  streetType: z.string(),
  suburb: z.string(),
  state: australianStateSchema,
  postcode: z.string().regex(/^\d{4}$/),
  displayAddress: z.string(),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  lot: z.string().optional(),
  plan: z.string().optional(),
  localGovernmentArea: z.string().optional(),
});

// ─── Property Attributes ────────────────────────────────────────────────────

export const propertyTypeSchema = z.enum([
  'house', 'apartment', 'townhouse', 'villa', 'duplex',
  'studio', 'land', 'rural', 'commercial', 'industrial', 'other',
]);

export const constructionTypeSchema = z.enum([
  'brick', 'brick-veneer', 'weatherboard', 'fibro', 'concrete',
  'steel', 'timber', 'stone', 'rendered', 'clad', 'other',
]);

export const roofTypeSchema = z.enum([
  'tile', 'colorbond', 'slate', 'flat', 'metal', 'concrete', 'other',
]);

export const physicalAttributesSchema = z.object({
  propertyType: propertyTypeSchema,
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  carSpaces: z.number().int().min(0).optional(),
  garages: z.number().int().min(0).optional(),
  landAreaSqm: z.number().positive().optional(),
  buildingAreaSqm: z.number().positive().optional(),
  frontageMetres: z.number().positive().optional(),
  depthMetres: z.number().positive().optional(),
  yearBuilt: z.number().int().min(1800).max(2030).optional(),
  construction: constructionTypeSchema.optional(),
  roofType: roofTypeSchema.optional(),
  storeys: z.number().int().min(1).optional(),
  features: z.array(z.string()),
  outdoorFeatures: z.array(z.string()),
  indoorFeatures: z.array(z.string()),
  strata: z.object({
    planNumber: z.string().optional(),
    totalUnitsInBlock: z.number().int().positive().optional(),
    strataLevy: moneyAmountSchema.optional(),
    levyFrequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']).optional(),
    managingAgent: z.string().optional(),
  }).optional(),
});

// ─── Valuation ───────────────────────────────────────────────────────────────

export const valuationSchema = z.object({
  estimatedValue: moneyAmountSchema,
  lowRange: moneyAmountSchema,
  highRange: moneyAmountSchema,
  confidence: confidenceScoreSchema,
  valuationDate: z.string(),
  source: dataSourceSchema,
});

export const councilValuationSchema = z.object({
  capitalValue: moneyAmountSchema.optional(),
  landValue: moneyAmountSchema.optional(),
  improvementsValue: moneyAmountSchema.optional(),
  valuationDate: z.string().optional(),
  ratingAuthority: z.string().optional(),
});

// ─── Sale History ────────────────────────────────────────────────────────────

export const saleTypeSchema = z.enum([
  'private-treaty', 'auction', 'expression-of-interest',
  'tender', 'off-market', 'unknown',
]);

export const saleRecordSchema = z.object({
  id: z.string(),
  saleDate: z.string(),
  price: moneyAmountSchema,
  saleType: saleTypeSchema,
  daysOnMarket: z.number().int().min(0).optional(),
  listingPrice: moneyAmountSchema.optional(),
  agency: z.string().optional(),
  agentName: z.string().optional(),
  buyers: z.string().optional(),
  sellers: z.string().optional(),
  isConfidential: z.boolean(),
  settlementDate: z.string().optional(),
  contractDate: z.string().optional(),
  source: dataSourceSchema,
});

// ─── Rental History ──────────────────────────────────────────────────────────

export const rentalRecordSchema = z.object({
  id: z.string(),
  leaseStartDate: z.string().optional(),
  leaseEndDate: z.string().optional(),
  weeklyRent: moneyAmountSchema,
  bond: moneyAmountSchema.optional(),
  leaseTerm: z.string().optional(),
  agency: z.string().optional(),
  propertyManager: z.string().optional(),
  daysOnMarket: z.number().int().min(0).optional(),
  source: dataSourceSchema,
});

// ─── Listing ─────────────────────────────────────────────────────────────────

export const listingStatusSchema = z.enum([
  'active', 'under-offer', 'sold', 'withdrawn', 'off-market', 'leased',
]);

export const listingTypeSchema = z.enum(['sale', 'rent', 'auction']);

export const inspectionTimeSchema = z.object({
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  isBookingRequired: z.boolean(),
});

export const listingRecordSchema = z.object({
  id: z.string(),
  listingType: listingTypeSchema,
  status: listingStatusSchema,
  priceText: z.string().optional(),
  price: moneyAmountSchema.optional(),
  priceFrom: moneyAmountSchema.optional(),
  priceTo: moneyAmountSchema.optional(),
  auctionDate: z.string().optional(),
  auctionVenue: z.string().optional(),
  dateFirstListed: z.string(),
  dateLastUpdated: z.string(),
  daysOnMarket: z.number().int().min(0),
  headline: z.string(),
  description: z.string(),
  agency: z.string(),
  agentName: z.string().optional(),
  agentPhone: z.string().optional(),
  agentEmail: z.string().email().optional(),
  inspectionTimes: z.array(inspectionTimeSchema),
  sourceUrl: z.string().url(),
  source: dataSourceSchema,
});

// ─── Location ────────────────────────────────────────────────────────────────

export const suburbProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: australianStateSchema,
  postcode: z.string().regex(/^\d{4}$/),
  medianHousePrice: moneyAmountSchema.optional(),
  medianUnitPrice: moneyAmountSchema.optional(),
  medianRentHouse: moneyAmountSchema.optional(),
  medianRentUnit: moneyAmountSchema.optional(),
  annualGrowthPercent: z.number().optional(),
  rentalYieldPercent: z.number().optional(),
  populationCount: z.number().int().positive().optional(),
  medianAge: z.number().positive().optional(),
  medianHouseholdIncome: moneyAmountSchema.optional(),
  ownerOccupiedPercent: z.number().min(0).max(100).optional(),
  renterPercent: z.number().min(0).max(100).optional(),
  familyHouseholdsPercent: z.number().min(0).max(100).optional(),
  stockOnMarketPercent: z.number().min(0).max(100).optional(),
  averageDaysOnMarket: z.number().int().min(0).optional(),
  auctionClearanceRatePercent: z.number().min(0).max(100).optional(),
  demandLevel: z.enum(['very-low', 'low', 'balanced', 'high', 'very-high']).optional(),
  suburbCharacter: z.array(z.string()),
  source: dataSourceSchema,
});

export const schoolInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['primary', 'secondary', 'combined', 'special']),
  sector: z.enum(['government', 'catholic', 'independent']),
  distanceKm: z.number().min(0),
  ranking: z.number().int().positive().optional(),
  icseaScore: z.number().int().optional(),
  enrolmentCount: z.number().int().positive().optional(),
  website: z.string().url().optional(),
});

export const transportInfoSchema = z.object({
  type: z.enum(['train', 'bus', 'tram', 'ferry', 'light-rail']),
  name: z.string(),
  distanceKm: z.number().min(0),
  walkingMinutes: z.number().min(0).optional(),
  routes: z.array(z.string()).optional(),
});

export const environmentalRiskSchema = z.object({
  floodRisk: riskLevelSchema,
  floodZone: z.string().optional(),
  bushfireRisk: riskLevelSchema,
  bushfireAttackLevel: z.enum([
    'BAL-LOW', 'BAL-12.5', 'BAL-19', 'BAL-29', 'BAL-40', 'BAL-FZ',
  ]).optional(),
  coastalErosionRisk: riskLevelSchema.optional(),
  contaminationRisk: riskLevelSchema.optional(),
  mineSubsidenceRisk: riskLevelSchema.optional(),
  heritageListed: z.boolean(),
  heritageDetails: z.string().optional(),
  source: dataSourceSchema,
});

export const zoningInfoSchema = z.object({
  zoneCode: z.string(),
  zoneName: z.string(),
  zoneDescription: z.string().optional(),
  minimumLotSize: z.number().positive().optional(),
  maximumBuildingHeight: z.number().positive().optional(),
  floorSpaceRatio: z.number().positive().optional(),
  permittedUses: z.array(z.string()).optional(),
  prohibitedUses: z.array(z.string()).optional(),
  overlays: z.array(z.string()),
  source: dataSourceSchema,
});

export const locationDataSchema = z.object({
  suburbProfile: suburbProfileSchema.optional(),
  nearbySchools: z.array(schoolInfoSchema),
  nearbyTransport: z.array(transportInfoSchema),
  environmentalRisk: environmentalRiskSchema.optional(),
  zoning: zoningInfoSchema.optional(),
  distanceToCbdKm: z.number().positive().optional(),
  walkScore: z.number().int().min(0).max(100).optional(),
  transitScore: z.number().int().min(0).max(100).optional(),
});

// ─── Planning ────────────────────────────────────────────────────────────────

export const planningApplicationTypeSchema = z.enum([
  'development-application', 'complying-development', 'building-approval',
  'modification', 'review', 'strata-subdivision', 'subdivision', 'rezoning',
]);

export const planningStatusSchema = z.enum([
  'lodged', 'under-assessment', 'on-exhibition', 'determined-approved',
  'determined-refused', 'withdrawn', 'deferred', 'appealed',
]);

export const planningRecordSchema = z.object({
  applicationNumber: z.string(),
  applicationType: planningApplicationTypeSchema,
  status: planningStatusSchema,
  lodgementDate: z.string(),
  determinationDate: z.string().optional(),
  description: z.string(),
  estimatedCost: moneyAmountSchema.optional(),
  assessmentAuthority: z.string(),
  applicant: z.string().optional(),
  isNearby: z.boolean(),
  distanceMetres: z.number().min(0).optional(),
  documentUrls: z.array(z.string().url()),
  source: dataSourceSchema,
});

// ─── Media ───────────────────────────────────────────────────────────────────

export const mediaItemSchema = z.object({
  url: z.string().url(),
  caption: z.string().optional(),
  order: z.number().int().min(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source: dataSourceSchema,
});

export const propertyMediaSchema = z.object({
  photos: z.array(mediaItemSchema),
  floorplans: z.array(mediaItemSchema),
  videos: z.array(mediaItemSchema),
  virtualTours: z.array(mediaItemSchema),
});

// ─── Full Property Profile ───────────────────────────────────────────────────

export const propertyProfileSchema = z.object({
  id: z.string(),
  address: structuredAddressSchema,
  physicalAttributes: physicalAttributesSchema,
  valuation: valuationSchema.optional(),
  councilValuation: councilValuationSchema.optional(),
  saleHistory: z.array(saleRecordSchema),
  rentalHistory: z.array(rentalRecordSchema),
  currentListing: listingRecordSchema.optional(),
  listingHistory: z.array(listingRecordSchema),
  location: locationDataSchema,
  planningHistory: z.array(planningRecordSchema),
  media: propertyMediaSchema,
  fieldProvenance: z.record(z.string(), z.object({
    value: z.unknown(),
    confidence: confidenceScoreSchema,
    sources: z.array(dataSourceSchema),
    alternateValues: z.array(z.object({
      value: z.unknown(),
      source: dataSourceSchema,
    })).optional(),
    lastVerified: z.string().datetime(),
  })).optional(),
  overallConfidence: confidenceScoreSchema,
  dataSources: z.array(dataSourceSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nextRefreshAt: z.string().datetime().optional(),
});

// ─── Source Extraction Schema ────────────────────────────────────────────────

export const dataSourceNameSchema = z.enum([
  'realestate-com-au', 'realestate.com.au',
  'domain-com-au', 'domain.com.au',
  'allhomes', 'homely',
  'corelogic', 'pricefinder', 'sqm-research', 'htw',
  'nsw-valuer-general', 'vic-valuer-general', 'qld-valuer-general',
  'sa-valuer-general', 'wa-landgate', 'tas-valuer-general',
  'nt-valuer-general', 'act-revenue',
  'nsw-planning-portal', 'vic-planning-portal', 'council-da-tracker',
  'nsw-flood-data', 'nsw-bushfire-map', 'vic-flood-data',
  'myschool', 'better-education',
  'google-maps', 'openstreetmap', 'abs-census', 'manual-entry',
]);

/**
 * The main extraction schema used to validate Claude's structured output
 * when extracting property data from any portal's HTML/text.
 *
 * All fields are optional because any single source will only have partial data.
 * This schema is intentionally lenient on types (e.g. string for dates)
 * to accommodate varied source formats.
 */
export const propertyExtractionSchema = z.object({
  sourceName: dataSourceNameSchema,
  sourceUrl: z.string().url(),
  crawledAt: z.string().datetime(),
  rawContentHash: z.string().optional(),

  // Address
  address: z.object({
    unitNumber: z.string().optional(),
    streetNumber: z.string().optional(),
    streetName: z.string().optional(),
    streetType: z.string().optional(),
    suburb: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    displayAddress: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }).optional(),

  // Physical
  propertyType: z.string().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  carSpaces: z.number().int().min(0).optional(),
  garages: z.number().int().min(0).optional(),
  landAreaSqm: z.number().positive().optional(),
  buildingAreaSqm: z.number().positive().optional(),
  yearBuilt: z.number().int().optional(),
  construction: z.string().optional(),
  roofType: z.string().optional(),
  storeys: z.number().int().min(1).optional(),
  features: z.array(z.string()).optional(),

  // Pricing / listing
  priceText: z.string().optional(),
  priceNumeric: z.number().positive().optional(),
  priceFrom: z.number().positive().optional(),
  priceTo: z.number().positive().optional(),
  listingType: z.string().optional(),
  listingStatus: z.string().optional(),
  headline: z.string().optional(),
  description: z.string().optional(),
  dateFirstListed: z.string().optional(),
  daysOnMarket: z.number().int().min(0).optional(),
  auctionDate: z.string().optional(),

  // Agent
  agencyName: z.string().optional(),
  agentName: z.string().optional(),
  agentPhone: z.string().optional(),
  agentEmail: z.string().email().optional(),

  // Sale history
  saleHistory: z.array(z.object({
    date: z.string().optional(),
    price: z.number().positive().optional(),
    type: z.string().optional(),
    agency: z.string().optional(),
    agentName: z.string().optional(),
    daysOnMarket: z.number().int().min(0).optional(),
    listingPrice: z.number().positive().optional(),
    isConfidential: z.boolean().optional(),
    description: z.string().optional(),
    settlementDate: z.string().optional(),
    source: z.string().optional(),
  })).optional(),

  // Rental history
  rentalHistory: z.array(z.object({
    date: z.string().optional(),
    weeklyRent: z.number().positive().optional(),
    bond: z.number().positive().optional(),
    agency: z.string().optional(),
    agentName: z.string().optional(),
    daysOnMarket: z.number().int().min(0).optional(),
    leaseTerm: z.string().optional(),
    description: z.string().optional(),
  })).optional(),

  // Valuation
  estimatedValue: z.number().positive().optional(),
  estimatedValueLow: z.number().positive().optional(),
  estimatedValueHigh: z.number().positive().optional(),
  councilValuation: z.object({
    capitalValue: z.number().positive().optional(),
    landValue: z.number().positive().optional(),
    improvementsValue: z.number().positive().optional(),
    valuationDate: z.string().optional(),
  }).optional(),

  // Media
  photoUrls: z.array(z.string().url()).optional(),
  floorplanUrls: z.array(z.string().url()).optional(),
  videoUrls: z.array(z.string().url()).optional(),
  virtualTourUrl: z.string().url().optional(),

  // Location
  nearbySchools: z.array(z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    sector: z.string().optional(),
    distanceKm: z.number().min(0).optional(),
  })).optional(),
  nearbyTransport: z.array(z.object({
    type: z.string().optional(),
    name: z.string().optional(),
    distanceKm: z.number().min(0).optional(),
  })).optional(),

  // Planning
  planningApplications: z.array(z.object({
    applicationNumber: z.string().optional(),
    type: z.string().optional(),
    status: z.string().optional(),
    lodgementDate: z.string().optional(),
    description: z.string().optional(),
    estimatedCost: z.number().positive().optional(),
  })).optional(),

  // Zoning
  zoneCode: z.string().optional(),
  zoneName: z.string().optional(),

  // Risk
  floodRisk: z.string().optional(),
  bushfireRisk: z.string().optional(),
  heritageListed: z.boolean().optional(),

  // Suburb stats
  suburbStats: z.object({
    medianHousePrice: z.number().positive().optional(),
    medianUnitPrice: z.number().positive().optional(),
    medianRentHouse: z.number().positive().optional(),
    medianRentUnit: z.number().positive().optional(),
    annualGrowthPercent: z.number().optional(),
    rentalYieldPercent: z.number().optional(),
    population: z.number().int().positive().optional(),
    averageDaysOnMarket: z.number().int().min(0).optional(),
  }).optional(),

  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Crawl Schemas ───────────────────────────────────────────────────────────

export const crawlStatusSchema = z.enum([
  'queued', 'running', 'extracting', 'merging',
  'completed', 'failed', 'cancelled', 'rate-limited',
]);

export const crawlPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const crawlErrorCodeSchema = z.enum([
  'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'BLOCKED', 'CAPTCHA',
  'NOT_FOUND', 'PARSE_ERROR', 'EXTRACTION_FAILED', 'VALIDATION_ERROR',
  'AUTH_REQUIRED', 'SOURCE_UNAVAILABLE', 'UNKNOWN',
]);

export const crawlErrorSchema = z.object({
  code: crawlErrorCodeSchema,
  message: z.string(),
  sourceName: dataSourceNameSchema.optional(),
  timestamp: z.string().datetime(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const crawlTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('address'), address: z.string(), state: z.string().optional() }),
  z.object({ type: z.literal('url'), url: z.string().url(), sourceName: dataSourceNameSchema }),
  z.object({ type: z.literal('property-id'), propertyId: z.string() }),
]);

export const sourceCrawlStatusSchema = z.object({
  sourceName: dataSourceNameSchema,
  status: crawlStatusSchema,
  url: z.string().url().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  pagesScraped: z.number().int().min(0),
  bytesDownloaded: z.number().int().min(0),
  error: crawlErrorSchema.optional(),
});

export const crawlResultSchema = z.object({
  jobId: z.string(),
  propertyId: z.string(),
  sourcesCompleted: z.number().int().min(0),
  sourcesFailed: z.number().int().min(0),
  sourcesSkipped: z.number().int().min(0),
  totalFieldsExtracted: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  timing: z.object({
    totalMs: z.number().min(0),
    crawlMs: z.number().min(0),
    extractionMs: z.number().min(0),
    mergingMs: z.number().min(0),
  }),
  dataSources: z.array(dataSourceSchema),
});

export const sourceConfigSchema = z.object({
  name: dataSourceNameSchema,
  baseUrl: z.string().url(),
  enabled: z.boolean(),
  rateLimit: z.object({
    requestsPerMinute: z.number().int().positive(),
    requestsPerHour: z.number().int().positive(),
    concurrentRequests: z.number().int().positive(),
  }),
  refreshIntervalHours: z.number().positive(),
  requiresAuth: z.boolean(),
  trustRank: z.number().int().min(1),
  extractionConfig: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

// ─── Merged Field Schema ─────────────────────────────────────────────────────

export const mergeStrategySchema = z.enum([
  'highest-trust', 'most-recent', 'majority-vote', 'average', 'manual',
]);

export const mergedFieldSchema = z.object({
  value: z.unknown(),
  mergeStrategy: mergeStrategySchema,
  confidence: confidenceScoreSchema,
  sourceValues: z.array(z.object({
    value: z.unknown(),
    source: dataSourceSchema,
    trustRank: z.number().int().min(1),
  })),
  hasConflict: z.boolean(),
  conflictDescription: z.string().optional(),
  mergedAt: z.string().datetime(),
});

// ─── Inferred Types from Schemas ─────────────────────────────────────────────

export type PropertyExtractionData = z.infer<typeof propertyExtractionSchema>;
export type PropertyProfileData = z.infer<typeof propertyProfileSchema>;
export type CrawlResultData = z.infer<typeof crawlResultSchema>;
export type SourceConfigData = z.infer<typeof sourceConfigSchema>;
export type MergedFieldData = z.infer<typeof mergedFieldSchema>;
