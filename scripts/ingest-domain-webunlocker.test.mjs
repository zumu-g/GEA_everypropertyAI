import { describe, it, expect } from 'vitest';
import { looksLikeData, extractListings, mapListing, inArea, shouldExpireRentals } from './ingest-domain-webunlocker.mjs';

const rentNode = (overrides = {}) => ({
  listingModel: {
    address: { street: '1 Test St', suburb: 'Berwick', state: 'VIC', postcode: '3806', lat: -38.03, lng: 145.34 },
    features: { beds: 3, baths: 2, parking: 1 },
    price: '$550 per week',
    tags: { tagText: 'New' },
    url: '/a',
    ...overrides,
  },
});

const NEXT_DATA = (listingsMap) =>
  `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">` +
  JSON.stringify({ props: { pageProps: { componentProps: { listingsMap } } } }) +
  `</script></body></html>`;

// A realistic anti-bot interstitial: 200 OK, plenty of bytes, but NO __NEXT_DATA__.
const CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head><body>' +
  'Checking your browser before accessing domain.com.au. '.repeat(40) +
  '</body></html>';

describe('looksLikeData (body-validation gate)', () => {
  it('accepts a real page with __NEXT_DATA__', () => {
    expect(looksLikeData(NEXT_DATA({}))).toBe(true);
  });
  it('rejects an anti-bot challenge page returned as 200', () => {
    expect(CHALLENGE_PAGE.length).toBeGreaterThan(1000); // would pass the old length-only check
    expect(looksLikeData(CHALLENGE_PAGE)).toBe(false);
  });
  it('rejects empty / non-string bodies', () => {
    expect(looksLikeData('')).toBe(false);
    expect(looksLikeData(undefined)).toBe(false);
    expect(looksLikeData(null)).toBe(false);
  });
});

describe('extractListings', () => {
  it('extracts listing nodes from listingsMap', () => {
    const html = NEXT_DATA({ '1': { listingModel: { url: '/a' } }, '2': { listingModel: { url: '/b' } } });
    expect(extractListings(html)).toHaveLength(2);
  });
  it('returns [] when __NEXT_DATA__ is absent (challenge page)', () => {
    expect(extractListings(CHALLENGE_PAGE)).toEqual([]);
  });
  it('returns [] on malformed JSON', () => {
    expect(extractListings('<script id="__NEXT_DATA__">{not json}</script>')).toEqual([]);
  });
});

describe('mapListing (rent)', () => {
  it('maps a happy-path rent listing', () => {
    const row = mapListing('rent', rentNode());
    expect(row).toMatchObject({
      raw_address: '1 Test St, Berwick VIC 3806',
      suburb: 'Berwick',
      weekly_rent: 550,
      display_price: '$550 per week',
      status: 'New',
      source: 'domain-web-unlocker',
      active: true,
    });
    expect(row.last_seen_at).toEqual(expect.any(String));
  });

  it('takes the lowest amount from a rent range', () => {
    const row = mapListing('rent', rentNode({ price: '$520 - $560 pw' }));
    expect(row.weekly_rent).toBe(520);
  });

  it('keeps the row with weekly_rent null when no dollar figure is present', () => {
    const row = mapListing('rent', rentNode({ price: 'Contact agent' }));
    expect(row).not.toBeNull();
    expect(row.weekly_rent).toBeNull();
  });

  it('contrasts with sold: a missing price is skipped for sold but kept for rent', () => {
    const soldRow = mapListing('sold', rentNode({ price: 'Price Withheld' }));
    const rentRow = mapListing('rent', rentNode({ price: 'Price Withheld' }));
    expect(soldRow).toBeNull();
    expect(rentRow).not.toBeNull();
  });

  it('returns null when street or suburb is missing', () => {
    expect(mapListing('rent', rentNode({ address: { suburb: 'Berwick' } }))).toBeNull();
    expect(mapListing('rent', rentNode({ address: { street: '1 Test St' } }))).toBeNull();
  });

  it('suburb passes through the inArea gate for in-area suburbs, and is rejected for out-of-area ones', () => {
    const row = mapListing('rent', rentNode());
    expect(inArea(row.suburb)).toBe(true);
    expect(inArea('Melbourne')).toBe(false);
  });
});

describe('shouldExpireRentals (expiry gate)', () => {
  it('expires only on a full, unblocked rent run', () => {
    expect(shouldExpireRentals({ category: 'rent', blocked: false, slugsEnv: undefined, maxSuburbsArg: undefined })).toBe(true);
  });
  it('never expires a blocked run', () => {
    expect(shouldExpireRentals({ category: 'rent', blocked: true, slugsEnv: undefined, maxSuburbsArg: undefined })).toBe(false);
  });
  it('never expires a SLUGS-restricted run', () => {
    expect(shouldExpireRentals({ category: 'rent', blocked: false, slugsEnv: 'berwick-vic-3806', maxSuburbsArg: undefined })).toBe(false);
  });
  it('never expires a maxSuburbs-restricted run (e.g. the single-suburb smoke run)', () => {
    expect(shouldExpireRentals({ category: 'rent', blocked: false, slugsEnv: undefined, maxSuburbsArg: '1' })).toBe(false);
  });
  it('never expires for sold or on-market', () => {
    expect(shouldExpireRentals({ category: 'sold', blocked: false, slugsEnv: undefined, maxSuburbsArg: undefined })).toBe(false);
    expect(shouldExpireRentals({ category: 'on-market', blocked: false, slugsEnv: undefined, maxSuburbsArg: undefined })).toBe(false);
  });
});
