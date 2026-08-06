import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildActorInput,
  slugForRawAddress,
  mapItem,
  loadState,
  saveState,
  resetState,
} from './backfill-sale-history-apify.mjs';

const ITEM = {
  address: {
    display: '12 Bailey Street, Berwick VIC 3806',
    suburb: 'Berwick',
    state: 'VIC',
    postcode: '3806',
  },
  bedrooms: 3,
  bathrooms: 2,
  carSpaces: 1,
  propertyType: 'House',
  url: 'https://www.realestate.com.au/property-house-vic-berwick-1234',
  image: 'https://img.rea/1.jpg',
  priceHistory: [
    { type: 'sold', date: '2019-05-04', price: 650000 },
    { type: 'sold', date: '2012-11-10', price: '$420,000' },
  ],
};

describe('buildActorInput', () => {
  it('builds one search string per address with history enabled', () => {
    const input = buildActorInput(['12 Bailey Street, Berwick VIC 3806']);
    expect(input.searchInputs).toEqual(['12 Bailey Street, Berwick VIC 3806']);
    expect(input.includePriceHistory).toBe(true);
  });
});

describe('slugForRawAddress', () => {
  it('mirrors parseAddress+toSlug', () => {
    expect(slugForRawAddress('12 Bailey Street, Berwick VIC 3806'))
      .toBe('12-bailey-street-berwick-vic-3806');
    expect(slugForRawAddress('2/31 Florence Ave, Berwick VIC 3806'))
      .toBe('2-31-florence-avenue-berwick-vic-3806');
  });
});

describe('mapItem', () => {
  it('maps sale events with date+price to property_sales rows', () => {
    const rows = mapItem(ITEM);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      raw_address: '12 Bailey Street, Berwick VIC 3806',
      address_slug: '12-bailey-street-berwick-vic-3806',
      suburb: 'Berwick',
      state: 'VIC',
      postcode: '3806',
      bedrooms: 3,
      bathrooms: 2,
      car_spaces: 1,
      property_type: 'House',
      listing_url: 'https://www.realestate.com.au/property-house-vic-berwick-1234',
      image_url: 'https://img.rea/1.jpg',
      sale_price: 650000,
      sale_date: '2019-05-04',
      source: 'rea-history-apify',
    });
    expect(rows[0].raw_data).toEqual(ITEM.priceHistory[0]);
    // "$420,000" string price parsed to number
    expect(rows[1].sale_price).toBe(420000);
    expect(rows[1].sale_date).toBe('2012-11-10');
  });

  it('skips lease/rent/withdrawal/listing events', () => {
    const rows = mapItem({
      ...ITEM,
      priceHistory: [
        { type: 'leased', date: '2020-01-01', price: 450 },
        { type: 'rent', date: '2020-01-01', price: 450 },
        { type: 'withdrawn', date: '2020-01-01', price: 500000 },
        { type: 'listed', date: '2020-01-01', price: 500000 },
      ],
    });
    expect(rows).toEqual([]);
  });

  it('skips sale events with no parseable date', () => {
    const rows = mapItem({
      ...ITEM,
      priceHistory: [
        { type: 'sold', price: 650000 },
        { type: 'sold', date: 'unknown', price: 650000 },
      ],
    });
    expect(rows).toEqual([]);
  });

  it('skips sale events with null/zero/confidential price', () => {
    const rows = mapItem({
      ...ITEM,
      priceHistory: [
        { type: 'sold', date: '2019-05-04', price: null },
        { type: 'sold', date: '2019-05-04', price: 0 },
        { type: 'sold', date: '2019-05-04', price: 'Contact agent' },
      ],
    });
    expect(rows).toEqual([]);
  });

  it('drops addresses outside the service area', () => {
    const rows = mapItem({
      ...ITEM,
      address: { display: '1 Collins Street, Melbourne VIC 3000', suburb: 'Melbourne', state: 'VIC', postcode: '3000' },
    });
    expect(rows).toEqual([]);
  });

  it('handles malformed/empty items without crashing', () => {
    expect(mapItem(null)).toEqual([]);
    expect(mapItem({})).toEqual([]);
    expect(mapItem({ address: {}, priceHistory: 'nope' })).toEqual([]);
    expect(mapItem({ priceHistory: [{ type: 'sold', date: '2019-05-04', price: 1 }] })).toEqual([]);
  });
});

describe('cursor state', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'bfstate-')), 'state.json');

  it('round-trips save/load and clears on reset', () => {
    expect(loadState(file)).toBe(null);
    const state = { nextBatch: 3, addressCount: 1200, inserted: 456 };
    saveState(file, state);
    expect(loadState(file)).toEqual(state);
    resetState(file);
    expect(loadState(file)).toBe(null);
  });
});
