import { describe, it, expect } from 'vitest';
import { parseListedDate, mapItem } from '../domain-mapper';

const baseItem = {
  url: 'https://www.domain.com.au/123-smith-st-berwick-vic-3806',
  location: {
    display_address: '123 Smith St, Berwick VIC 3806',
    suburb: 'Berwick',
    state: 'VIC',
    postcode: '3806',
    latitude: -38.03,
    longitude: 145.34,
  },
  pricing: { display_price: '$550 per week' },
  property: { property_type: 'House', bedrooms: 3, bathrooms: 2, parking: 2 },
};

describe('parseListedDate', () => {
  it('parses an ISO date from dateListed', () => {
    expect(parseListedDate({ dateListed: '2024-10-07T00:00:00Z' })).toBe('2024-10-07');
  });

  it('parses a "07 Oct 2024" style date from listing.date_available', () => {
    expect(parseListedDate({ listing: { date_available: '07 Oct 2024' } })).toBe('2024-10-07');
  });

  it('returns null when no date field is present', () => {
    expect(parseListedDate(baseItem)).toBeNull();
  });

  it('returns null for a malformed date string and never throws', () => {
    expect(parseListedDate({ dateListed: 'soon' })).toBeNull();
    expect(parseListedDate(null)).toBeNull();
  });

  it('returns null for a human-date with an unrecognised month abbreviation', () => {
    expect(parseListedDate({ dateListed: '07 Xyz 2024' })).toBeNull();
  });

  it('rejects calendar-invalid dates that pass the digit regex', () => {
    expect(parseListedDate({ dateListed: '2099-13-45' })).toBeNull();
    expect(parseListedDate({ dateListed: '2024-02-30' })).toBeNull();
  });
});

describe('mapItem listed_date population', () => {
  it('sets listed_date on a rental when a real date is present', () => {
    const row = mapItem('rent', { ...baseItem, dateListed: '2024-10-07' });
    expect(row).toMatchObject({ weekly_rent: 550, listed_date: '2024-10-07' });
  });

  it('omits listed_date on a rental when no real date is present (DB default stands)', () => {
    const row = mapItem('rent', baseItem);
    expect(row).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(row, 'listed_date')).toBe(false);
  });

  it('sets listed_date on an on-market listing when present', () => {
    const row = mapItem('on-market', {
      ...baseItem,
      pricing: { display_price: '$900,000 - $950,000' },
      listing: { date_listed: '2025-01-15' },
    });
    expect(row).toMatchObject({ listed_date: '2025-01-15' });
  });

  it('omits listed_date on an on-market listing when absent', () => {
    const row = mapItem('on-market', { ...baseItem, pricing: { display_price: '$900,000' } });
    expect(Object.prototype.hasOwnProperty.call(row, 'listed_date')).toBe(false);
  });

  it('re-mapping a date-less item omits listed_date both times (re-scrape never resets first-seen)', () => {
    // The DB upsert preserves the existing value only because the key is absent;
    // a date-less re-scrape must therefore never emit listed_date.
    expect(Object.prototype.hasOwnProperty.call(mapItem('rent', baseItem), 'listed_date')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(mapItem('rent', baseItem), 'listed_date')).toBe(false);
  });

  it('does not add listed_date to a sold item', () => {
    const row = mapItem('sold', {
      ...baseItem,
      pricing: { display_price: '$800,000' },
      listing: { tags: { tag_text: 'Sold 07 Oct 2024' } },
    });
    expect(row).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(row, 'listed_date')).toBe(false);
    expect(row).toMatchObject({ sale_price: 800000, sale_date: '2024-10-07' });
  });
});
