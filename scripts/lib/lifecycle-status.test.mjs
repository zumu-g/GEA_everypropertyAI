import { describe, it, expect } from 'vitest';
import { lifecycleFromSource, saleMethodFromText, parsePriceRange, normaliseDisplay } from './lifecycle-status.mjs';

const NOW = new Date('2026-09-28T00:00:00Z');

describe('lifecycleFromSource', () => {
  it('maps under offer / under contract', () => {
    expect(lifecycleFromSource('Under Offer')).toBe('under_offer');
    expect(lifecycleFromSource('under contract')).toBe('under_offer');
  });
  it('maps sold text and a soldOn signal', () => {
    expect(lifecycleFromSource('Sold')).toBe('sold');
    expect(lifecycleFromSource('ForSale', { sold: true })).toBe('sold');
  });
  it('everything else while active is active', () => {
    expect(lifecycleFromSource('New')).toBe('active');
    expect(lifecycleFromSource(null)).toBe('active');
    expect(lifecycleFromSource('Auction Sat 6 Jun')).toBe('active');
  });
});

describe('saleMethodFromText', () => {
  it('"Auction Sat 14 Nov" → auction with the next 14 November', () => {
    expect(saleMethodFromText('Auction Sat 14 Nov', null, NOW)).toEqual({ sale_method: 'auction', auction_date: '2026-11-14' });
  });
  it('rolls the year forward when the day-month has passed by more than 7 days', () => {
    expect(saleMethodFromText('Auction 6 Jun', null, NOW).auction_date).toBe('2027-06-06');
  });
  it('keeps a date within the last 7 days in the current year', () => {
    expect(saleMethodFromText('Auction Sat 26 Sep', null, NOW).auction_date).toBe('2026-09-26');
  });
  it('parses 14/11 and full month names, and auction in status text', () => {
    expect(saleMethodFromText('Auction 14/11', null, NOW).auction_date).toBe('2026-11-14');
    expect(saleMethodFromText('Auction 14 November', null, NOW).auction_date).toBe('2026-11-14');
    expect(saleMethodFromText('Contact agent', 'Auction', NOW)).toEqual({ sale_method: 'auction', auction_date: null });
  });
  it('"$850,000 - $900,000" → private; wording → private', () => {
    expect(saleMethodFromText('$850,000 - $900,000', null, NOW)).toEqual({ sale_method: 'private', auction_date: null });
    expect(saleMethodFromText('Offers over $800k', null, NOW).sale_method).toBe('private');
    expect(saleMethodFromText('For Sale', null, NOW).sale_method).toBe('private');
    expect(saleMethodFromText('Private sale', null, NOW).sale_method).toBe('private');
  });
  it('"Contact agent" → unknown', () => {
    expect(saleMethodFromText('Contact agent', null, NOW)).toEqual({ sale_method: 'unknown', auction_date: null });
    expect(saleMethodFromText(null, null, NOW).sale_method).toBe('unknown');
  });
});

describe('price helpers', () => {
  it('parsePriceRange handles ranges, single amounts and k suffix', () => {
    expect(parsePriceRange('$850,000 - $900,000')).toEqual({ low: 850000, high: 900000 });
    expect(parsePriceRange('$850,000-$900,000')).toEqual({ low: 850000, high: 900000 });
    expect(parsePriceRange('$1,200,000')).toEqual({ low: 1200000, high: 1200000 });
    expect(parsePriceRange('Offers over $800k')).toEqual({ low: 800000, high: 800000 });
    expect(parsePriceRange('Contact agent')).toEqual({ low: null, high: null });
  });
  it('normaliseDisplay collapses spacing and case', () => {
    expect(normaliseDisplay('Auction  Sat 6 Jun ')).toBe(normaliseDisplay('auction sat 6 jun'));
  });
});

describe('normaliseDisplay date stripping', () => {
  it('treats auction texts differing only by date as equal', () => {
    expect(normaliseDisplay('Auction Sat 6 Jun')).toBe(normaliseDisplay('Auction Sat 13 Jun'));
    expect(normaliseDisplay('Auction 14/11')).toBe(normaliseDisplay('Auction 21/11'));
    expect(normaliseDisplay('Auction Sat 6 Jun')).not.toBe(normaliseDisplay('Contact agent'));
  });
});
