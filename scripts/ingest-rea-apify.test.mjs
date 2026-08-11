import { describe, it, expect } from 'vitest';
import { mapOnMarket } from './ingest-rea-apify.mjs';

const base = {
  Street: '6 Lauradan Avenue',
  Suburb: 'Berwick',
  State: 'VIC',
  Postcode: 3806,
  Price: '$890,000-$970,000',
  Beds: 3,
  Baths: 2,
  Parking: 2,
  'Listing URL': 'https://www.realestate.com.au/property-house-vic-berwick-151839272',
};

describe('mapOnMarket image_url', () => {
  it('maps Photos as a plain string (the live actor shape)', () => {
    const row = mapOnMarket({ ...base, Photos: 'https://i3.au.reastatic.net/abc/image.jpg' });
    expect(row.image_url).toBe('https://i3.au.reastatic.net/abc/image.jpg');
  });

  it('maps Photos as an array (first entry)', () => {
    const row = mapOnMarket({ ...base, Photos: ['https://i3.au.reastatic.net/a.jpg', 'https://i3.au.reastatic.net/b.jpg'] });
    expect(row.image_url).toBe('https://i3.au.reastatic.net/a.jpg');
  });

  it('null image_url when Photos missing, empty string, or empty array', () => {
    expect(mapOnMarket(base).image_url).toBeNull();
    expect(mapOnMarket({ ...base, Photos: '' }).image_url).toBeNull();
    expect(mapOnMarket({ ...base, Photos: [] }).image_url).toBeNull();
  });

  it('null image_url for a non-URL Photos value', () => {
    expect(mapOnMarket({ ...base, Photos: 21 }).image_url).toBeNull();
  });
});
