import { describe, it, expect } from 'vitest';
import { groundFields } from '../grounding';

// Representative scraped source content for a real Berwick property.
const SOURCE = `
4 Gloucester Avenue, Berwick VIC 3806
House
4 beds 2 baths 2 car
Land size: 612 m²
Sold $945,000 on 15 May 2022
Marketed by Barry Plant Berwick
Features: ducted heating, solar panels, study
https://i2.au.reastatic.net/800x600/abc123/image.jpg
`;

describe('groundFields — numbers', () => {
  it('keeps a number present verbatim', () => {
    expect(groundFields({ landArea: 612 }, SOURCE)).toEqual({ landArea: 612 });
  });

  it('keeps a price present in formatted form ($945,000)', () => {
    expect(groundFields({ currentPrice: 945000 }, SOURCE)).toEqual({ currentPrice: 945000 });
  });

  it('drops a number absent from the source', () => {
    expect(groundFields({ currentPrice: 1250000 }, SOURCE)).toEqual({});
  });

  it('keeps small counts present in source', () => {
    expect(groundFields({ bedrooms: 4, bathrooms: 2, carSpaces: 2 }, SOURCE)).toEqual({
      bedrooms: 4,
      bathrooms: 2,
      carSpaces: 2,
    });
  });

  it('expands m/k/million suffixes when matching', () => {
    const src = 'Price guide $1.25m\nSold $750k in 2019';
    expect(groundFields({ priceNumeric: 1250000 }, src)).toEqual({ priceNumeric: 1250000 });
    expect(groundFields({ currentPrice: 750000 }, src)).toEqual({ currentPrice: 750000 });
  });
});

describe('groundFields — strings', () => {
  it('keeps a string present in source', () => {
    expect(groundFields({ agencyName: 'Barry Plant Berwick' }, SOURCE)).toEqual({
      agencyName: 'Barry Plant Berwick',
    });
  });

  it('drops a fabricated agent name', () => {
    expect(groundFields({ agentName: 'Jane Doe' }, SOURCE)).toEqual({});
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(groundFields({ agencyName: 'barry plant  berwick' }, SOURCE)).toEqual({
      agencyName: 'barry plant  berwick',
    });
  });

  it('keeps an enum-like propertyType present as a keyword', () => {
    expect(groundFields({ propertyType: 'house' }, SOURCE)).toEqual({ propertyType: 'house' });
  });

  it('drops a propertyType with no supporting keyword', () => {
    expect(groundFields({ propertyType: 'apartment' }, SOURCE)).toEqual({});
  });
});

describe('groundFields — saleHistory (array, entry-level)', () => {
  it('keeps an entry whose price and date both verify, dropping fabricated sub-fields', () => {
    const out = groundFields(
      {
        saleHistory: [
          { date: '2022-05-15', price: 945000, agency: 'Barry Plant Berwick', agentName: 'Jane Doe', daysOnMarket: 99 },
        ],
      },
      SOURCE
    ) as { saleHistory?: unknown[] };
    expect(out.saleHistory).toEqual([
      { date: '2022-05-15', price: 945000, agency: 'Barry Plant Berwick' },
    ]);
  });

  it('drops an entry whose price is fabricated', () => {
    const out = groundFields(
      { saleHistory: [{ date: '2022-05-15', price: 1250000 }] },
      SOURCE
    );
    expect(out).toEqual({});
  });

  it('drops the whole field when no entry survives', () => {
    const out = groundFields(
      { saleHistory: [{ date: '2030-01-01', price: 99 }] },
      SOURCE
    );
    expect(out).toEqual({});
  });
});

describe('groundFields — features & photos arrays', () => {
  it('keeps only features present in source', () => {
    const out = groundFields({ features: ['solar panels', 'ducted heating', 'tennis court'] }, SOURCE) as {
      features?: string[];
    };
    expect(out.features).toEqual(['solar panels', 'ducted heating']);
  });

  it('keeps only photo URLs present in source', () => {
    const out = groundFields(
      { photos: ['https://i2.au.reastatic.net/800x600/abc123/image.jpg', 'https://fake.example/x.jpg'] },
      SOURCE
    ) as { photos?: string[] };
    expect(out.photos).toEqual(['https://i2.au.reastatic.net/800x600/abc123/image.jpg']);
  });
});

describe('groundFields — edge cases', () => {
  it('drops unknown/unlisted keys (fail-closed)', () => {
    expect(groundFields({ someRandomField: 'whatever' }, SOURCE)).toEqual({});
  });

  it('drops everything when source is empty', () => {
    expect(groundFields({ bedrooms: 4, agencyName: 'Barry Plant Berwick' }, '')).toEqual({});
  });

  it('verifies nested address sub-fields as strings', () => {
    const out = groundFields(
      { address: { suburb: 'Berwick', streetName: 'Gloucester', state: 'NSW' } },
      SOURCE
    ) as { address?: Record<string, unknown> };
    // Berwick + Gloucester present; NSW absent → dropped.
    expect(out.address).toEqual({ suburb: 'Berwick', streetName: 'Gloucester' });
  });
});
