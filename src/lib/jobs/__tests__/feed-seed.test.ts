import { describe, it, expect } from 'vitest';
import { mapFeedRowToProfileFields, applyFeedSeed, FEED_SOURCE } from '../feed-seed';

describe('mapFeedRowToProfileFields', () => {
  const SOLD_ROW = {
    address_slug: '14-loders-way-berwick-vic-3806',
    property_type: 'House',
    bedrooms: 5,
    bathrooms: 2,
    car_spaces: 2,
    land_area_sqm: 813,
    sale_price: 1_200_000,
    agency_name: 'GEA',
    agent_name: 'Jane',
    image_url: 'https://img/14-loders.jpg',
    latitude: -38.03,
    longitude: 145.34,
  };

  it('maps a sold row to merger keys with a price band and a photo (happy path)', () => {
    const { data, fieldConfidences } = mapFeedRowToProfileFields(SOLD_ROW, 'sold');

    expect(data).toMatchObject({
      propertyType: 'House',
      bedrooms: 5,
      bathrooms: 2,
      carSpaces: 2,
      landArea: 813,
      priceNumeric: 1_200_000,
      priceLow: 1_080_000,
      priceMid: 1_200_000,
      priceHigh: 1_320_000,
      priceSource: 'feed-sold',
      agencyName: 'GEA',
      agentName: 'Jane',
      photos: ['https://img/14-loders.jpg'],
      latitude: -38.03,
      longitude: 145.34,
    });

    // Every emitted field carries a low-tier property-feed confidence.
    for (const key of Object.keys(data)) {
      if (key === 'priceSource') continue; // string marker, also gets a confidence; ok
      expect(fieldConfidences[key].contributedBy).toEqual([FEED_SOURCE]);
      expect(fieldConfidences[key].confidence).toBeLessThanOrEqual(40);
      expect(fieldConfidences[key].confidence).toBeGreaterThan(0);
    }
  });

  it('maps a listing row price from price_low/price_high, not sale_price', () => {
    const { data } = mapFeedRowToProfileFields(
      { property_type: 'Unit', bedrooms: 2, price_low: 600_000, price_high: 660_000, display_price: 'Contact agent' },
      'on-market'
    );
    expect(data.priceLow).toBe(600_000);
    expect(data.priceHigh).toBe(660_000);
    expect(data.priceMid).toBe(630_000);
    expect(data.priceSource).toBe('feed-listing');
    expect(data.priceNumeric).toBeUndefined();
  });

  it('falls back to parsing display_price for a listing with no numeric range', () => {
    const { data } = mapFeedRowToProfileFields(
      { display_price: 'Offers above $850k' },
      'on-market'
    );
    expect(data.priceNumeric).toBe(850_000);
    expect(data.priceMid).toBe(850_000);
    expect(data.priceSource).toBe('feed-listing');
  });

  it('omits null/missing columns rather than writing 0 or empty string', () => {
    const { data, fieldConfidences } = mapFeedRowToProfileFields(
      { property_type: '   ', bedrooms: null, bathrooms: undefined, sale_price: 0, image_url: '' },
      'sold'
    );
    expect(data.propertyType).toBeUndefined();
    expect(data.bedrooms).toBeUndefined();
    expect(data.bathrooms).toBeUndefined();
    expect(data.priceNumeric).toBeUndefined(); // sale_price 0 → no band
    expect(data.photos).toBeUndefined();
    expect(Object.keys(fieldConfidences)).toHaveLength(0);
  });

});

describe('applyFeedSeed (gap-fill)', () => {
  function profileWith(data: Record<string, unknown>) {
    return { data, fieldConfidences: {} as Record<string, never>, sources: [] as { name: string; extractedAt: Date; hasErrors: boolean }[] };
  }

  it('fills only fields the crawl left empty — crawl values win (R3)', () => {
    const profile = profileWith({ bedrooms: 4 }); // crawl already found 4 beds
    const fields = mapFeedRowToProfileFields({ bedrooms: 5, bathrooms: 2, sale_price: 1_200_000 }, 'sold');

    const seeded = applyFeedSeed(profile, fields);

    expect(seeded).toBe(true);
    expect(profile.data.bedrooms).toBe(4); // not overwritten by the feed's 5
    expect(profile.data.bathrooms).toBe(2); // gap-filled
    expect(profile.data.priceMid).toBe(1_200_000);
    expect(profile.sources.map((s) => s.name)).toContain(FEED_SOURCE);
  });

  it('returns false and adds no source when every field is already present', () => {
    const profile = profileWith({ bedrooms: 4, bathrooms: 2 });
    const fields = mapFeedRowToProfileFields({ bedrooms: 5, bathrooms: 3 }, 'sold');

    const seeded = applyFeedSeed(profile, fields);

    expect(seeded).toBe(false);
    expect(profile.sources).toHaveLength(0);
  });

  it('does not derive a sale/listing price band for a rental row', () => {
    const { data } = mapFeedRowToProfileFields(
      { property_type: 'House', bedrooms: 3, weekly_rent: 550, display_price: '$550 per week' },
      'rent'
    );
    expect(data.priceLow).toBeUndefined();
    expect(data.priceMid).toBeUndefined();
    expect(data.priceSource).toBeUndefined();
    // Non-price attributes still seed.
    expect(data.propertyType).toBe('House');
    expect(data.bedrooms).toBe(3);
  });
});
