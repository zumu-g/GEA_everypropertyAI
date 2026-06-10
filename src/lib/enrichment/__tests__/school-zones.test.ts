import { describe, it, expect } from 'vitest';
import {
  pointInGeometry,
  findSchoolInZones,
  resolveSchoolZones,
  type ZoneGeometry,
} from '../school-zones';

// A 10×10 square from (0,0) to (10,10), CCW.
const SQUARE: ZoneGeometry = {
  type: 'Polygon',
  coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
};

// Same square with a 2×2 hole in the middle (4..6, 4..6).
const DONUT: ZoneGeometry = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};

// Two disjoint squares: (0..10) and (20..30) on x.
const MULTI: ZoneGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]],
  ],
};

describe('pointInGeometry (pure)', () => {
  it('detects a point inside a simple polygon', () => {
    expect(pointInGeometry(5, 5, SQUARE)).toBe(true);
  });

  it('detects a point outside a simple polygon', () => {
    expect(pointInGeometry(15, 5, SQUARE)).toBe(false);
  });

  it('excludes a point inside a hole (donut)', () => {
    expect(pointInGeometry(5, 5, DONUT)).toBe(false); // dead centre = in the hole
    expect(pointInGeometry(1, 1, DONUT)).toBe(true); // in the ring body, outside the hole
  });

  it('matches a point inside the second polygon of a MultiPolygon', () => {
    expect(pointInGeometry(25, 5, MULTI)).toBe(true);
    expect(pointInGeometry(15, 5, MULTI)).toBe(false); // the gap between them
  });

  it('returns false for null geometry', () => {
    expect(pointInGeometry(5, 5, null)).toBe(false);
  });
});

describe('findSchoolInZones (pure)', () => {
  const collection = {
    features: [
      { geometry: SQUARE, properties: { school: 'Berwick Primary' } },
      { geometry: MULTI, properties: { school: 'Other Primary' } },
    ],
  };

  it('returns the school of the containing zone (happy path)', () => {
    expect(findSchoolInZones(5, 5, collection)).toBe('Berwick Primary');
    expect(findSchoolInZones(25, 5, collection)).toBe('Other Primary');
  });

  it('returns undefined when the point is in no zone', () => {
    expect(findSchoolInZones(15, 5, collection)).toBeUndefined();
  });

  it('first-match wins for overlapping zones (deterministic boundary)', () => {
    const overlapping = {
      features: [
        { geometry: SQUARE, properties: { school: 'First' } },
        { geometry: SQUARE, properties: { school: 'Second' } },
      ],
    };
    expect(findSchoolInZones(5, 5, overlapping)).toBe('First');
  });

  it('returns undefined for a null collection (fail-soft)', () => {
    expect(findSchoolInZones(5, 5, null)).toBeUndefined();
  });

  it('skips a feature with no school name', () => {
    const noName = { features: [{ geometry: SQUARE, properties: {} }] };
    expect(findSchoolInZones(5, 5, noName)).toBeUndefined();
  });
});

describe('resolveSchoolZones (fail-soft I/O)', () => {
  it('returns {} when the reference data files are absent (not yet generated)', () => {
    // The bundled GeoJSON is generated via scripts/prep-school-zones.md and is
    // not committed; the loader must fail soft rather than throw.
    expect(resolveSchoolZones(-38.03, 145.34)).toEqual({});
  });

  it('returns {} for non-finite coordinates', () => {
    expect(resolveSchoolZones(Number.NaN, 145)).toEqual({});
  });
});
