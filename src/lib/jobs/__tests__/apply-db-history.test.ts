import { describe, it, expect } from 'vitest';
import { applyDbHistory, splitRentalCampaigns } from '../feed-seed';

function profileWith(data: Record<string, unknown>) {
  return { data };
}

describe('applyDbHistory', () => {
  it('seeds sale + rental history into an empty profile', () => {
    const p = profileWith({});
    const added = applyDbHistory(
      p,
      [{ sale_date: '2024-03-15', sale_price: 650_000, agency_name: 'Ray White', source: 'vic-vg' }],
      [{ listed_date: '2021-08-06', weekly_rent: 360, source: 'domain' }],
    );
    expect(added).toBe(true);
    expect(p.data.saleHistory).toEqual([
      { date: '2024-03-15', price: 650_000, agency: 'Ray White', type: 'sold', source: 'vic-vg' },
    ]);
    expect(p.data.rentalHistory).toEqual([{ date: '2021-08-06', weeklyRent: 360 }]);
  });

  it('dedups against crawl history on month+price and keeps crawl entries first-class', () => {
    const p = profileWith({
      saleHistory: [{ date: '2024-03-02', price: 650_000, agency: 'Crawled Agency' }],
    });
    const added = applyDbHistory(
      p,
      [
        { sale_date: '2024-03-15', sale_price: 650_000, source: 'vic-vg' }, // same month+price → dup
        { sale_date: '2018-06-01', sale_price: 480_000, source: 'vic-vg' }, // genuinely new
      ],
      [],
    );
    expect(added).toBe(true);
    const sh = p.data.saleHistory as Array<{ date: string }>;
    expect(sh).toHaveLength(2);
    expect(sh[0].date).toBe('2024-03-02'); // sorted desc, crawl entry kept
    expect(sh[1].date).toBe('2018-06-01');
  });

  it('returns false and leaves the profile untouched when everything is a dup', () => {
    const p = profileWith({ saleHistory: [{ date: '2024-03-02', price: 650_000 }] });
    const added = applyDbHistory(p, [{ sale_date: '2024-03-20', sale_price: 650_000 }], []);
    expect(added).toBe(false);
    expect(p.data.saleHistory).toHaveLength(1);
  });

  it('keeps confidential sales (null price) as dated events without a price', () => {
    const p = profileWith({});
    applyDbHistory(p, [{ sale_date: '2023-11-01', sale_price: null, source: 'vic-vg' }], []);
    const sh = p.data.saleHistory as Array<{ date: string; price?: number }>;
    expect(sh[0].date).toBe('2023-11-01');
    expect('price' in sh[0]).toBe(false);
  });

  it('adds days on market from campaign start to leased / removed / last seen', () => {
    const p = profileWith({});
    applyDbHistory(p, [], [
      { campaign_started_at: '2026-09-29T01:01:21Z', last_seen_at: '2026-10-04T23:58:23Z', weekly_rent: 750, agent_name: 'Rentals Reception', source: 'domain-web-unlocker' },
      { listed_date: '2026-03-01', leased_at: '2026-03-22T00:00:00Z', last_seen_at: '2026-03-30T00:00:00Z', weekly_rent: 700 },
    ]);
    const rh = p.data.rentalHistory as Array<{ date: string; daysOnMarket?: number }>;
    expect(rh.map((r) => [r.date, r.daysOnMarket])).toEqual([['2026-09-29', 5], ['2026-03-01', 21]]);
  });

  it('adds one event per rent change from listing price history', () => {
    const p = profileWith({});
    applyDbHistory(p, [], [{
      campaign_started_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-10-10T00:00:00Z', weekly_rent: 720,
      price_history: [
        { observed_at: '2026-09-01T00:00:00Z', price_low: 750 },
        { observed_at: '2026-09-15T00:00:00Z', price_low: 750 }, // unchanged → no event
        { observed_at: '2026-09-20T00:00:00Z', price_low: 720 },
      ],
    }]);
    const rh = p.data.rentalHistory as Array<{ date: string; weeklyRent: number; description?: string; daysOnMarket?: number }>;
    expect(rh).toHaveLength(2);
    expect(rh[0]).toMatchObject({ date: '2026-09-20', weeklyRent: 720, description: 'Rent reduced from $750/wk to $720/wk' });
    expect(rh[1]).toMatchObject({ date: '2026-09-01', weeklyRent: 750, daysOnMarket: 39 });
  });

  it('skips rentals with no rent or no date', () => {
    const p = profileWith({});
    const added = applyDbHistory(p, [], [{ weekly_rent: null, listed_date: '2024-01-01' }, { weekly_rent: 500 }]);
    expect(added).toBe(false);
  });
});

describe('splitRentalCampaigns', () => {
  it('splits a relisted row into one campaign per listing_url, current one keeping the row lifecycle', () => {
    const row = { raw_address: '18 Welsh Crescent, Clyde North VIC 3978', listing_url: 'https://d/new', weekly_rent: 750, campaign_started_at: '2026-09-29T00:00:00Z', last_seen_at: '2026-10-04T00:00:00Z', agent_name: 'Rentals Reception' };
    const history = [
      { listing_url: 'https://d/old', observed_at: '2026-07-10T00:00:00Z', price_low: 780 },
      { listing_url: 'https://d/old', observed_at: '2026-08-02T00:00:00Z', price_low: 760 },
      { listing_url: 'https://d/new', observed_at: '2026-09-29T00:00:00Z', price_low: 750 },
    ];
    const [prior, current] = splitRentalCampaigns(row, history);
    expect(prior).toMatchObject({ campaign_started_at: '2026-07-10T00:00:00Z', last_seen_at: '2026-08-02T00:00:00Z', weekly_rent: 760 });
    expect(prior.agent_name).toBeUndefined(); // the current agent did not run the earlier campaign
    expect(prior.price_history).toHaveLength(2);
    expect(current).toMatchObject({ campaign_started_at: '2026-09-29T00:00:00Z', agent_name: 'Rentals Reception' });
    expect(current.price_history).toHaveLength(1);
  });

  it('returns the row unchanged (with its history) when there is one campaign', () => {
    const row = { raw_address: 'x', listing_url: 'u', weekly_rent: 500 };
    expect(splitRentalCampaigns(row, [{ listing_url: 'u', observed_at: '2026-01-01', price_low: 500 }]))
      .toEqual([{ ...row, price_history: [{ listing_url: 'u', observed_at: '2026-01-01', price_low: 500 }] }]);
  });
});
