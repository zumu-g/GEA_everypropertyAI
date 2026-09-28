import { describe, it, expect } from 'vitest';
import { looksLikeData, extractListings, mapListing, inArea, shouldSweep, buildCoverage, slugToSuburb, listingsPage } from './ingest-domain-webunlocker.mjs';
import { paginateUntilShort } from './lib/paginate.mjs';

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
    });
    // feed-write.mjs owns these; a mapper must not pre-set them
    expect(row).not.toHaveProperty('last_seen_at');
    expect(row).not.toHaveProperty('active');
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

describe('mapListing listed_date (on-market + rent)', () => {
  it('sets listed_date + source domain-search when dateListed is present and differs from dateUpdated', () => {
    const row = mapListing('on-market', rentNode({ dateListed: '2026-09-01T00:00:00Z', dateUpdated: '2026-09-20T03:00:00Z' }));
    expect(row).toMatchObject({ listed_date: '2026-09-01T00:00:00Z', listed_date_source: 'domain-search' });
  });
  it('leaves listed_date null when dateListed equals dateUpdated (Domain re-stamps on edit)', () => {
    const row = mapListing('rent', rentNode({ dateListed: '2026-09-20T03:00:00Z', dateUpdated: '2026-09-20T03:00:00Z' }));
    expect(row).toMatchObject({ listed_date: null, listed_date_source: null });
  });
  it('leaves listed_date null when dateListed is absent, but the keys are still present (uniform batch keys)', () => {
    const row = mapListing('on-market', rentNode({ dateUpdated: '2026-09-20T03:00:00Z' }));
    expect(row).toHaveProperty('listed_date', null);
    expect(row).toHaveProperty('listed_date_source', null);
  });
});

describe('mapListing sale_method (on-market)', () => {
  it('auction text in the price sets auction + auction_date', () => {
    const row = mapListing('on-market', rentNode({ price: 'Auction Sat 14 Nov' }));
    expect(row.sale_method).toBe('auction');
    expect(row.auction_date).toMatch(/-11-14$/);
  });
  it('a dollar range is private; rent rows carry no sale_method (property_rentals has no such column)', () => {
    expect(mapListing('on-market', rentNode({ price: '$800,000 - $880,000' }))).toMatchObject({ sale_method: 'private', auction_date: null });
    expect(mapListing('rent', rentNode())).not.toHaveProperty('sale_method');
  });
});

describe('paginateUntilShort', () => {
  const pages = (sizes) => async (n) => Array.from({ length: sizes[n - 1] ?? 0 }, (_, i) => `p${n}-${i}`);
  it('stops on the first page shorter than the previous one', async () => {
    const r = await paginateUntilShort(pages([20, 20, 7, 20]));
    expect(r.items).toHaveLength(47);
    expect(r).toMatchObject({ pages: 3, truncated: false });
  });
  it('stops on an empty page', async () => {
    const r = await paginateUntilShort(pages([20, 0]));
    expect(r).toMatchObject({ pages: 2, truncated: false });
  });
  it('stops when a page adds nothing new (portal repeats the last page past the end)', async () => {
    const r = await paginateUntilShort(async () => ['a', 'b'], { key: (x) => x });
    expect(r.items).toEqual(['a', 'b']);
    expect(r).toMatchObject({ pages: 2, truncated: false });
  });
  it('marks a suburb that hits the page cap as truncated', async () => {
    const r = await paginateUntilShort(async (n) => [`x${n}`], { cap: 20, key: (x) => x });
    expect(r).toMatchObject({ pages: 20, truncated: true });
  });
  it('a failure after page 1 keeps the rows but marks the suburb truncated', async () => {
    const r = await paginateUntilShort(async (n) => { if (n === 2) throw new Error('boom'); return ['a', 'b']; }, { key: (x) => x });
    expect(r.items).toEqual(['a', 'b']);
    expect(r).toMatchObject({ truncated: true, error: 'boom' });
  });
  it('a failure on page 1 propagates (the suburb was never fetched → blocked)', async () => {
    await expect(paginateUntilShort(async () => { throw new Error('nope'); })).rejects.toThrow('nope');
  });
});

describe('sweep gating + coverage', () => {
  it('sweeps on-market and rent, never sold, never a blocked run', () => {
    expect(shouldSweep({ category: 'on-market', blocked: false })).toBe(true);
    expect(shouldSweep({ category: 'rent', blocked: false })).toBe(true);
    expect(shouldSweep({ category: 'sold', blocked: false })).toBe(false);
    expect(shouldSweep({ category: 'on-market', blocked: true })).toBe(false);
  });
  it('coverage counts rows per crawled suburb and excludes truncated / failed slugs from a clean sweep', () => {
    expect(slugToSuburb('narre-warren-south-vic-3805')).toBe('Narre Warren South');
    const rows = [{ suburb: 'Berwick' }, { suburb: 'Berwick' }, { suburb: 'Harkaway' }, { suburb: 'Clyde' }];
    const cov = buildCoverage([
      { slug: 'berwick-vic-3806', truncated: false },
      { slug: 'harkaway-vic-3806', truncated: true },
      { slug: 'clyde-vic-3978', error: 'blocked' },
    ], rows);
    expect(cov).toEqual({ Berwick: { seen: 2, truncated: false }, Harkaway: { seen: 1, truncated: true } });
  });
  it('rows from an uncrawled in-area suburb get a coverage entry when every crawled slug is clean', () => {
    const rows = [{ suburb: 'Berwick' }, { suburb: 'Harkaway' }, { suburb: 'Harkaway' }];
    expect(buildCoverage([{ slug: 'berwick-vic-3806', truncated: false }], rows))
      .toEqual({ Berwick: { seen: 1, truncated: false }, Harkaway: { seen: 2, truncated: false } });
  });
  it('uncrawled suburbs are not added when any slug is truncated or errored', () => {
    const rows = [{ suburb: 'Berwick' }, { suburb: 'Harkaway' }];
    expect(buildCoverage([{ slug: 'berwick-vic-3806', truncated: true }], rows)).toEqual({ Berwick: { seen: 1, truncated: true } });
    expect(buildCoverage([{ slug: 'berwick-vic-3806', truncated: false }, { slug: 'clyde-vic-3978', error: 'x' }], rows)).toEqual({ Berwick: { seen: 1, truncated: false } });
  });
  it('out-of-area rows never create a coverage entry', () => {
    expect(buildCoverage([{ slug: 'berwick-vic-3806', truncated: false }], [{ suburb: 'Dandenong' }])).toEqual({ Berwick: { seen: 0, truncated: false } });
  });
});

describe('listingsPage (soft-block guard)', () => {
  it('throws on non-listings HTML instead of returning an empty page', () => {
    expect(() => listingsPage(CHALLENGE_PAGE)).toThrow(/not a listings page/);
  });
  it('returns the nodes of a genuine page', () => {
    expect(listingsPage(NEXT_DATA({ a: rentNode() }))).toHaveLength(1);
  });
});
