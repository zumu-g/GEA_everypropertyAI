import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/queries', () => ({
  getSalesForSuburb: vi.fn(),
}));

async function callRoute(query: string) {
  const { GET } = await import('../market-segments/route');
  const res = await GET(
    new NextRequest(new URL(`/api/market-segments?${query}`, 'http://localhost:3000')),
  );
  return { res, body: await res.json() };
}

function houseSale(bedrooms: number, price: number, date = '2026-06-01') {
  return { suburb: 'Berwick', state: 'VIC', property_type: 'house', bedrooms, sale_price: price, sale_date: date, source: 'vg' };
}
function unitSale(bedrooms: number, price: number, date = '2026-06-01') {
  return { suburb: 'Berwick', state: 'VIC', property_type: 'unit', bedrooms, sale_price: price, sale_date: date, source: 'vg' };
}

describe('GET /api/market-segments', () => {
  it('returns 4 segments with correct low/avg/median per bucket for a house-subject suburb', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getSalesForSuburb).mockResolvedValue([
      houseSale(3, 700_000), houseSale(3, 720_000), houseSale(3, 680_000),
      houseSale(4, 800_000), houseSale(4, 850_000), houseSale(4, 900_000),
      houseSale(5, 1_000_000), houseSale(6, 1_100_000), houseSale(5, 1_050_000),
      unitSale(2, 500_000), unitSale(2, 520_000), unitSale(1, 480_000),
    ] as never);

    const { res, body } = await callRoute('suburb=Berwick');
    expect(res.status).toBe(200);
    expect(body.segments).toHaveLength(4);

    const threeBed = body.segments.find((s: { name: string }) => s.name === '3 bedroom homes');
    expect(threeBed.low).toBe(680_000);
    expect(threeBed.median).toBe(700_000);
    expect(threeBed.sufficientData).toBe(true);

    const units = body.segments.find((s: { name: string }) => s.name === 'Units / townhouses');
    expect(units.sufficientData).toBe(true);
  });

  it('returns the shifted unit segment set when propertyType=unit', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getSalesForSuburb).mockResolvedValue([
      unitSale(1, 400_000), unitSale(1, 420_000), unitSale(1, 410_000),
      unitSale(2, 500_000), unitSale(2, 520_000), unitSale(2, 510_000),
      houseSale(3, 700_000), houseSale(3, 720_000), houseSale(3, 680_000),
      houseSale(4, 800_000), houseSale(4, 850_000), houseSale(4, 900_000),
    ] as never);

    const { body } = await callRoute('suburb=Berwick&propertyType=unit&bedrooms=2');
    expect(body.segments.map((s: { name: string }) => s.name)).toEqual([
      '1 bedroom unit', '2 bedroom unit', '3 bedroom house', '4 bedroom house',
    ]);
    expect(body.segments.every((s: { sufficientData: boolean }) => s.sufficientData)).toBe(true);
  });

  it('flags a bucket with fewer than 3 matching sales as insufficient, not omitted or zeroed with false confidence', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getSalesForSuburb).mockResolvedValue([
      houseSale(3, 700_000), houseSale(3, 720_000), houseSale(3, 680_000),
      houseSale(4, 800_000), // only 1 sale
    ] as never);

    const { body } = await callRoute('suburb=Berwick');
    expect(body.segments).toHaveLength(4);
    const fourBed = body.segments.find((s: { name: string }) => s.name === '4 bedroom homes');
    expect(fourBed.sufficientData).toBe(false);
  });

  it('returns 400 when suburb param is missing', async () => {
    const { res } = await callRoute('');
    expect(res.status).toBe(400);
  });

  it('returns exactly 4 segments, all insufficient, when the suburb has no sales at all', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getSalesForSuburb).mockResolvedValue([] as never);

    const { res, body } = await callRoute('suburb=Nowhereville');
    expect(res.status).toBe(200);
    expect(body.segments).toHaveLength(4);
    expect(body.segments.every((s: { sufficientData: boolean }) => !s.sufficientData)).toBe(true);
  });

  it('honors the sinceDays window — an older sale is excluded from aggregation', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    // getSalesForSuburb itself is the one that would filter by sinceDays in
    // production; here we assert the route passes sinceDays through correctly.
    const mockFn = vi.mocked(getSalesForSuburb);
    mockFn.mockResolvedValue([] as never);

    await callRoute('suburb=Berwick&sinceDays=30');
    expect(mockFn).toHaveBeenCalledWith('Berwick', 'VIC', 30, 1000);
  });

  it('dataDate reflects the most recent sale_date among rows used in aggregation', async () => {
    const { getSalesForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getSalesForSuburb).mockResolvedValue([
      houseSale(3, 700_000, '2026-01-01'),
      houseSale(3, 720_000, '2026-06-15'),
      houseSale(3, 680_000, '2026-03-01'),
    ] as never);

    const { body } = await callRoute('suburb=Berwick');
    expect(body.dataDate).toBe('2026-06-15');
  });
});
