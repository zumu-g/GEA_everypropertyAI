import type {
  ExtractedPropertyData,
  MergedPropertyProfile as PropertyProfile,
  FieldConfidence,
  SaleHistoryEntry,
} from '@/types/property';
import {
  calculateFieldConfidence,
  getSourceTier,
  SOURCE_TIERS,
} from '../utils/confidence';

/** Fields that are simple scalars — merged by majority/tier preference. */
const SCALAR_FIELDS = [
  'propertyType',
  'bedrooms',
  'bathrooms',
  'carSpaces',
  'landArea',
  'buildingArea',
  'yearBuilt',
  'currentPrice',
  'priceLabel',
  'estimatedValue',
  'councilRates',
  'latitude',
  'longitude',
  'council',
  'listingAgent',
  'listingAgency',
  'floorPlanUrl',
] as const;

/** Address sub-fields. */
const ADDRESS_FIELDS = [
  'fullAddress',
  'unit',
  'streetNumber',
  'streetName',
  'streetType',
  'suburb',
  'state',
  'postcode',
] as const;

/**
 * Merge extracted property data from multiple sources into a single
 * PropertyProfile with per-field confidence scores.
 *
 * Merging rules:
 * - All sources agree       → high confidence (90-100)
 * - Majority agrees         → medium confidence (60-89), majority value used
 * - Sources conflict        → low confidence (30-59), prefer Tier 1 source
 * - Single source only      → medium confidence (50-70)
 */
export function mergePropertyData(
  extractions: ExtractedPropertyData[]
): PropertyProfile {
  const valid = extractions.filter((e) => e.data || Object.keys(e.raw).length > 0);

  if (valid.length === 0) {
    return emptyProfile(extractions);
  }

  const fieldConfidences: Record<string, FieldConfidence> = {};
  const mergedData: Record<string, unknown> = {};

  // Merge address fields
  const addressData: Record<string, unknown> = {};
  for (const field of ADDRESS_FIELDS) {
    const { value, confidence, contributedBy } = pickBestValue(valid, field, true);
    if (value !== undefined) {
      addressData[field] = value;
      fieldConfidences[`address.${field}`] = { confidence, contributedBy };
    }
  }
  mergedData.address = addressData;

  // Merge scalar fields
  for (const field of SCALAR_FIELDS) {
    const { value, confidence, contributedBy } = pickBestValue(valid, field);
    if (value !== undefined) {
      mergedData[field] = value;
      fieldConfidences[field] = { confidence, contributedBy };
    }
  }

  // Merge features arrays — union with dedup
  const allFeatures = collectArrayValues<string>(valid, 'features');
  if (allFeatures.length > 0) {
    const uniqueFeatures = [...new Set(allFeatures.map((f) => f.toLowerCase()))];
    mergedData.features = uniqueFeatures;
    fieldConfidences.features = {
      confidence: allFeatures.length > uniqueFeatures.length ? 80 : 60,
      contributedBy: valid
        .filter((e) => getFieldValue(e, 'features') !== undefined)
        .map((e) => e.source),
    };
  }

  // Merge sale history — deduplicate on date + price
  const allSales = collectArrayValues<SaleHistoryEntry>(valid, 'saleHistory');
  if (allSales.length > 0) {
    mergedData.saleHistory = deduplicateSales(allSales);
    fieldConfidences.saleHistory = {
      confidence: valid.filter((e) => getFieldValue(e, 'saleHistory') !== undefined).length > 1 ? 85 : 60,
      contributedBy: valid
        .filter((e) => getFieldValue(e, 'saleHistory') !== undefined)
        .map((e) => e.source),
    };
  }

  // Merge rental history — deduplicate on date + rent
  const allRentals = collectArrayValues<Record<string, unknown>>(valid, 'rentalHistory');
  if (allRentals.length > 0) {
    mergedData.rentalHistory = deduplicateByKeys(allRentals, ['date', 'weeklyRent']);
    fieldConfidences.rentalHistory = {
      confidence: valid.filter((e) => getFieldValue(e, 'rentalHistory') !== undefined).length > 1 ? 85 : 60,
      contributedBy: valid
        .filter((e) => getFieldValue(e, 'rentalHistory') !== undefined)
        .map((e) => e.source),
    };
  }

  // Merge photos — deduplicate by URL
  const allPhotos = collectArrayValues<string>(valid, 'photos');
  if (allPhotos.length > 0) {
    mergedData.photos = [...new Set(allPhotos)];
    fieldConfidences.photos = {
      confidence: 70,
      contributedBy: valid
        .filter((e) => getFieldValue(e, 'photos') !== undefined)
        .map((e) => e.source),
    };
  }

  // Calculate overall confidence
  const confidenceValues = Object.values(fieldConfidences).map((fc) => fc.confidence);
  const overallConfidence =
    confidenceValues.length > 0
      ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : 0;

  return {
    data: mergedData,
    fieldConfidences,
    overallConfidence,
    sources: extractions.map((e) => ({
      name: e.source,
      extractedAt: e.extractedAt,
      hasErrors: !!e.error || !!e.validationErrors,
    })),
    mergedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a field value from an extraction, checking .data first, then .raw.
 */
function getFieldValue(
  extraction: ExtractedPropertyData,
  field: string,
  isAddressField = false
): unknown {
  if (isAddressField) {
    const dataAddr = extraction.data?.address as Record<string, unknown> | undefined;
    const fromData = dataAddr?.[field] ?? extraction.data?.[field];
    if (fromData !== undefined) return fromData;
    const rawAddr = extraction.raw?.address as Record<string, unknown> | undefined;
    return rawAddr?.[field] ?? extraction.raw?.[field];
  }

  return extraction.data?.[field] ?? extraction.raw?.[field];
}

/**
 * Pick the best value for a scalar field across all extractions.
 */
function pickBestValue(
  extractions: ExtractedPropertyData[],
  field: string,
  isAddressField = false
): { value: unknown; confidence: number; contributedBy: string[] } {
  const entries: { value: unknown; source: string }[] = [];

  for (const ext of extractions) {
    const val = getFieldValue(ext, field, isAddressField);
    if (val !== undefined && val !== null && val !== '') {
      entries.push({ value: val, source: ext.source });
    }
  }

  if (entries.length === 0) {
    return { value: undefined, confidence: 0, contributedBy: [] };
  }

  if (entries.length === 1) {
    // Single source — moderate confidence, higher if Tier 1
    const tier = getSourceTier(entries[0].source);
    const confidence = tier === 1 ? 70 : 50;
    return {
      value: entries[0].value,
      confidence,
      contributedBy: [entries[0].source],
    };
  }

  // Multiple sources — check agreement
  const values = entries.map((e) => JSON.stringify(e.value));
  const sources = entries.map((e) => e.source);
  const confidence = calculateFieldConfidence(
    entries.map((e) => e.value),
    sources
  );

  // Find majority value
  const frequency = new Map<string, { count: number; bestTier: number; value: unknown; sources: string[] }>();
  for (const entry of entries) {
    const key = JSON.stringify(entry.value);
    const existing = frequency.get(key);
    const tier = getSourceTier(entry.source);
    if (existing) {
      existing.count++;
      existing.bestTier = Math.min(existing.bestTier, tier);
      existing.sources.push(entry.source);
    } else {
      frequency.set(key, {
        count: 1,
        bestTier: tier,
        value: entry.value,
        sources: [entry.source],
      });
    }
  }

  // Sort: highest count first, then lowest tier (Tier 1 preferred)
  const sorted = [...frequency.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.bestTier - b.bestTier;
  });

  const best = sorted[0];
  return {
    value: best.value,
    confidence,
    contributedBy: best.sources,
  };
}

/**
 * Collect all values for an array field across extractions.
 */
function collectArrayValues<T>(
  extractions: ExtractedPropertyData[],
  field: string
): T[] {
  const result: T[] = [];
  for (const ext of extractions) {
    const val = getFieldValue(ext, field);
    if (Array.isArray(val)) {
      result.push(...(val as T[]));
    }
  }
  return result;
}

/**
 * Deduplicate sale history entries by date + price.
 */
function deduplicateSales(sales: SaleHistoryEntry[]): SaleHistoryEntry[] {
  const seen = new Set<string>();
  const result: SaleHistoryEntry[] = [];
  for (const sale of sales) {
    const key = `${sale.date ?? ''}_${sale.price ?? 'null'}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(sale);
    }
  }
  // Sort by date descending (most recent first)
  return result.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

/**
 * Generic deduplication by a set of keys.
 */
function deduplicateByKeys<T extends Record<string, unknown>>(
  items: T[],
  keys: string[]
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keys.map((k) => JSON.stringify(item[k] ?? '')).join('_');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Return an empty profile when no valid extractions are available.
 */
function emptyProfile(extractions: ExtractedPropertyData[]): PropertyProfile {
  return {
    data: {},
    fieldConfidences: {},
    overallConfidence: 0,
    sources: extractions.map((e) => ({
      name: e.source,
      extractedAt: e.extractedAt,
      hasErrors: !!e.error || !!e.validationErrors,
    })),
    mergedAt: new Date(),
  };
}
