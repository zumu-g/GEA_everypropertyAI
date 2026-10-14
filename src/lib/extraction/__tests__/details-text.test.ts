import { describe, it, expect } from 'vitest';
import { parseDetailsText } from '../details-text';

describe('parseDetailsText', () => {
  it('reads the REA header stack', () => {
    const t = '12 Buchan Green\nPakenham, VIC 3810\nHouse\n\n3\n\n2\n\n2\n\n696m²\n\n272m²\n\nProperty images\n39';
    expect(parseDetailsText(t)).toEqual({ propertyType: 'House', bedrooms: 3, bathrooms: 2, carSpaces: 2, landArea: 696, buildingArea: 272 });
  });

  it('prefers the About sentence and ignores unrelated numbers', () => {
    const t = 'Unit\n1\n1\n1\n12 Foo St is a 2 bedroom, 1 bathroom unit. It offers 1 car space and sits on a 310m² lot.\nListed 14 Oct 2026\n10\n1';
    expect(parseDetailsText(t)).toMatchObject({ propertyType: 'Unit', bedrooms: 2, bathrooms: 1, carSpaces: 1, landArea: 310 });
  });

  it('returns nothing for history-only text', () => {
    expect(parseDetailsText('Sold $450,000\n10 Jan 2013 by Grant')).toEqual({});
  });
});
