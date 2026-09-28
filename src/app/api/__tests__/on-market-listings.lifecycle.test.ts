import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/queries', () => ({
  getListingsForSuburb: vi.fn(),
  getRentalsForSuburb: vi.fn(),
  getRowsNearby: vi.fn(),
  haversineKm: () => 0,
}));
vi.mock('@/lib/db/listings-inactive', () => ({
  getListingsForSuburbAll: vi.fn(),
  getRentalsForSuburbAll: vi.fn(),
}));
vi.mock('@/lib/db/price-history', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/price-history')>('@/lib/db/price-history');
  return { priceHistoryKey: actual.priceHistoryKey, getPriceHistoryFor: vi.fn(async () => new Map()) };
});

const NOW = new Date('2026-09-28T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

async function call(route: 'on-market-listings' | 'rental-listings', query: string) {
  const { GET } = await import(`../${route}/route`);
  const res = await GET(new NextRequest(new URL(`/api/${route}?${query}`, 'http://localhost:3000')));
  return { res, body: await res.json() };
}

const base = { raw_address: '1 Test St', suburb: 'Berwick', state: 'VIC', source: 'domain', created_at: daysAgo(40), last_seen_at: daysAgo(1) };
const activeRow = { ...base, active: true, lifecycle_status: 'active', listed_date: daysAgo(10), campaign_started_at: daysAgo(30) };
const closedRow = { ...base, raw_address: '2 Test St', active: false, lifecycle_status: 'withdrawn', listed_date: daysAgo(30), campaign_started_at: daysAgo(30), removed_at: daysAgo(12) };

// Key set an existing consumer saw before this unit landed (R1 compatibility).
const PRE_CHANGE_KEYS = ['rawAddress', 'suburb', 'postcode', 'displayPrice', 'priceLow', 'priceHigh', 'status', 'bedrooms', 'bathrooms', 'carSpaces', 'landAreaSqm', 'propertyType', 'latitude', 'longitude', 'agencyName', 'agentName', 'listingUrl', 'imageUrl', 'source', 'createdAt', 'lastSeenAt', 'listedDate'];

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  const q = await import('@/lib/db/queries');
  const all = await import('@/lib/db/listings-inactive');
  const ph = await import('@/lib/db/price-history');
  vi.mocked(ph.getPriceHistoryFor).mockResolvedValue(new Map());
  vi.mocked(q.getListingsForSuburb).mockResolvedValue([activeRow] as never);
  vi.mocked(all.getListingsForSuburbAll).mockResolvedValue([activeRow, closedRow] as never);
  vi.mocked(q.getRowsNearby).mockResolvedValue([{ ...activeRow, latitude: -38, longitude: 145 }, { ...closedRow, latitude: -38, longitude: 145 }] as never);
});

describe('GET /api/on-market-listings lifecycle', () => {
  it('default excludes active=false rows; includeInactive includes them with removedAt', async () => {
    const def = await call('on-market-listings', 'suburb=Berwick');
    expect(def.body.results.map((r: { rawAddress: string }) => r.rawAddress)).toEqual(['1 Test St']);

    const inc = await call('on-market-listings', 'suburb=Berwick&includeInactive=true');
    expect(inc.body.results).toHaveLength(2);
    const closed = inc.body.results.find((r: { rawAddress: string }) => r.rawAddress === '2 Test St');
    expect(closed.lifecycleStatus).toBe('withdrawn');
    expect(closed.removedAt).toBe(closedRow.removed_at);

    const geo = await call('on-market-listings', 'lat=-38&lng=145&includeInactive=1');
    expect(geo.body.results).toHaveLength(2);
    const geoDef = await call('on-market-listings', 'lat=-38&lng=145');
    expect(geoDef.body.results).toHaveLength(1);
  });

  it('active row listed 10 days ago → 10 / listed; null listed_date with campaign 25 days ago → 25 / first_seen', async () => {
    const q = await import('@/lib/db/queries');
    vi.mocked(q.getListingsForSuburb).mockResolvedValue([
      activeRow,
      { ...base, raw_address: '3 Test St', active: true, listed_date: null, campaign_started_at: daysAgo(25) },
    ] as never);
    const { body } = await call('on-market-listings', 'suburb=Berwick');
    expect(body.results[0]).toMatchObject({ daysOnMarket: 10, daysOnMarketBasis: 'listed' });
    expect(body.results[1]).toMatchObject({ daysOnMarket: 25, daysOnMarketBasis: 'first_seen' });
  });

  it('closed row uses removed_at minus basis', async () => {
    const { body } = await call('on-market-listings', 'suburb=Berwick&includeInactive=true');
    const closed = body.results.find((r: { rawAddress: string }) => r.rawAddress === '2 Test St');
    expect(closed.daysOnMarket).toBe(18);
  });

  it('pre-change key set is a strict subset of the new row with the same types', async () => {
    const { body } = await call('on-market-listings', 'suburb=Berwick');
    const row = body.results[0];
    for (const k of PRE_CHANGE_KEYS) expect(row).toHaveProperty(k);
    expect(Object.keys(row).length).toBeGreaterThan(PRE_CHANGE_KEYS.length);
    expect(typeof row.rawAddress).toBe('string');
    expect(typeof row.source).toBe('string');
    expect(row.saleMethod).toBeNull();
    expect(row.auctionDate).toBeNull();
    expect(row.priceHistory).toEqual([]);
  });

  it('attaches price history oldest first', async () => {
    const ph = await import('@/lib/db/price-history');
    vi.mocked(ph.getPriceHistoryFor).mockResolvedValue(new Map([[
      '1 Test St|domain',
      [
        { observedAt: daysAgo(10), displayPrice: '$800,000', priceLow: 800000, priceHigh: 800000 },
        { observedAt: daysAgo(2), displayPrice: '$780,000', priceLow: 780000, priceHigh: 780000 },
      ],
    ]]));
    const { body } = await call('on-market-listings', 'suburb=Berwick');
    expect(body.results[0].priceHistory).toHaveLength(2);
    expect(body.results[0].priceHistory[0].displayPrice).toBe('$800,000');
    expect(body.results[0].priceHistory[1].displayPrice).toBe('$780,000');
    expect(vi.mocked(ph.getPriceHistoryFor).mock.calls[0][0]).toBe('listings');
  });
});

describe('GET /api/rental-listings lifecycle', () => {
  it('rental uses leased_at; includeInactive returns closed rows', async () => {
    const q = await import('@/lib/db/queries');
    const all = await import('@/lib/db/listings-inactive');
    const leased = { ...base, raw_address: '9 Rent St', weekly_rent: 600, active: false, lifecycle_status: 'withdrawn', listed_date: daysAgo(30), leased_at: daysAgo(20) };
    vi.mocked(q.getRentalsForSuburb).mockResolvedValue([{ ...base, weekly_rent: 550, active: true, listed_date: daysAgo(10) }] as never);
    vi.mocked(all.getRentalsForSuburbAll).mockResolvedValue([{ ...base, weekly_rent: 550, active: true, listed_date: daysAgo(10) }, leased] as never);

    const def = await call('rental-listings', 'suburb=Berwick');
    expect(def.body.results).toHaveLength(1);
    expect(def.body.results[0]).toMatchObject({ weeklyRent: 550, daysOnMarket: 10, daysOnMarketBasis: 'listed', leasedAt: null, priceHistory: [] });

    const inc = await call('rental-listings', 'suburb=Berwick&includeInactive=true');
    const row = inc.body.results.find((r: { rawAddress: string }) => r.rawAddress === '9 Rent St');
    expect(row).toMatchObject({ leasedAt: leased.leased_at, daysOnMarket: 10, lifecycleStatus: 'withdrawn' });
  });
});
