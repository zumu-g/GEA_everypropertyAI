import { describe, it, expect } from 'vitest';
import { normaliseAreaSqm, sqmOrNull, formatLandArea } from '../area';

describe('normaliseAreaSqm', () => {
  it('passes plain numbers through as m²', () => {
    expect(normaliseAreaSqm(650)).toBe(650);
    expect(normaliseAreaSqm(612.5)).toBe(612.5);
  });

  it('converts acres via unit hint', () => {
    expect(normaliseAreaSqm(2, 'acres')).toBeCloseTo(8093.7, 1);
    expect(normaliseAreaSqm(2, 'ac')).toBeCloseTo(8093.7, 1);
  });

  it('converts hectares', () => {
    expect(normaliseAreaSqm(1.5, 'ha')).toBe(15000);
    expect(normaliseAreaSqm('1.5 ha')).toBe(15000);
  });

  it('parses embedded unit tokens in strings', () => {
    expect(normaliseAreaSqm('2.5 ac')).toBeCloseTo(10117.1, 1);
    expect(normaliseAreaSqm('1.2ha')).toBe(12000);
    expect(normaliseAreaSqm('650m²')).toBe(650);
  });

  it('parses thousands separators', () => {
    expect(normaliseAreaSqm('1,012 m²')).toBe(1012);
    expect(normaliseAreaSqm('1,012')).toBe(1012);
  });

  it('treats zero and negative as missing', () => {
    expect(normaliseAreaSqm(0)).toBeNull();
    expect(normaliseAreaSqm(-5)).toBeNull();
    expect(normaliseAreaSqm('0')).toBeNull();
  });

  it('returns null for unparseable values', () => {
    expect(normaliseAreaSqm(NaN)).toBeNull();
    expect(normaliseAreaSqm('')).toBeNull();
    expect(normaliseAreaSqm(null)).toBeNull();
    expect(normaliseAreaSqm(undefined)).toBeNull();
    expect(normaliseAreaSqm('large block')).toBeNull();
  });

  it('never converts unrecognised explicit units', () => {
    expect(normaliseAreaSqm('3 perch')).toBeNull();
    expect(normaliseAreaSqm(3, 'perch')).toBeNull();
  });

  it('explicit unitHint wins over embedded token', () => {
    expect(normaliseAreaSqm('2 ac', 'hectares')).toBe(20000);
  });
});

describe('sqmOrNull', () => {
  it('passes positive numbers, nulls everything else', () => {
    expect(sqmOrNull(700)).toBe(700);
    expect(sqmOrNull(0)).toBeNull();
    expect(sqmOrNull(-1)).toBeNull();
    expect(sqmOrNull(null)).toBeNull();
    expect(sqmOrNull('700')).toBeNull();
  });
});

describe('formatLandArea', () => {
  it('renders m² below the 4,000 m² threshold', () => {
    expect(formatLandArea(650)).toBe('650 m²');
    expect(formatLandArea(3999)).toBe('3999 m²');
  });
  it('renders acres at or above 4,000 m²', () => {
    expect(formatLandArea(25792)).toBe('6.37 acres');
    expect(formatLandArea(4000)).toBe('0.99 acres');
    expect(formatLandArea(40469)).toBe('10 acres');
  });
  it('uses singular for exactly one acre', () => {
    expect(formatLandArea(4047)).toBe('1 acre');
  });
});
