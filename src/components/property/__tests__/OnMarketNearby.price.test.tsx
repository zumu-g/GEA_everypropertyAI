import { describe, it, expect } from 'vitest';
import { listingPrice } from '../OnMarketNearby';
import { isOptimizerBlocked } from '@/lib/utils/image';

describe('listingPrice', () => {
  it('prefers the feed display string', () => {
    expect(
      listingPrice({ displayPrice: '$820,000 - $880,000', priceLow: 1, priceHigh: 2 })
    ).toBe('$820,000 - $880,000');
  });

  it('falls back to a formatted range from price_low/high', () => {
    expect(listingPrice({ displayPrice: null, priceLow: 1400000, priceHigh: 1550000 })).toBe(
      '$1,400,000 - $1,550,000'
    );
  });

  it('renders a single figure when low equals high (gea-legacy rows)', () => {
    expect(listingPrice({ displayPrice: null, priceLow: 1550000, priceHigh: 1550000 })).toBe(
      '$1,550,000'
    );
  });

  it('treats a zero bound as missing, not as $0', () => {
    expect(listingPrice({ displayPrice: null, priceLow: 500000, priceHigh: 0 })).toBe('$500,000');
    expect(listingPrice({ displayPrice: null, priceLow: 0, priceHigh: 720000 })).toBe('$720,000');
  });

  it('returns null when no price data exists', () => {
    expect(listingPrice({ displayPrice: null, priceLow: null, priceHigh: null })).toBeNull();
    expect(listingPrice({ displayPrice: null, priceLow: 0, priceHigh: 0 })).toBeNull();
  });
});

describe('isOptimizerBlocked', () => {
  it('flags homely.com.au hosts (optimizer 403s)', () => {
    expect(isOptimizerBlocked('https://www.homely.com.au/img-variant/l-x.jpg?v=1')).toBe(true);
  });

  it('passes well-behaved CDNs and garbage', () => {
    expect(isOptimizerBlocked('https://rimh2.domainstatic.com.au/x.jpg')).toBe(false);
    expect(isOptimizerBlocked('https://i3.au.reastatic.net/x/image.jpg')).toBe(false);
    expect(isOptimizerBlocked(null)).toBe(false);
    expect(isOptimizerBlocked('not-a-url')).toBe(false);
  });
});
