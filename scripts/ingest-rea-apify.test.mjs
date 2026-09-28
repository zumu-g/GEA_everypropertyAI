import { describe, it, expect } from 'vitest';
import { mapOnMarket, buildInput, shouldSweep, buildCoverage, slugToSuburb } from './ingest-rea-apify.mjs';

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

describe('buildInput cost controls', () => {
  it('new mode: Newest sort, newListingOnly, small page', () => {
    const i = buildInput(['Berwick, VIC 3806'], { mode: 'new', resultCount: 10, pages: 1 });
    expect(i).toMatchObject({ sortOrder: 'Newest', newListingOnly: true, resultCount: 10, surroundingSuburbs: false });
  });
  it('full mode: Newest sort, no new-only filter, 25/page', () => {
    const i = buildInput(['Berwick, VIC 3806'], { mode: 'full', resultCount: 25, pages: 1 });
    expect(i).toMatchObject({ sortOrder: 'Newest', newListingOnly: false, resultCount: 25 });
  });
  it('full mode defaults page deep enough to reach a short page for every suburb (KTD9)', () => {
    const i = buildInput(['Berwick, VIC 3806'], { mode: 'full' });
    expect(i.resultCount * i.pages).toBeGreaterThanOrEqual(600);
    expect(buildInput(['Berwick, VIC 3806'], { mode: 'new' }).resultCount * buildInput(['Berwick, VIC 3806'], { mode: 'new' }).pages).toBeLessThanOrEqual(10);
  });
});

describe('mapOnMarket lifecycle fields', () => {
  it('sets sale_method / auction_date from Price + Status text (R25)', () => {
    expect(mapOnMarket(base)).toMatchObject({ sale_method: 'private', auction_date: null });
    const row = mapOnMarket({ ...base, Price: 'Auction Sat 14 Nov' });
    expect(row.sale_method).toBe('auction');
    expect(row.auction_date).toMatch(/-11-14$/);
  });
  it('does not pre-set last_seen_at / active (feed-write.mjs owns them)', () => {
    const row = mapOnMarket(base);
    expect(row).not.toHaveProperty('last_seen_at');
    expect(row).not.toHaveProperty('active');
  });
});

describe('sweep gating (REA sweeps only on a full-mode, unblocked run)', () => {
  it('new mode never sweeps; full mode sweeps; blocked never sweeps', () => {
    expect(shouldSweep({ mode: 'new', blocked: false })).toBe(false);
    expect(shouldSweep({ mode: 'full', blocked: false })).toBe(true);
    expect(shouldSweep({ mode: 'full', blocked: true })).toBe(false);
  });
  it('coverage: a suburb whose item count reaches pages×resultCount is truncated (actor may have more)', () => {
    expect(slugToSuburb('narre-warren-south-vic-3805')).toBe('Narre Warren South');
    const rows = [...Array(6)].map(() => ({ suburb: 'Berwick' })).concat([{ suburb: 'Harkaway' }]);
    expect(buildCoverage(['berwick-vic-3806', 'harkaway-vic-3806', 'clyde-vic-3978'], rows, { pages: 3, resultCount: 2 })).toEqual({
      Berwick: { seen: 6, truncated: true },
      Harkaway: { seen: 1, truncated: false },
      Clyde: { seen: 0, truncated: false },
    });
  });
  it('coverage judges truncation from raw dataset items, not mapped in-area rows', () => {
    // 6 raw Berwick items hit the 3×2 ceiling even though only 2 survive mapping.
    const items = [...Array(6)].map(() => ({ Suburb: 'BERWICK' }));
    const mapped = [{ suburb: 'Berwick' }, { suburb: 'Berwick' }];
    expect(buildCoverage(['berwick-vic-3806'], items, { pages: 3, resultCount: 2 })).toEqual({ Berwick: { seen: 6, truncated: true } });
    expect(buildCoverage(['berwick-vic-3806'], mapped, { pages: 3, resultCount: 2 })).toEqual({ Berwick: { seen: 2, truncated: false } });
  });
});
