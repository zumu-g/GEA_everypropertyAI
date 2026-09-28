import { describe, it, expect } from 'vitest';
import { looksLikeData, parseDetailLinks, parseNextData, mapDetail, shouldSweep, buildCoverage } from './ingest-homely.mjs';

const NEXT_DATA = (listing) =>
  `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">` +
  JSON.stringify({ props: { pageProps: { listing } } }) +
  `</script></body></html>`;

// A realistic anti-bot interstitial: 200 OK, plenty of bytes, but NO __NEXT_DATA__.
const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head><body>' +
  'Checking your browser before accessing homely.com.au. '.repeat(40) +
  '</body></html>';

const FULL_LISTING = {
  statusType: 'ForSale',
  propertyType: 'house',
  address: {
    longAddress: '2/31 Florence Avenue, Berwick VIC 3806',
    suburb: 'berwick', stateCode: 'VIC', postcode: '3806',
    latitude: -38.03, longitude: 145.34,
  },
  features: { bedrooms: 4, bathrooms: 2, cars: 2 },
  landFeatures: { areaSqm: 650 },
  priceDetails: { longDescription: '$800,000 - $880,000' },
  office: { fullName: 'GEA Berwick' },
  agents: [{ name: 'Jane Smith' }],
  media: { photos: [{ webDefaultURI: 'https://img/1.jpg' }] },
};

describe('looksLikeData (body-validation gate)', () => {
  it('accepts a real page with __NEXT_DATA__', () => {
    expect(looksLikeData(NEXT_DATA(FULL_LISTING))).toBe(true);
  });
  it('rejects an anti-bot challenge page returned as 200', () => {
    expect(CHALLENGE_PAGE.length).toBeGreaterThan(1000);
    expect(looksLikeData(CHALLENGE_PAGE)).toBe(false);
  });
  it('rejects empty / non-string bodies', () => {
    expect(looksLikeData('')).toBe(false);
    expect(looksLikeData(undefined)).toBe(false);
    expect(looksLikeData(null)).toBe(false);
  });
});

describe('parseDetailLinks', () => {
  it('extracts and dedupes /homes/{slug}/{id} links', () => {
    const html = 'x <a href="/homes/2-31-florence-avenue-berwick-vic-3806/12345">a</a>' +
      ' <a href="/homes/2-31-florence-avenue-berwick-vic-3806/12345">dup</a>' +
      ' <a href="/homes/5-smith-street-clyde-vic-3978/99">b</a>';
    expect(parseDetailLinks(html)).toEqual([
      'https://www.homely.com.au/homes/2-31-florence-avenue-berwick-vic-3806/12345',
      'https://www.homely.com.au/homes/5-smith-street-clyde-vic-3978/99',
    ]);
  });
  it('returns [] when no links present', () => {
    expect(parseDetailLinks(CHALLENGE_PAGE)).toEqual([]);
  });
});

describe('parseNextData', () => {
  it('parses the embedded JSON', () => {
    expect(parseNextData(NEXT_DATA(FULL_LISTING))?.props?.pageProps?.listing?.propertyType).toBe('house');
  });
  it('returns null on malformed JSON', () => {
    expect(parseNextData('<script id="__NEXT_DATA__">{nope}</script>')).toBe(null);
  });
});

describe('mapDetail', () => {
  const URL = 'https://www.homely.com.au/homes/2-31-florence-avenue-berwick-vic-3806/12345';

  it('maps a full for-sale listing to a property_listings row', () => {
    const row = mapDetail(NEXT_DATA(FULL_LISTING), URL);
    expect(row).toMatchObject({
      raw_address: '2/31 Florence Avenue, Berwick VIC 3806',
      suburb: 'Berwick',
      state: 'VIC',
      postcode: '3806',
      land_area_sqm: 650,
      property_type: 'house',
      bedrooms: 4, bathrooms: 2, car_spaces: 2,
      agency_name: 'GEA Berwick',
      agent_name: 'Jane Smith',
      listing_url: URL,
      image_url: 'https://img/1.jpg',
      display_price: '$800,000 - $880,000',
      price_low: 800000, price_high: 880000,
      source: 'homely',
    });
  });

  it('returns null on a shell / 404 page (no listing node)', () => {
    expect(mapDetail(NEXT_DATA(undefined), URL)).toBe(null);
    expect(mapDetail(CHALLENGE_PAGE, URL)).toBe(null);
  });

  it('maps a SOLD record (soldOn) to lifecycle_status sold instead of dropping it (R7)', () => {
    const sold = { ...FULL_LISTING, saleDetails: { soldDetails: { soldOn: '2026-05-01' } } };
    expect(mapDetail(NEXT_DATA(sold), URL)).toMatchObject({ raw_address: '2/31 Florence Avenue, Berwick VIC 3806', lifecycle_status: 'sold' });
  });
  it('without soldOn the lifecycle comes from statusType: active by default, under_offer when it says so', () => {
    expect(mapDetail(NEXT_DATA(FULL_LISTING), URL).lifecycle_status).toBe('active');
    expect(mapDetail(NEXT_DATA({ ...FULL_LISTING, statusType: 'Under Offer' }), URL).lifecycle_status).toBe('under_offer');
  });
  it('does not pre-set last_seen_at / active (feed-write.mjs owns them)', () => {
    const row = mapDetail(NEXT_DATA(FULL_LISTING), URL);
    expect(row).not.toHaveProperty('last_seen_at');
    expect(row).not.toHaveProperty('active');
  });
  it('sets sale_method / auction_date from the price text (R25)', () => {
    expect(mapDetail(NEXT_DATA(FULL_LISTING), URL)).toMatchObject({ sale_method: 'private', auction_date: null });
    const auction = { ...FULL_LISTING, priceDetails: { longDescription: 'Auction Saturday 21 Nov' } };
    const row = mapDetail(NEXT_DATA(auction), URL);
    expect(row.sale_method).toBe('auction');
    expect(row.auction_date).toMatch(/-11-21$/);
  });

  it('returns null when the listing has no usable address', () => {
    const noAddr = { ...FULL_LISTING, address: {} };
    expect(mapDetail(NEXT_DATA(noAddr), URL)).toBe(null);
  });
});

describe('sweep gating + coverage', () => {
  it('never sweeps a blocked run', () => {
    expect(shouldSweep({ blocked: true })).toBe(false);
    expect(shouldSweep({ blocked: false })).toBe(true);
  });
  it('coverage per crawled suburb; truncated and failed indexes handled', () => {
    const rows = [{ suburb: 'Berwick' }, { suburb: 'Harkaway' }];
    expect(buildCoverage([
      { slug: 'berwick-vic-3806', truncated: false },
      { slug: 'harkaway-vic-3806', truncated: true },
      { slug: 'clyde-vic-3978', error: 'x' },
    ], rows)).toEqual({ Berwick: { seen: 1, truncated: false }, Harkaway: { seen: 1, truncated: true } });
  });
});
