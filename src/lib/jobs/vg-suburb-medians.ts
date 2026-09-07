/**
 * Valuer-General Victoria suburb median ingest.
 *
 * Parses the DataVic "Victorian Property Sales Report" quarterly XLS
 * (Median House by Suburb / Median Unit by Suburb, one file per property
 * type) and the yearly XLSX time series, and upserts one row per
 * (suburb, property type, period type, period start) into `suburb_medians`.
 *
 * Column mapping (recorded from the live December 2025 quarter file and the
 * 2014-2024 time series, both downloaded from discover.data.vic.gov.au):
 *   Quarterly file:  Locality | <one column per quarter, header = quarter
 *                    label e.g. "Dec 2025", values = median price>
 *   Yearly file:     Locality | <one column per year, header = "2014" etc.>
 * Both files are "wide" (one row per suburb, one column per period), not the
 * long/tidy shape the legacy `parseVicMedianLine` CSV parser assumed — hence
 * a dedicated XLS-aware parser rather than reusing that line parser.
 *
 * See docs/plans/2026-09-07-1735-feat-casey-cardinia-values-guide-plan.md (U1).
 */

import * as XLSX from 'xlsx';
import { getSupabaseServerClient, isSupabaseConfigured } from '@/lib/db/supabase';
import { normaliseSuburbAlias } from '@/lib/utils/address';
import { isServiceAreaSuburb, SERVICE_AREA_SUBURBS } from '@/lib/utils/service-area';

export type PropertyType = 'house' | 'unit';
export type PeriodType = 'quarter' | 'year';

export interface SuburbMedianRow {
  suburb: string;
  property_type: PropertyType;
  period_type: PeriodType;
  period_start: string; // ISO date, first day of the period
  median: number | null; // null = Valuer-General suppressed this suburb/period
  sales_count: number | null;
  source_url: string;
  fetched_at: string;
}

// Below this fraction of the previous run's service-area suburb hits, abort
// the whole batch rather than writing a partial or corrupted file's rows.
const MIN_COVERAGE_RATIO = 0.7;
// A median outside this band (relative to the Casey/Cardinia range) signals a
// parse gone wrong (wrong column picked up, units off by 1000, etc.).
const PLAUSIBLE_MEDIAN_MIN = 50_000;
const PLAUSIBLE_MEDIAN_MAX = 10_000_000;

/** Month-name quarter-end label ("Dec 2025", "Sep 25", "December 2025") -> ISO first-of-quarter date. */
function parseQuarterLabel(label: string): string | null {
  const m = label.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{2,4})$/);
  if (!m) return null;
  const monthNames: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const monthKey = m[1].toLowerCase().slice(0, 3);
  const month = monthNames[monthKey];
  if (month === undefined) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  // The VG quarterly report labels a quarter by its END month (Mar/Jun/Sep/Dec).
  // The period_start we store is the quarter's first day.
  const quarterStartMonth = month - 2;
  const d = new Date(Date.UTC(year, quarterStartMonth, 1));
  return d.toISOString().slice(0, 10);
}

/** Bare year label ("2014") -> ISO 1 Jan of that year. */
function parseYearLabel(label: string): string | null {
  const m = label.trim().match(/^(\d{4})$/);
  if (!m) return null;
  return `${m[1]}-01-01`;
}

/** Parse a numeric median cell, tolerating "$1,234,000", "n/a", "-", blank. */
function parseMedianCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/[$,]/g, '').trim();
  if (!s || /^(n\/?a|-|\.\.)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface ParsedFileResult {
  rows: SuburbMedianRow[];
  serviceAreaHits: number;
}

/**
 * Parse one "wide" VG suburb-median workbook (quarterly or yearly) for one
 * property type. Returns null if the sheet's shape cannot be recognised at
 * all (no header row, no locality column) -- distinct from a suburb simply
 * not matching the service area, which is filtered, not an abort signal.
 */
export function parseSuburbMedianWorkbook(
  buffer: ArrayBuffer,
  propertyType: PropertyType,
  periodType: PeriodType,
  sourceUrl: string,
): ParsedFileResult | null {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return null;

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (rows.length < 2) return null;

  // Find the header row: the first row containing a cell that looks like a
  // locality/suburb column label. VG reports carry a title/notes block above
  // the real header, so scan rather than assume row 0.
  let headerRowIdx = -1;
  let localityColIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    const idx = row.findIndex(
      (c) => typeof c === 'string' && /locality|suburb/i.test(c.trim()),
    );
    if (idx >= 0) {
      headerRowIdx = i;
      localityColIdx = idx;
      break;
    }
  }
  if (headerRowIdx < 0) return null;

  const header = rows[headerRowIdx];
  const periodCols: { colIdx: number; periodStart: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (c === localityColIdx) continue;
    const label = header[c];
    if (typeof label !== 'string' || !label.trim()) continue;
    const periodStart =
      periodType === 'quarter' ? parseQuarterLabel(label) : parseYearLabel(label);
    if (periodStart) periodCols.push({ colIdx: c, periodStart });
  }
  if (periodCols.length === 0) return null;

  const fetchedAt = new Date().toISOString();
  const out: SuburbMedianRow[] = [];
  let serviceAreaHits = 0;

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const rawSuburb = row[localityColIdx];
    if (typeof rawSuburb !== 'string' || !rawSuburb.trim()) continue;

    const suburb = normaliseSuburbAlias(rawSuburb);
    if (!isServiceAreaSuburb(suburb)) continue;
    serviceAreaHits++;

    for (const { colIdx, periodStart } of periodCols) {
      out.push({
        suburb,
        property_type: propertyType,
        period_type: periodType,
        period_start: periodStart,
        median: parseMedianCell(row[colIdx]),
        sales_count: null, // VG suburb-median reports do not publish a per-cell sales count
        source_url: sourceUrl,
        fetched_at: fetchedAt,
      });
    }
  }

  return { rows: out, serviceAreaHits };
}

export interface BatchGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pre-write gate: abort the whole batch (log, write nothing) if the parse
 * looks structurally wrong. Runs once over the whole parsed set, before any
 * database write -- never per-row skipping, which would silently write a
 * partial/corrupt result.
 */
export function gateSuburbMedianBatch(
  result: ParsedFileResult,
  previousServiceAreaHits: number | null,
): BatchGateResult {
  const minExpected =
    previousServiceAreaHits !== null
      ? previousServiceAreaHits * MIN_COVERAGE_RATIO
      : SERVICE_AREA_SUBURBS.length * MIN_COVERAGE_RATIO;
  if (result.serviceAreaHits < minExpected) {
    return {
      ok: false,
      reason: `service-area suburb hits (${result.serviceAreaHits}) fell below ${Math.round(minExpected)} (${Math.round(MIN_COVERAGE_RATIO * 100)}% of expected) -- aborting, table left untouched`,
    };
  }
  const implausible = result.rows.filter(
    (row) => row.median !== null && (row.median < PLAUSIBLE_MEDIAN_MIN || row.median > PLAUSIBLE_MEDIAN_MAX),
  );
  if (implausible.length > 0) {
    return {
      ok: false,
      reason: `${implausible.length} row(s) have an implausible median (outside $${PLAUSIBLE_MEDIAN_MIN.toLocaleString()}-$${PLAUSIBLE_MEDIAN_MAX.toLocaleString()}) -- aborting, table left untouched`,
    };
  }
  return { ok: true };
}

/**
 * Upsert a gated batch into `suburb_medians`. Merge (not ignoreDuplicates) on
 * the natural key, because the Valuer-General revises published figures on
 * later releases and a stale first value must not be frozen forever.
 */
export async function upsertSuburbMedians(rows: SuburbMedianRow[]): Promise<{ written: number; failedChunks: number }> {
  if (!isSupabaseConfigured() || rows.length === 0) return { written: 0, failedChunks: 0 };
  const client = getSupabaseServerClient();
  const CHUNK = 500;
  let failedChunks = 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await client
      .from('suburb_medians')
      .upsert(chunk, { onConflict: 'suburb,property_type,period_type,period_start' });
    if (error) {
      console.error('[upsertSuburbMedians] chunk error:', error.message);
      failedChunks++;
    } else {
      written += chunk.length;
    }
  }
  return { written, failedChunks };
}

/**
 * Fetch one DataVic dataset page and follow its newest download link, the
 * same discovery pattern as the existing VIC branch in ingest-vg-data.ts.
 */
export async function fetchDatasetDownloadUrl(datasetPageUrl: string): Promise<string | null> {
  const resp = await fetch(datasetPageUrl, {
    headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  const linkMatch = html.match(/href=["']([^"']*\.(?:xlsx?|XLSX?)[^"']*)["']/i);
  if (!linkMatch) return null;
  const href = linkMatch[1];
  return href.startsWith('http') ? href : `https://discover.data.vic.gov.au${href}`;
}

export interface IngestSuburbMediansResult {
  ok: boolean;
  written: number;
  reason?: string;
  sourcesTried: number;
}

const DATASET_PAGES: { url: string; propertyType: PropertyType; periodType: PeriodType }[] = [
  { url: 'https://discover.data.vic.gov.au/dataset/victorian-property-sales-report-median-house-by-suburb', propertyType: 'house', periodType: 'quarter' },
  { url: 'https://discover.data.vic.gov.au/dataset/victorian-property-sales-report-median-unit-by-suburb', propertyType: 'unit', periodType: 'quarter' },
  { url: 'https://discover.data.vic.gov.au/dataset/victorian-property-sales-report-median-house-by-suburb-time-series', propertyType: 'house', periodType: 'year' },
];

/**
 * Run the full ingest: fetch each dataset page, download its newest file,
 * parse, gate as one combined batch (so a bad house-quarterly file aborts
 * the whole run rather than leaving units/years written but houses stale),
 * then upsert.
 */
export async function ingestSuburbMedians(
  previousServiceAreaHits: number | null = null,
): Promise<IngestSuburbMediansResult> {
  const allRows: SuburbMedianRow[] = [];
  let combinedHits = 0;
  let sourcesTried = 0;

  for (const { url, propertyType, periodType } of DATASET_PAGES) {
    sourcesTried++;
    const downloadUrl = await fetchDatasetDownloadUrl(url);
    if (!downloadUrl) {
      console.warn(`[vg-suburb-medians] no download link found for ${url}`);
      continue;
    }
    const fileResp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!fileResp.ok) {
      console.warn(`[vg-suburb-medians] download failed (${fileResp.status}) for ${downloadUrl}`);
      continue;
    }
    const buffer = await fileResp.arrayBuffer();
    const parsed = parseSuburbMedianWorkbook(buffer, propertyType, periodType, downloadUrl);
    if (!parsed) {
      console.warn(`[vg-suburb-medians] could not parse workbook shape from ${downloadUrl}`);
      continue;
    }
    allRows.push(...parsed.rows);
    combinedHits += parsed.serviceAreaHits;
  }

  if (allRows.length === 0) {
    return { ok: false, written: 0, reason: 'no rows parsed from any source', sourcesTried };
  }

  const gate = gateSuburbMedianBatch({ rows: allRows, serviceAreaHits: combinedHits }, previousServiceAreaHits);
  if (!gate.ok) {
    console.warn(`[vg-suburb-medians] batch gate failed: ${gate.reason}`);
    return { ok: false, written: 0, reason: gate.reason, sourcesTried };
  }

  const { written, failedChunks } = await upsertSuburbMedians(allRows);
  if (failedChunks > 0) {
    return { ok: false, written, reason: `${failedChunks} chunk(s) failed to write`, sourcesTried };
  }
  console.log(`[vg-suburb-medians] ingest complete: ${written} rows written`);
  return { ok: true, written, sourcesTried };
}
