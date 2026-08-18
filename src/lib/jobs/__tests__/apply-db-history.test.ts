import { describe, it, expect } from 'vitest';
import { applyDbHistory } from '../feed-seed';

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

  it('skips rentals with no rent or no date', () => {
    const p = profileWith({});
    const added = applyDbHistory(p, [], [{ weekly_rent: null, listed_date: '2024-01-01' }, { weekly_rent: 500 }]);
    expect(added).toBe(false);
  });
});
