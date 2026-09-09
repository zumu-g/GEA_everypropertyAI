import { describe, it, expect } from 'vitest';
import { mergePropertyData } from '../merger';
import type { ExtractedPropertyData } from '@/types/property';

function ext(source: string, raw: Record<string, unknown>): ExtractedPropertyData {
  return { source, raw, data: raw, extractedAt: new Date() };
}

describe('mergePropertyData — zero counts are missing, not values', () => {
  // allhomes.com.au returns bedrooms/bathrooms/carSpaces = 0 when it has no
  // mapping for a property. A literal 0 then survives every `??` fallback
  // downstream (street-details never falls through to the sold feed, the
  // property page renders "0 bedrooms", the estimator gets beds=0).
  it('drops a lone 0 bedroom/bathroom/car count instead of merging it', () => {
    const profile = mergePropertyData([
      ext('allhomes.com.au', { bedrooms: 0, bathrooms: 0, carSpaces: 0, landArea: 651 }),
    ]);
    expect(profile.data.bedrooms).toBeUndefined();
    expect(profile.data.bathrooms).toBeUndefined();
    expect(profile.data.carSpaces).toBeUndefined();
    expect(profile.fieldConfidences.bedrooms).toBeUndefined();
    // unrelated numeric fields are untouched
    expect(profile.data.landArea).toBe(651);
  });

  it('lets a real count from another source win over a 0', () => {
    const profile = mergePropertyData([
      ext('allhomes.com.au', { bedrooms: 0, bathrooms: 0 }),
      ext('property-feed', { bedrooms: 3, bathrooms: 1 }),
    ]);
    expect(profile.data.bedrooms).toBe(3);
    expect(profile.data.bathrooms).toBe(1);
    expect(profile.fieldConfidences.bedrooms.contributedBy).toEqual(['property-feed']);
  });

  it('still merges a genuine non-zero count from a single source', () => {
    const profile = mergePropertyData([ext('allhomes.com.au', { bedrooms: 3 })]);
    expect(profile.data.bedrooms).toBe(3);
  });
});
