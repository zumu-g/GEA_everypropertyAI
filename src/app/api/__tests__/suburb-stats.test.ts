import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('@/lib/db/stats-queries', () => ({
  fetchListingsForStats: vi.fn(async () => []),
  fetchRentalsForStats: vi.fn(async () => []),
  fetchPriceHistory: vi.fn(async () => []),
  fetchSalesForStats: vi.fn(async () => []),
  getFrozenMonthlyRows: vi.fn(async () => []),
  getStatsHistoryRow: vi.fn(async () => null),
  upsertStatsHistory: vi.fn(async () => undefined),
}));

const R15_FIELDS = [
  'activeListings', 'newListings', 'medianAsking', 'medianDaysOnMarket', 'priceCutCount', 'priceCutMedianPct',
  'withdrawnCount', 'salesCount', 'medianSalePrice', 'medianSalePriceHouse', 'monthsOfSupply', 'saleToListRatio',
  'auctionsHeld', 'auctionsCleared', 'auctionClearanceRate', 'privateSalesClosed', 'privateSalesSold',
  'privateSaleConversionRate', 'rentalListings', 'medianRent', 'sentimentIndex', 'sentimentBasis',
];

async function callRoute(query: string) {
  const { GET } = await import('../suburb-stats/route');
  const res = await GET(new NextRequest(new URL(`/api/suburb-stats?${query}`, 'http://localhost:3000')));
  return { res, body: await res.json() };
}

describe('GET /api/suburb-stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 for period=quarter, malformed asOf, and asOf before 2020', async () => {
    expect((await callRoute('suburb=Berwick&period=quarter')).res.status).toBe(400);
    expect((await callRoute('suburb=Berwick&asOf=15-08-2026')).res.status).toBe(400);
    expect((await callRoute('suburb=Berwick&asOf=2010-01-01')).res.status).toBe(400);
    expect((await callRoute('suburb=Berwick&asOf=2999-01-01')).res.status).toBe(400);
  });

  it('404 for a suburb outside the service area', async () => {
    expect((await callRoute('suburb=Toorak')).res.status).toBe(404);
  });

  it('response shape and block field names match R15 exactly', async () => {
    const { res, body } = await callRoute('suburb=Berwick&period=month&asOf=2026-08-15');
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      'computedAt', 'current', 'period', 'periodEnd', 'periodStart', 'prior', 'provisional', 'reconstructed',
      'schemaVersion', 'state', 'suburb', 'yearAgo',
    ]);
    expect(body).toMatchObject({ suburb: 'Berwick', state: 'VIC', period: 'month', periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    expect(Object.keys(body.current).sort()).toEqual([...R15_FIELDS].sort());
    expect(body.prior).toBeNull(); // no data
    expect(body.current.sentimentIndex).toBeNull();
    expect(body.current.sentimentBasis.reason).toBe('insufficient-history');
  });
});

describe('serve rule (AE3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inside the settle window: recompute + upsert provisional; once frozen: stored JSON returned untouched', async () => {
    const q = await import('@/lib/db/stats-queries');
    const { computeAndPersist } = await import('@/lib/stats/suburb-stats');

    // 20 October: August is < 60 days past its end → provisional, reconstructed (pre go-live).
    const first = await computeAndPersist('Berwick', 'VIC', 'month', '2026-08-01', '2026-08-31', new Date('2026-10-20T00:00:00Z'));
    expect(first.provisional).toBe(true);
    expect(first.reconstructed).toBe(true);
    expect(q.upsertStatsHistory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(q.upsertStatsHistory).mock.calls[0][0]).toMatchObject({ period_type: 'month', period_start: '2026-08-01', provisional: true, reconstructed: true });

    // 31 October: settle date passed → frozen row written.
    const second = await computeAndPersist('Berwick', 'VIC', 'month', '2026-08-01', '2026-08-31', new Date('2026-10-31T00:00:00Z'));
    expect(second.provisional).toBe(false);
    const stored = vi.mocked(q.upsertStatsHistory).mock.calls[1][0];

    // Later call: the frozen row is served byte-for-byte; no recompute, no upsert.
    vi.mocked(q.getStatsHistoryRow).mockResolvedValueOnce(stored);
    const third = await computeAndPersist('Berwick', 'VIC', 'month', '2026-08-01', '2026-08-31', new Date('2027-01-01T00:00:00Z'));
    expect(JSON.stringify(third.block)).toBe(JSON.stringify(stored.stats));
    expect(third.reconstructed).toBe(true);
    expect(q.fetchListingsForStats).toHaveBeenCalledTimes(2);
    expect(q.upsertStatsHistory).toHaveBeenCalledTimes(2);
  });

  it('open period is recomputed on every call and stored provisional', async () => {
    const q = await import('@/lib/db/stats-queries');
    const { computeAndPersist } = await import('@/lib/stats/suburb-stats');
    const now = new Date('2026-08-15T00:00:00Z');
    await computeAndPersist('Berwick', 'VIC', 'month', '2026-08-01', '2026-08-31', now);
    await computeAndPersist('Berwick', 'VIC', 'month', '2026-08-01', '2026-08-31', now);
    expect(q.fetchListingsForStats).toHaveBeenCalledTimes(2);
    expect(vi.mocked(q.upsertStatsHistory).mock.calls.every((c) => c[0].provisional)).toBe(true);
  });
});

describe('middleware matcher', () => {
  it('lists /api/suburb-stats so the API-key gate applies (cross-site no-key → 401)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../middleware.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/'\/api\/suburb-stats',/);
  });
});
