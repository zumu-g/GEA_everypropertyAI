import type { MergedPropertyProfile as PropertyProfile } from '@/types/property';

/**
 * Source tier rankings.
 * Tier 1 sources are considered most authoritative for Australian property data.
 * Tier 2 sources provide supplementary data.
 */
export const SOURCE_TIERS: Record<string, number> = {
  'realestate.com.au': 1,
  'domain.com.au': 1,
  'onthehouse.com.au': 2,
  'propertyvalue.com.au': 2,
};

/**
 * Get the tier for a source. Unknown sources default to Tier 3.
 */
export function getSourceTier(source: string): number {
  // Normalise: strip www. prefix, lowercase
  const normalised = source.toLowerCase().replace(/^www\./, '');
  return SOURCE_TIERS[normalised] ?? 3;
}

/**
 * Calculate confidence for a single field based on the values and sources
 * that provided them.
 *
 * Rules:
 * - All sources agree       → 90-100 (higher with more sources)
 * - Majority agrees         → 60-89
 * - Sources conflict        → 30-59 (prefer Tier 1)
 * - Single source only      → 50-70 (based on tier)
 */
export function calculateFieldConfidence(
  values: unknown[],
  sources: string[]
): number {
  if (values.length === 0) return 0;

  if (values.length === 1) {
    const tier = getSourceTier(sources[0]);
    if (tier === 1) return 70;
    if (tier === 2) return 55;
    return 50;
  }

  // Serialise values for comparison
  const serialised = values.map((v) => JSON.stringify(v));

  // Count occurrences of each unique value
  const counts = new Map<string, { count: number; bestTier: number }>();
  for (let i = 0; i < serialised.length; i++) {
    const key = serialised[i];
    const tier = getSourceTier(sources[i]);
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
      existing.bestTier = Math.min(existing.bestTier, tier);
    } else {
      counts.set(key, { count: 1, bestTier: tier });
    }
  }

  const uniqueValues = counts.size;
  const totalSources = values.length;

  // All sources agree
  if (uniqueValues === 1) {
    // Base 90, +3 per additional source, capped at 100
    return Math.min(100, 90 + (totalSources - 1) * 3);
  }

  // Find the majority value
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[1].bestTier - b[1].bestTier;
  });

  const majorityCount = sorted[0][1].count;
  const majorityRatio = majorityCount / totalSources;

  // Clear majority (> 50% of sources)
  if (majorityRatio > 0.5) {
    // 60-89 range based on how strong the majority is and source tier
    const tierBonus = sorted[0][1].bestTier === 1 ? 10 : 0;
    return Math.min(89, Math.round(60 + majorityRatio * 20 + tierBonus));
  }

  // No clear majority — sources conflict
  // 30-59 range, boosted if a Tier 1 source has the value
  const bestTierAmongAll = Math.min(...[...counts.values()].map((c) => c.bestTier));
  const tierBonus = bestTierAmongAll === 1 ? 15 : bestTierAmongAll === 2 ? 5 : 0;
  return Math.min(59, 30 + tierBonus);
}

/**
 * Calculate the overall confidence score for a merged PropertyProfile.
 * Weighted average: address and price fields count more than media fields.
 */
export function getOverallConfidence(profile: PropertyProfile): number {
  const entries = Object.entries(profile.fieldConfidences);
  if (entries.length === 0) return 0;

  const WEIGHTS: Record<string, number> = {
    'address.fullAddress': 3,
    'address.suburb': 2,
    'address.state': 2,
    'address.postcode': 2,
    'address.streetNumber': 2,
    'address.streetName': 2,
    'address.streetType': 1,
    'address.unit': 1,
    propertyType: 2,
    bedrooms: 2,
    bathrooms: 2,
    carSpaces: 1.5,
    landArea: 1.5,
    buildingArea: 1,
    yearBuilt: 1,
    currentPrice: 3,
    estimatedValue: 1.5,
    saleHistory: 2,
    features: 1,
    photos: 0.5,
    floorPlanUrl: 0.5,
    listingAgent: 0.5,
    listingAgency: 0.5,
    council: 1,
    latitude: 0.5,
    longitude: 0.5,
    councilRates: 1,
    rentalHistory: 1,
    priceLabel: 0.5,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [field, fc] of entries) {
    const weight = WEIGHTS[field] ?? 1;
    weightedSum += fc.confidence * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}
