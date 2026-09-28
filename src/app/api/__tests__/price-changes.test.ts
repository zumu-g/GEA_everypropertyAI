import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Listing identities come from the stats fetchers; history rows come straight
// from Supabase, so mock a minimal chainable builder that filters on table_name.
const HISTORY: Array<Record<string, unknown>> = [];
vi.mock('@/lib/db/stats-queries', () => ({
  fetchListingsForStats: vi.fn(async () => []),
  fetchRentalsForStats: vi.fn(async () => []),
}));
vi.mock('@/lib/db/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseServerClient: () => ({
    from: () => {
      let table: unknown;
      const b = {
        select: () => b, in: () => b, order: () => b,
        eq: (k: string, v: unknown) => { if (k === 'table_name') table = v; return b; },
        then: (resolve: (r: unknown) => void) => resolve({ data: HISTORY.filter((h) => h.table_name === table), error: null }),
      };
      return b;
    },
  }),
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const hist = (table: string, raw: string, n: number, low: number | null, high: number | null, display = `$${low}`) =>
  ({ table_name: table, raw_address: raw, source: 'domain', observed_at: daysAgo(n), display_price: display, price_low: low, price_high: high });

async function callRoute(query: string) {
  const { GET } = await import('../price-changes/route');
  const res = await GET(new NextRequest(new URL(`/api/price-changes?${query}`, 'http://localhost:3000')));
  return { res, body: await res.json() };
}

async function seed(listings: Array<Record<string, unknown>>, rentals: Array<Record<string, unknown>> = []) {
  const q = await import('@/lib/db/stats-queries');
  vi.mocked(q.fetchListingsForStats).mockResolvedValue(listings as never);
  vi.mocked(q.fetchRentalsForStats).mockResolvedValue(rentals as never);
}
const listing = (raw: string) => ({ raw_address: raw, source: 'domain', listing_url: `https://d/${raw}`, suburb: 'Berwick' });

describe('GET /api/price-changes', () => {
  beforeEach(() => { vi.clearAllMocks(); HISTORY.length = 0; });

  it('400 without suburb, and for sinceDays outside 1..365', async () => {
    expect((await callRoute('')).res.status).toBe(400);
    expect((await callRoute('suburb=Berwick&sinceDays=0')).res.status).toBe(400);
    expect((await callRoute('suburb=Berwick&sinceDays=999')).res.status).toBe(400);
  });

  it('AE2: two observations 14 days apart → one result with changePct -4.0', async () => {
    await seed([listing('1 A St')]);
    HISTORY.push(hist('listings', '1 A St', 15, 740_000, 760_000, '$740,000 - $760,000'), hist('listings', '1 A St', 1, 710_000, 730_000, '$710,000 - $730,000'));
    const { res, body } = await callRoute('suburb=Berwick');
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.results[0]).toMatchObject({
      listingUrl: 'https://d/1 A St', address: '1 A St', suburb: 'Berwick', table: 'listings',
      previousDisplayPrice: '$740,000 - $760,000', currentDisplayPrice: '$710,000 - $730,000',
      previousMid: 750_000, currentMid: 720_000, changePct: -4.0,
    });
    expect(body.results[0].changedAt).toBe(HISTORY[1].observed_at);
    expect(body.results[0].priceHistory.map((h: { priceLow: number }) => h.priceLow)).toEqual([740_000, 710_000]);
  });

  it('single observation is excluded; change older than sinceDays is excluded even with a later unchanged observation', async () => {
    await seed([listing('1 A St'), listing('2 B St')]);
    HISTORY.push(hist('listings', '1 A St', 3, 700_000, 700_000));
    HISTORY.push(hist('listings', '2 B St', 60, 800_000, 800_000), hist('listings', '2 B St', 45, 760_000, 760_000), hist('listings', '2 B St', 2, 760_000, 760_000));
    const { body } = await callRoute('suburb=Berwick&sinceDays=30');
    expect(body.count).toBe(0);
  });

  it('rentals are included with table rentals', async () => {
    await seed([], [listing('9 R St')]);
    HISTORY.push(hist('rentals', '9 R St', 10, 500, 500, '$500 pw'), hist('rentals', '9 R St', 1, 550, 550, '$550 pw'));
    const { body } = await callRoute('suburb=Berwick');
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ table: 'rentals', previousMid: 500, currentMid: 550, changePct: 10 });
  });

  it('equal or null midpoints are not returned', async () => {
    await seed([listing('1 A St'), listing('2 B St')]);
    HISTORY.push(hist('listings', '1 A St', 10, 700_000, 700_000), hist('listings', '1 A St', 1, 700_000, 700_000));
    HISTORY.push(hist('listings', '2 B St', 10, null, null, 'Contact Agent'), hist('listings', '2 B St', 1, 700_000, 700_000));
    const { body } = await callRoute('suburb=Berwick');
    expect(body.count).toBe(0);
  });
});

describe('middleware matcher', () => {
  it('lists /api/price-changes so the API-key gate applies (cross-site no-key → 401)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../middleware.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/'\/api\/price-changes',/);
  });
});
