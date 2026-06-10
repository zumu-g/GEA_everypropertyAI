import { describe, it, expect } from 'vitest';
import { buildAvmPatch } from '../avm-backfill';
import type { MergedPropertyProfile } from '@/types/property';

/** Minimal MergedPropertyProfile for the pure patch-builder. */
function profile(data: Record<string, unknown>, fieldConfidences: Record<string, unknown> = {}): MergedPropertyProfile {
  return {
    data,
    fieldConfidences: fieldConfidences as MergedPropertyProfile['fieldConfidences'],
    overallConfidence: 0,
    sources: [],
    mergedAt: new Date(0),
  };
}

describe('buildAvmPatch', () => {
  it('maps buildingArea, yearBuilt, features and field confidence (happy path)', () => {
    const p = profile(
      { buildingArea: 212, yearBuilt: 1998, features: ['pool', 'solar'] },
      { buildingArea: { level: 'high' } },
    );
    expect(buildAvmPatch(p)).toEqual({
      building_area_sqm: 212,
      year_built: 1998,
      features: ['pool', 'solar'],
      field_confidence: { buildingArea: { level: 'high' } },
    });
  });

  it('falls back to the buildingAreaSqm key when buildingArea is absent', () => {
    expect(buildAvmPatch(profile({ buildingAreaSqm: 180 }))).toMatchObject({ building_area_sqm: 180 });
  });

  it('returns an empty patch when the profile carries nothing useful', () => {
    expect(buildAvmPatch(profile({ bedrooms: 4 }))).toEqual({});
  });

  it('returns an empty patch for an undefined profile (cache miss)', () => {
    expect(buildAvmPatch(undefined)).toEqual({});
  });

  it('omits an empty features array', () => {
    expect(buildAvmPatch(profile({ features: [] }))).toEqual({});
  });

  it('rejects a non-positive or non-finite building area', () => {
    expect(buildAvmPatch(profile({ buildingArea: 0 }))).toEqual({});
    expect(buildAvmPatch(profile({ buildingArea: -50 }))).toEqual({});
    expect(buildAvmPatch(profile({ buildingArea: NaN }))).toEqual({});
  });

  it('rejects an implausible or non-integer year_built', () => {
    expect(buildAvmPatch(profile({ buildingArea: 200, yearBuilt: 1700 })).year_built).toBeUndefined();
    expect(buildAvmPatch(profile({ buildingArea: 200, yearBuilt: 1998.5 })).year_built).toBeUndefined();
  });

  it('omits field_confidence when the map is empty', () => {
    expect(buildAvmPatch(profile({ buildingArea: 200 }, {}))).toEqual({ building_area_sqm: 200 });
  });
});
