import { describe, it, expect } from 'vitest';
import { daysOnMarket } from '../days-on-market';

const NOW = new Date('2026-09-28T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('daysOnMarket', () => {
  it('active row listed 10 days ago → 10 / listed', () => {
    expect(daysOnMarket({ listed_date: daysAgo(10), campaign_started_at: daysAgo(30), created_at: daysAgo(40) }, NOW))
      .toEqual({ daysOnMarket: 10, daysOnMarketBasis: 'listed' });
  });

  it('null listed_date, campaign started 25 days ago → 25 / first_seen', () => {
    expect(daysOnMarket({ listed_date: null, campaign_started_at: daysAgo(25), created_at: daysAgo(40) }, NOW))
      .toEqual({ daysOnMarket: 25, daysOnMarketBasis: 'first_seen' });
  });

  it('falls back to created_at when campaign start is missing (pre-015 rows)', () => {
    expect(daysOnMarket({ created_at: daysAgo(25) }, NOW))
      .toEqual({ daysOnMarket: 25, daysOnMarketBasis: 'first_seen' });
  });

  it('closed row uses removed_at minus basis', () => {
    expect(daysOnMarket({ listed_date: daysAgo(30), removed_at: daysAgo(12), created_at: daysAgo(40) }, NOW))
      .toEqual({ daysOnMarket: 18, daysOnMarketBasis: 'listed' });
  });

  it('rental uses leased_at minus basis', () => {
    expect(daysOnMarket({ listed_date: daysAgo(30), leased_at: daysAgo(20), created_at: daysAgo(40) }, NOW))
      .toEqual({ daysOnMarket: 10, daysOnMarketBasis: 'listed' });
  });

  it('no basis at all → null days, first_seen label', () => {
    expect(daysOnMarket({}, NOW)).toEqual({ daysOnMarket: null, daysOnMarketBasis: 'first_seen' });
  });
});
