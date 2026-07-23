import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/queries', () => ({
  getRentalsForSuburb: vi.fn(),
}));

async function callRoute(query: string) {
  const { GET } = await import('../rental-market-segments/route');
  const res = await GET(
    new NextRequest(new URL(`/api/rental-market-segments?${query}`, 'http://localhost:3000')),
  );
  return { res, body: await res.json() };
}

function houseRental(bedrooms: number, weeklyRent: number, listedDate = '2026-06-01') {
  return { raw_address: `${bedrooms} Test St`, suburb: 'Berwick', state: 'VIC', property_type: 'house', bedrooms, weekly_rent: weeklyRent, listed_date: listedDate, source: 'epai' };
}
function unitRental(bedrooms: number, weeklyRent: number, listedDate = '2026-06-01') {
  return { raw_address: `${bedrooms} Test Unit`, suburb: 'Berwick', state: 'VIC', property_type: 'unit', bedrooms, weekly_rent: weeklyRent, listed_date: listedDate, source: 'epai' };
}

describe('GET /api/rental-market-segments', () => {
  it('returns 4 segments with correct low/avg/median per bucket for a house-subject suburb', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([
      houseRental(3, 590), houseRental(3, 630), houseRental(3, 640),
      houseRental(4, 650), houseRental(4, 700), houseRental(4, 720),
      houseRental(5, 800), houseRental(6, 850), houseRental(5, 820),
      unitRental(2, 450), unitRental(2, 470), unitRental(1, 400),
    ] as never);

    const { res, body } = await callRoute('suburb=Berwick');
    expect(res.status).toBe(200);
    expect(body.segments).toHaveLength(4);

    const threeBed = body.segments.find((s: { name: string }) => s.name === '3 bedroom homes');
    expect(threeBed.low).toBe(590);
    expect(threeBed.median).toBe(630);
    expect(threeBed.sufficientData).toBe(true);

    const units = body.segments.find((s: { name: string }) => s.name === 'Units / townhouses');
    expect(units.sufficientData).toBe(true);
  });

  it('returns the shifted unit segment set when propertyType=unit', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([
      unitRental(1, 350), unitRental(1, 360), unitRental(1, 355),
      unitRental(2, 450), unitRental(2, 470), unitRental(2, 460),
      houseRental(3, 590), houseRental(3, 630), houseRental(3, 640),
      houseRental(4, 650), houseRental(4, 700), houseRental(4, 720),
    ] as never);

    const { body } = await callRoute('suburb=Berwick&propertyType=unit');
    expect(body.segments.map((s: { name: string }) => s.name)).toEqual([
      '1 bedroom unit', '2 bedroom unit', '3 bedroom house', '4 bedroom house',
    ]);
    expect(body.segments.every((s: { sufficientData: boolean }) => s.sufficientData)).toBe(true);
  });

  it('excludes implausible weekly_rent values from aggregation', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([
      houseRental(3, 590), houseRental(3, 630), houseRental(3, 640),
      houseRental(3, 1), houseRental(3, 99_999), // dropped: implausible
    ] as never);

    const { body } = await callRoute('suburb=Berwick');
    const threeBed = body.segments.find((s: { name: string }) => s.name === '3 bedroom homes');
    expect(threeBed.sufficientData).toBe(true);
    expect(threeBed.low).toBe(590);
    expect(threeBed.median).toBe(630);
  });

  it('flags a bucket with fewer than 3 matching rentals as insufficient, not omitted', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([
      houseRental(3, 590), houseRental(3, 630), houseRental(3, 640),
      houseRental(4, 650), // only 1 rental
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

  it('returns exactly 4 segments, all insufficient, when the suburb has no rentals at all', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([] as never);

    const { res, body } = await callRoute('suburb=Nowhereville');
    expect(res.status).toBe(200);
    expect(body.segments).toHaveLength(4);
    expect(body.segments.every((s: { sufficientData: boolean }) => !s.sufficientData)).toBe(true);
  });

  it('honors the sinceDays window, passed through to getRentalsForSuburb as a filter', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    const mockFn = vi.mocked(getRentalsForSuburb);
    mockFn.mockResolvedValue([] as never);

    await callRoute('suburb=Berwick&sinceDays=30');
    expect(mockFn).toHaveBeenCalledWith('Berwick', 'VIC', 1000, { sinceDays: 30 });
  });

  it('defaults sinceDays to 180 (not market-segments\' 730) when omitted', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    const mockFn = vi.mocked(getRentalsForSuburb);
    mockFn.mockResolvedValue([] as never);

    await callRoute('suburb=Berwick');
    expect(mockFn).toHaveBeenCalledWith('Berwick', 'VIC', 1000, { sinceDays: 180 });
  });

  it('clamps a non-positive or implausibly large sinceDays to a sane range instead of passing it through raw', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    const mockFn = vi.mocked(getRentalsForSuburb);
    mockFn.mockResolvedValue([] as never);

    await callRoute('suburb=Berwick&sinceDays=-5');
    expect(mockFn).toHaveBeenCalledWith('Berwick', 'VIC', 1000, { sinceDays: 1 });

    await callRoute('suburb=Berwick&sinceDays=999999');
    expect(mockFn).toHaveBeenCalledWith('Berwick', 'VIC', 1000, { sinceDays: 3650 });
  });

  it('dataDate reflects the most recent listed_date among rows used in aggregation', async () => {
    const { getRentalsForSuburb } = await import('@/lib/db/queries');
    vi.mocked(getRentalsForSuburb).mockResolvedValue([
      houseRental(3, 590, '2026-01-01'),
      houseRental(3, 630, '2026-06-15'),
      houseRental(3, 640, '2026-03-01'),
    ] as never);

    const { body } = await callRoute('suburb=Berwick');
    expect(body.dataDate).toBe('2026-06-15');
  });
});
