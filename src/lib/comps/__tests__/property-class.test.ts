import { describe, it, expect } from 'vitest';
import { propertyClass, sameClass } from '../property-class';

describe('propertyClass', () => {
  it('normalises the spellings seen in property_sales', () => {
    expect(propertyClass('Vacant land')).toBe('land');
    expect(propertyClass('land')).toBe('land');
    expect(propertyClass('Apartment / Unit / Flat')).toBe('unit');
    expect(propertyClass('ApartmentUnitFlat')).toBe('unit');
    expect(propertyClass('Townhouse')).toBe('unit');
    expect(propertyClass('House')).toBe('house');
    expect(propertyClass('AcreageSemiRural')).toBe('rural');
    expect(propertyClass('Acreage / Semi-Rural')).toBe('rural');
    expect(propertyClass(null)).toBeNull();
    expect(propertyClass('other')).toBeNull();
  });
});

describe('sameClass', () => {
  it('excludes cross-class comps and keeps unknowns', () => {
    expect(sameClass('land', 'House')).toBe(false);
    expect(sameClass('house', 'Vacant land')).toBe(false);
    expect(sameClass('unit', 'house')).toBe(false);
    expect(sameClass('house', 'house')).toBe(true);
    expect(sameClass('house', null)).toBe(true);
    expect(sameClass(undefined, 'land')).toBe(true);
  });
});
