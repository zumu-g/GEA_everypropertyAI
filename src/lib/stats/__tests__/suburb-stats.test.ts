import { describe, it, expect } from 'vitest';
import { computeBlock, type BlockInput } from '../suburb-stats';
import { resolvePeriod } from '../periods';
import type { StatsListingRow, StatsRentalRow, PriceHistoryRow, StatsSaleRow } from '@/lib/db/stats-queries';

// August 2026, go-live far enough back that nothing is inside the exclusion window.
const bounds = resolvePeriod('month', '2026-08-15');
const GO_LIVE = '2026-01-01';

let n = 0;
function listing(o: Partial<StatsListingRow> = {}): StatsListingRow {
  n++;
  return {
    raw_address: o.raw_address ?? `${n} Test St, Berwick VIC 3806`,
    address_slug: o.address_slug ?? `${n}-test-st-berwick-vic-3806`,
    suburb: 'Berwick', state: 'VIC', source: 'domain',
    price_low: 800_000, price_high: 800_000,
    created_at: '2026-07-01T00:00:00Z',
    campaign_started_at: '2026-07-01T00:00:00Z',
    lifecycle_status: 'active', sale_method: 'private', active: true,
    ...o,
  } as StatsListingRow;
}
function sale(o: Partial<StatsSaleRow> = {}): StatsSaleRow {
  n++;
  return {
    raw_address: o.raw_address ?? `${n} Sold St, Berwick VIC 3806`,
    address_slug: o.address_slug ?? `${n}-sold-st-berwick-vic-3806`,
    suburb: 'Berwick', state: 'VIC', source: 'domain',
    sale_price: 900_000, sale_date: '2026-08-10', property_type: 'House',
    ...o,
  } as StatsSaleRow;
}
function rental(o: Partial<StatsRentalRow> = {}): StatsRentalRow {
  n++;
  return {
    raw_address: `${n} Rent St, Berwick VIC 3806`, suburb: 'Berwick', state: 'VIC', source: 'domain',
    weekly_rent: 550, created_at: '2026-07-01T00:00:00Z', campaign_started_at: '2026-07-01T00:00:00Z', active: true,
    ...o,
  } as StatsRentalRow;
}
function hist(raw_address: string, observed_at: string, price: number, source = 'domain'): PriceHistoryRow {
  return { table_name: 'listings', raw_address, source, observed_at, price_low: price, price_high: price };
}
function input(o: Partial<BlockInput>): BlockInput {
  return { bounds, goLive: GO_LIVE, listings: [], rentals: [], history: [], sales: [], ...o };
}

describe('computeBlock — listings and sales fixture', () => {
  // 6 listings: 4 active at end (2 new in period), 1 withdrawn mid-period, 1 created after period.
  const listings = [
    listing({ price_low: 700_000, price_high: 700_000 }),
    listing({ price_low: 800_000, price_high: 800_000 }),
    listing({ campaign_started_at: '2026-08-05T00:00:00Z', created_at: '2026-08-05T00:00:00Z', price_low: 900_000, price_high: 900_000 }),
    listing({ campaign_started_at: '2026-08-20T00:00:00Z', created_at: '2026-08-20T00:00:00Z', price_low: 1_000_000, price_high: 1_000_000 }),
    listing({ lifecycle_status: 'withdrawn', removed_at: '2026-08-15T00:00:00Z', active: false }),
    listing({ campaign_started_at: '2026-09-02T00:00:00Z', created_at: '2026-09-02T00:00:00Z' }),
  ];
  // 4 sales in August + 2 in the trailing window (June/July) → 6 over 3 months = 2/month.
  const sales = [
    sale({ sale_price: 850_000 }), sale({ sale_price: 950_000 }),
    sale({ sale_price: 1_200_000 }), sale({ sale_price: 600_000, property_type: 'Unit' }),
    sale({ sale_date: '2026-07-10', sale_price: 700_000 }), sale({ sale_date: '2026-06-20', sale_price: 700_000 }),
  ];
  const block = computeBlock(input({ listings, sales }));

  it('active / new / medianAsking / withdrawn', () => {
    expect(block.activeListings).toBe(4);
    expect(block.newListings).toBe(2);
    expect(block.medianAsking).toBe(850_000);
    expect(block.withdrawnCount).toBe(1);
  });

  it('sales, house median and months of supply', () => {
    expect(block.salesCount).toBe(4);
    expect(block.medianSalePrice).toBe(900_000);
    expect(block.medianSalePriceHouse).toBe(950_000);
    expect(block.monthsOfSupply).toBe(2); // 4 active / (6 sales / 3 months)
    expect(block.saleToListRatio).toBeNull(); // no slug matches
  });

  it('withdrawal inside the two-sweep exclusion window after go-live is not counted', () => {
    const b = computeBlock(input({ listings, sales, goLive: '2026-08-10' }));
    expect(b.withdrawnCount).toBe(0);
  });

  it('days on market uses listed_date when present, else campaign start', () => {
    const b = computeBlock(input({ listings: [
      listing({ listed_date: '2026-08-21', campaign_started_at: '2026-07-01T00:00:00Z' }), // 10 days to 31 Aug
      listing({ campaign_started_at: '2026-08-11T00:00:00Z' }), // 20 days
      listing({ campaign_started_at: '2026-08-01T00:00:00Z' }), // 30 days
    ] }));
    expect(b.medianDaysOnMarket).toBe(20);
  });
});

describe('computeBlock — sold rows are not active', () => {
  it('a lifecycle sold row with no removed_at is excluded from activeListings and rentalListings', () => {
    const blk = computeBlock(input({
      listings: [listing(), listing({ lifecycle_status: 'sold' })],
      rentals: [rental(), rental({ lifecycle_status: 'sold' } as Partial<StatsRentalRow>)],
    }));
    expect(blk.activeListings).toBe(1);
    expect(blk.rentalListings).toBe(1);
  });
});

describe('computeBlock — price cuts', () => {
  it('counts only negative midpoint changes observed inside the period', () => {
    const a = listing({ raw_address: 'A' });
    const b = listing({ raw_address: 'B' });
    const c = listing({ raw_address: 'C' });
    const history = [
      hist('A', '2026-07-01T00:00:00Z', 1_000_000), hist('A', '2026-08-10T00:00:00Z', 900_000), // -10%
      hist('B', '2026-07-01T00:00:00Z', 1_000_000), hist('B', '2026-08-12T00:00:00Z', 1_050_000), // rise
      hist('C', '2026-07-01T00:00:00Z', 1_000_000), hist('C', '2026-07-20T00:00:00Z', 800_000), // cut, outside period
      hist('C', '2026-08-20T00:00:00Z', 760_000), // -5% inside
    ];
    const blk = computeBlock(input({ listings: [a, b, c], history }));
    expect(blk.priceCutCount).toBe(2);
    expect(blk.priceCutMedianPct).toBe(7.5);
  });
});

describe('computeBlock — auctions and private sales (AE6, R26)', () => {
  it('12 held, 8 cleared within 14 days → 0.67; 20-day match not cleared', () => {
    const rows: StatsListingRow[] = [];
    const sales: StatsSaleRow[] = [];
    for (let i = 0; i < 12; i++) {
      const slug = `auction-${i}`;
      const soldByStatus = i < 4;
      const soldByMatch = i >= 4 && i < 8;
      rows.push(listing({
        address_slug: slug, sale_method: 'auction', auction_date: '2026-08-15',
        campaign_started_at: '2026-07-20T00:00:00Z',
        lifecycle_status: soldByStatus ? 'sold' : 'active',
        removed_at: soldByStatus ? '2026-08-16T00:00:00Z' : undefined,
      }));
      if (soldByMatch) sales.push(sale({ address_slug: slug, sale_date: '2026-08-20' }));
    }
    // Late match: 20 days after auction — held but not cleared.
    sales.push(sale({ address_slug: 'auction-11', sale_date: '2026-09-04' }));
    const blk = computeBlock(input({ listings: rows, sales }));
    expect(blk.auctionsHeld).toBe(12);
    expect(blk.auctionsCleared).toBe(8);
    expect(blk.auctionClearanceRate).toBe(0.67);
    expect(blk.privateSalesClosed).toBe(0); // auction rows never in the private denominator
  });

  it('a matching sale dated before the campaign start does not clear the auction', () => {
    const rows = [0, 1, 2, 3, 4].map((i) => listing({
      address_slug: `pre-${i}`, sale_method: 'auction', auction_date: '2026-08-15',
      created_at: '2026-07-20T00:00:00Z', campaign_started_at: '2026-07-20T00:00:00Z',
    }));
    const sales = [
      sale({ address_slug: 'pre-0', sale_date: '2026-07-10' }), // before campaign start → not cleared
      sale({ address_slug: 'pre-1', sale_date: '2026-08-16' }), // within window → cleared
    ];
    const blk = computeBlock(input({ listings: rows, sales }));
    expect(blk.auctionsHeld).toBe(5);
    expect(blk.auctionsCleared).toBe(1);
  });

  it('three auctions → null rate with counts', () => {
    const rows = [0, 1, 2].map(() => listing({ sale_method: 'auction', auction_date: '2026-08-08', lifecycle_status: 'sold', removed_at: '2026-08-09T00:00:00Z' }));
    const blk = computeBlock(input({ listings: rows }));
    expect(blk.auctionsHeld).toBe(3);
    expect(blk.auctionsCleared).toBe(3);
    expect(blk.auctionClearanceRate).toBeNull();
  });

  it('private conversion: 4 sold of 6 closed → 0.67', () => {
    const rows = [
      ...[1, 2, 3, 4].map(() => listing({ lifecycle_status: 'sold', removed_at: '2026-08-10T00:00:00Z' })),
      ...[1, 2].map(() => listing({ lifecycle_status: 'withdrawn', removed_at: '2026-08-11T00:00:00Z' })),
      listing({ sale_method: 'auction', auction_date: '2026-08-15', lifecycle_status: 'withdrawn', removed_at: '2026-08-20T00:00:00Z' }),
    ];
    const blk = computeBlock(input({ listings: rows }));
    expect(blk.privateSalesClosed).toBe(6);
    expect(blk.privateSalesSold).toBe(4);
    expect(blk.privateSaleConversionRate).toBe(0.67);
  });
});

describe('computeBlock — sale-to-list ratio', () => {
  function matched(count: number) {
    const listings: StatsListingRow[] = [];
    const sales: StatsSaleRow[] = [];
    const history: PriceHistoryRow[] = [];
    for (let i = 0; i < count; i++) {
      const raw = `${i} Ratio St`;
      listings.push(listing({ raw_address: raw, address_slug: `ratio-${i}`, campaign_started_at: '2026-06-01T00:00:00Z' }));
      history.push(hist(raw, '2026-06-01T00:00:00Z', 1_000_000), hist(raw, '2026-07-01T00:00:00Z', 900_000));
      sales.push(sale({ address_slug: `ratio-${i}`, sale_price: 945_000, sale_date: '2026-08-10' }));
    }
    return computeBlock(input({ listings, sales, history }));
  }
  it('null under five matches, median ratio over the last midpoint before sale otherwise', () => {
    expect(matched(4).saleToListRatio).toBeNull();
    expect(matched(5).saleToListRatio).toBe(1.05);
  });
});

describe('computeBlock — rentals', () => {
  it('counts rentals active at period end and their median rent', () => {
    const blk = computeBlock(input({ rentals: [
      rental({ weekly_rent: 500 }), rental({ weekly_rent: 600 }),
      rental({ weekly_rent: 900, leased_at: '2026-08-10T00:00:00Z', active: false }),
    ] }));
    expect(blk.rentalListings).toBe(2);
    expect(blk.medianRent).toBe(550);
  });
});
