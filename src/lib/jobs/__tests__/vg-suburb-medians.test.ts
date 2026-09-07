import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSuburbMedianWorkbook, gateSuburbMedianBatch } from '../vg-suburb-medians';

function makeWorkbookBuffer(rows: (string | number | null)[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

const QUARTERLY_HEADER = ['Locality', 'Sep 2025', 'Dec 2025'];

describe('parseSuburbMedianWorkbook — quarterly, service-area filtering', () => {
  it('produces rows for Berwick and drops an out-of-area suburb', () => {
    const buf = makeWorkbookBuffer([
      ['Victorian Property Sales Report'], // title row above the header
      QUARTERLY_HEADER,
      ['Berwick', 870000, 920000],
      ['Warragul', 650000, 660000], // not in SERVICE_AREA_SUBURBS
    ]);
    const result = parseSuburbMedianWorkbook(buf, 'house', 'quarter', 'https://example.test/file.xlsx');
    expect(result).not.toBeNull();
    const berwickRows = result!.rows.filter((r) => r.suburb === 'Berwick');
    expect(berwickRows).toHaveLength(2);
    expect(berwickRows.find((r) => r.period_start === '2025-10-01')?.median).toBe(920000);
    expect(result!.rows.some((r) => r.suburb === 'Warragul')).toBe(false);
  });

  it('a blank/suppressed cell parses to a null median, not zero', () => {
    const buf = makeWorkbookBuffer([
      QUARTERLY_HEADER,
      ['Berwick', 'n/a', 920000],
    ]);
    const result = parseSuburbMedianWorkbook(buf, 'unit', 'quarter', 'https://example.test/file.xlsx');
    const sep = result!.rows.find((r) => r.period_start === '2025-07-01');
    expect(sep?.median).toBeNull();
  });

  it('parses a yearly time-series header into 1 January of that year', () => {
    const buf = makeWorkbookBuffer([
      ['Locality', '2014', '2024'],
      ['Berwick', 550000, 870000],
    ]);
    const result = parseSuburbMedianWorkbook(buf, 'house', 'year', 'https://example.test/years.xlsx');
    const y2014 = result!.rows.find((r) => r.period_start === '2014-01-01');
    expect(y2014?.median).toBe(550000);
  });

  it('returns null when no locality/suburb column can be found', () => {
    const buf = makeWorkbookBuffer([
      ['Foo', 'Bar'],
      ['x', 'y'],
    ]);
    const result = parseSuburbMedianWorkbook(buf, 'house', 'quarter', 'https://example.test/bad.xlsx');
    expect(result).toBeNull();
  });
});

describe('gateSuburbMedianBatch', () => {
  it('aborts when service-area hits fall well below the previous run', () => {
    const gate = gateSuburbMedianBatch({ rows: [], serviceAreaHits: 10 }, 78);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/fell below/);
  });

  it('aborts when a median is outside the plausible band', () => {
    const gate = gateSuburbMedianBatch(
      {
        rows: [{ suburb: 'Berwick', property_type: 'house', period_type: 'quarter', period_start: '2025-10-01', median: 12, sales_count: null, source_url: 'x', fetched_at: 'x' }],
        serviceAreaHits: 78,
      },
      78,
    );
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/implausible/);
  });

  it('passes with plausible hits and medians', () => {
    const gate = gateSuburbMedianBatch(
      {
        rows: [{ suburb: 'Berwick', property_type: 'house', period_type: 'quarter', period_start: '2025-10-01', median: 920000, sales_count: null, source_url: 'x', fetched_at: 'x' }],
        serviceAreaHits: 78,
      },
      78,
    );
    expect(gate.ok).toBe(true);
  });
});
