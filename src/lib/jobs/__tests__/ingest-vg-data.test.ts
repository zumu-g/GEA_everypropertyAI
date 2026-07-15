import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  insertPropertySales: vi.fn(async () => undefined),
}));

import { insertPropertySales } from '@/lib/db/queries';
import {
  parseVicSalesCsvRow,
  splitCsvLine,
  ingestVicSalesCsvUrl,
  ingestVicIndividualSales,
  backfillVicIndividualSalesHistory,
  runValuerGeneralIngestion,
} from '../ingest-vg-data';

function mockResponse(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

// Casey/Cardinia postcode used by CASEY_CARDINIA_POSTCODES; 3999 is out of area.
const CASEY_ROW = 'suburb,postcode,house_number,street_name,sale_price,sale_date,property_type,land_area\nBerwick,3806,10,Loders Way,1200000,2026-06-01,House,650';
const MIXED_ROWS =
  'suburb,postcode,house_number,street_name,sale_price,sale_date,property_type,land_area\n' +
  'Berwick,3806,10,Loders Way,1200000,2026-06-01,House,650\n' +
  'OutOfArea,3999,5,Nowhere St,500000,2026-06-01,House,500\n';

describe('parseVicSalesCsvRow', () => {
  const headers = ['suburb', 'postcode', 'house_number', 'street_name', 'sale_price', 'sale_date', 'property_type', 'land_area'];

  it('parses a well-formed row (happy path)', () => {
    const row = parseVicSalesCsvRow(['Berwick', '3806', '10', 'Loders Way', '1200000', '2026-06-01', 'House', '650'], headers);
    expect(row).toMatchObject({
      raw_address: '10 Loders Way Berwick VIC 3806',
      suburb: 'Berwick',
      postcode: '3806',
      sale_price: 1_200_000,
      sale_date: '2026-06-01',
      property_type: 'House',
      land_area_sqm: 650,
      source: 'vic-vg',
    });
  });

  it('has no address_slug when house number/street/suburb are not all present (edge case)', () => {
    const row = parseVicSalesCsvRow(['', '', '', '', '1200000', '2026-06-01', 'House', '650'], headers);
    expect(row?.address_slug).toBeUndefined();
  });

  it('treats a zero sale price as missing, not zero-as-data', () => {
    const row = parseVicSalesCsvRow(['Berwick', '3806', '10', 'Loders Way', '0', '2026-06-01', 'House', '650'], headers);
    expect(row?.sale_price).toBeUndefined();
  });
});

describe('splitCsvLine', () => {
  it('splits a plain comma-separated line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('respects double-quoted fields containing commas', () => {
    expect(splitCsvLine('a,"b, still b",c')).toEqual(['a', 'b, still b', 'c']);
  });
});

describe('ingestVicSalesCsvUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses, filters to Casey/Cardinia, and inserts (happy path + integration)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, MIXED_ROWS)));
    const result = await ingestVicSalesCsvUrl('https://example.com/sales.csv');
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(insertPropertySales).toHaveBeenCalledWith([
      expect.objectContaining({ suburb: 'Berwick', postcode: '3806' }),
    ]);
  });

  it('returns an error result on a non-200 fetch (error path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(404, '')));
    const result = await ingestVicSalesCsvUrl('https://example.com/missing.csv');
    expect(result.error).toMatch(/404/);
    expect(insertPropertySales).not.toHaveBeenCalled();
  });

  it('returns an error result on a fetch rejection (error path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await ingestVicSalesCsvUrl('https://example.com/sales.csv');
    expect(result.error).toMatch(/network down/);
  });

  it('returns an error result on an empty CSV (edge case)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, 'just one line')));
    const result = await ingestVicSalesCsvUrl('https://example.com/empty.csv');
    expect(result.error).toMatch(/empty/i);
  });
});

describe('ingestVicIndividualSales', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('discovers the first download link and ingests it (happy path)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, '<a href="/files/q2-2026-sales.csv">Q2 2026</a><a href="/files/q1-2026-sales.csv">Q1 2026</a>'))
      .mockResolvedValueOnce(mockResponse(200, CASEY_ROW));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await ingestVicIndividualSales();
    expect(result.errors).toBe(0);
    expect(result.inserted).toBe(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, 'https://www.land.vic.gov.au/files/q2-2026-sales.csv', expect.anything());
  });

  it('returns an error result when no download link is found (edge case)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, '<p>no links here</p>')));
    const result = await ingestVicIndividualSales();
    expect(result.errors).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('returns an error result when the statistics page fetch fails (error path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(500, '')));
    const result = await ingestVicIndividualSales();
    expect(result.errors).toBe(1);
  });
});

describe('backfillVicIndividualSalesHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enumerates and ingests every discoverable historical link (happy path)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, '<a href="/files/2026-q2.csv">a</a><a href="/files/2026-q1.csv">b</a>'))
      .mockResolvedValueOnce(mockResponse(200, CASEY_ROW))
      .mockResolvedValueOnce(mockResponse(200, CASEY_ROW));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await backfillVicIndividualSalesHistory();
    expect(result.filesFound).toBe(2);
    expect(result.totalInserted).toBe(2);
    expect(result.perFile).toHaveLength(2);
  });

  it('isolates a failing file so the rest of the batch still ingests (integration)', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, '<a href="/files/broken.csv">a</a><a href="/files/good.csv">b</a>'))
      .mockResolvedValueOnce(mockResponse(404, ''))
      .mockResolvedValueOnce(mockResponse(200, CASEY_ROW));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await backfillVicIndividualSalesHistory();
    expect(result.filesFound).toBe(2);
    expect(result.totalInserted).toBe(1);
    expect(result.perFile[0].error).toMatch(/404/);
    expect(result.perFile[1].inserted).toBe(1);
  });

  it('reports zero files found (not silently empty) when no archive exists (edge case)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, '<p>current quarter only, no archive</p>')));
    const result = await backfillVicIndividualSalesHistory();
    expect(result.filesFound).toBe(0);
    expect(result.totalInserted).toBe(0);
    expect(result.perFile).toEqual([]);
  });
});

describe('runValuerGeneralIngestion (VIC cron wiring)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires both the suburb-medians task and the individual-sales task when vic is enabled (integration)', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('property-sales-statistics')) {
        // Individual-sales statistics page -> current-quarter link -> CSV
        if (url.endsWith('.csv')) return mockResponse(200, CASEY_ROW);
        return mockResponse(200, '<a href="https://example.com/q2.csv">Q2</a>');
      }
      if (url.includes('discover.data.vic.gov.au')) {
        // Suburb-medians dataset page -> link -> file
        if (url.endsWith('.csv')) return mockResponse(200, 'suburb,median\nBerwick,900000');
        return mockResponse(200, '<a href="https://example.com/medians.csv">Medians</a>');
      }
      return mockResponse(200, '');
    });
    vi.stubGlobal('fetch', fetchSpy);

    await runValuerGeneralIngestion({ nsw: false, vic: true, wa: false });

    const calledUrls = fetchSpy.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes('property-sales-statistics'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('discover.data.vic.gov.au'))).toBe(true);
  });

  it('skips both VIC tasks when vic is disabled (edge case)', async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, ''));
    vi.stubGlobal('fetch', fetchSpy);

    await runValuerGeneralIngestion({ nsw: false, vic: false, wa: false });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
