/**
 * Valuer General data ingestion.
 *
 * Downloads and processes bulk property sale records from:
 * - NSW Valuer General (DAT/pipe-delimited files per LGA)
 * - VIC Land Channel (quarterly suburb median Excel reports)
 * - WA Landgate (sales evidence DAT files)
 *
 * Uses native fetch — no Firecrawl needed for bulk data downloads.
 */

import { insertPropertySales, type PropertySaleRecord } from '@/lib/db/queries';

// ─── NSW Valuer General ───────────────────────────────────────────────────────

const NSW_LGAS = [
  { code: 'sydney', name: 'Sydney' },
  { code: 'north_sydney', name: 'North Sydney' },
  { code: 'parramatta', name: 'Parramatta' },
  { code: 'blacktown', name: 'Blacktown' },
  { code: 'liverpool', name: 'Liverpool' },
  { code: 'penrith', name: 'Penrith' },
  { code: 'wollongong', name: 'Wollongong' },
  { code: 'newcastle', name: 'Newcastle' },
  { code: 'lake_macquarie', name: 'Lake Macquarie' },
  { code: 'central_coast', name: 'Central Coast' },
];

const NSW_BASE_URL = 'https://www.valuergeneral.nsw.gov.au/land_value_summaries/psi.php';

/**
 * Parse a single NSW VG line (fixed-width or pipe-delimited).
 * Returns null if the line cannot be parsed.
 */
function parseNswVgLine(line: string): PropertySaleRecord | null {
  if (!line.trim() || line.startsWith('#') || line.startsWith('//')) return null;

  // Attempt pipe-delimited first
  const parts = line.split('|');
  if (parts.length >= 6) {
    const [rawAddress, landAreaStr, zoneCode, salePriceStr, saleDate, propertyType, lot, plan] = parts.map((p) => p.trim());

    const salePrice = parseFloat(salePriceStr.replace(/[^0-9.]/g, ''));
    const landArea = parseFloat(landAreaStr.replace(/[^0-9.]/g, ''));

    if (!rawAddress) return null;

    return {
      raw_address: rawAddress,
      state: 'NSW',
      land_area_sqm: !isNaN(landArea) ? landArea : undefined,
      property_type: propertyType || undefined,
      sale_price: !isNaN(salePrice) && salePrice > 0 ? salePrice : undefined,
      sale_date: saleDate || undefined,
      lot_number: lot || undefined,
      plan_number: plan || undefined,
      source: 'nsw-vg',
      raw_data: {
        zone_code: zoneCode,
        raw_line: line,
      },
    };
  }

  // Attempt fixed-width (fallback)
  // NSW fixed-width layout (approximate): address cols 0-39, price cols 40-55, date cols 56-65
  if (line.length >= 40) {
    const rawAddress = line.substring(0, 40).trim();
    const salePriceStr = line.substring(40, 56).trim();
    const saleDate = line.substring(56, 66).trim();

    if (!rawAddress) return null;

    const salePrice = parseFloat(salePriceStr.replace(/[^0-9.]/g, ''));

    return {
      raw_address: rawAddress,
      state: 'NSW',
      sale_price: !isNaN(salePrice) && salePrice > 0 ? salePrice : undefined,
      sale_date: saleDate || undefined,
      source: 'nsw-vg',
      raw_data: { raw_line: line },
    };
  }

  return null;
}

/**
 * Fetch and parse sales data for a single NSW LGA.
 */
async function fetchNswLga(lgaCode: string, lgaName: string): Promise<PropertySaleRecord[]> {
  // Fetch the LGA download page
  const pageUrl = `${NSW_BASE_URL}?lga=${lgaCode}`;
  console.log(`[ingest-vg] NSW LGA ${lgaName}: fetching page ${pageUrl}`);

  let downloadUrl: string | null = null;

  try {
    const pageResp = await fetch(pageUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pageResp.ok) {
      console.warn(`[ingest-vg] NSW ${lgaName}: page fetch failed (${pageResp.status})`);
      return [];
    }

    const html = await pageResp.text();

    // Find .dat or .zip download link in the HTML
    const linkMatch = html.match(/href=["']([^"']*\.(?:dat|zip|DAT|ZIP)[^"']*)["']/i);
    if (linkMatch) {
      const href = linkMatch[1];
      downloadUrl = href.startsWith('http') ? href : `https://www.valuergeneral.nsw.gov.au${href}`;
    }
  } catch (err) {
    console.error(`[ingest-vg] NSW ${lgaName}: page error`, err);
    return [];
  }

  if (!downloadUrl) {
    console.warn(`[ingest-vg] NSW ${lgaName}: no download link found`);
    return [];
  }

  console.log(`[ingest-vg] NSW ${lgaName}: downloading ${downloadUrl}`);

  try {
    const fileResp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(60_000),
    });

    if (!fileResp.ok) {
      console.warn(`[ingest-vg] NSW ${lgaName}: download failed (${fileResp.status})`);
      return [];
    }

    // Handle ZIP by attempting text extraction — for true ZIP support a library
    // would be needed; for now we fall back to treating as text
    const text = await fileResp.text();
    const lines = text.split('\n');
    const records: PropertySaleRecord[] = [];

    for (const line of lines) {
      const record = parseNswVgLine(line);
      if (record) {
        record.suburb = lgaName;
        records.push(record);
      }
    }

    console.log(`[ingest-vg] NSW ${lgaName}: parsed ${records.length} records`);
    return records;
  } catch (err) {
    console.error(`[ingest-vg] NSW ${lgaName}: download/parse error`, err);
    return [];
  }
}

/**
 * Ingest NSW Valuer General bulk sale records for major LGAs.
 *
 * @param lgaCode - Optional: restrict to a single LGA code from NSW_LGAS.
 */
export async function ingestNswValuerGeneral(
  lgaCode?: string
): Promise<{ inserted: number; errors: number }> {
  const lgas = lgaCode
    ? NSW_LGAS.filter((l) => l.code === lgaCode)
    : NSW_LGAS;

  let inserted = 0;
  let errors = 0;

  for (const lga of lgas) {
    try {
      const records = await fetchNswLga(lga.code, lga.name);
      if (records.length > 0) {
        await insertPropertySales(records);
        inserted += records.length;
      }
    } catch (err) {
      console.error(`[ingest-vg] NSW ${lga.name}: unexpected error`, err);
      errors++;
    }

    // Polite pause between LGA requests
    await new Promise<void>((r) => setTimeout(r, 2000));
  }

  console.log(`[ingest-vg] NSW complete: ${inserted} inserted, ${errors} errors`);
  return { inserted, errors };
}

// ─── VIC Valuer General (suburb medians) ─────────────────────────────────────

const VIC_DATASET_PAGE =
  'https://discover.data.vic.gov.au/dataset/victorian-property-sales-report-yearly-summary';

/**
 * Simple CSV/text parser for VIC suburb median rows.
 * Handles comma-separated or tab-separated lines.
 */
function parseVicMedianLine(
  line: string,
  headers: string[]
): PropertySaleRecord | null {
  if (!line.trim()) return null;

  const sep = line.includes('\t') ? '\t' : ',';
  const cols = line.split(sep).map((c) => c.replace(/^["']|["']$/g, '').trim());

  if (cols.length < 3) return null;

  // Try to map common header names
  const idx = (names: string[]): number =>
    names.reduce(
      (found, n) =>
        found >= 0
          ? found
          : headers.findIndex((h) => h.toLowerCase().includes(n.toLowerCase())),
      -1
    );

  const suburbIdx = idx(['suburb']);
  const typeIdx = idx(['type', 'property_type', 'prop_type']);
  const quarterIdx = idx(['quarter', 'period', 'date']);
  const medianIdx = idx(['median', 'median_price', 'price']);
  const countIdx = idx(['count', 'sales', 'number']);

  const suburb = suburbIdx >= 0 ? cols[suburbIdx] : cols[0];
  const propertyType = typeIdx >= 0 ? cols[typeIdx] : undefined;
  const quarter = quarterIdx >= 0 ? cols[quarterIdx] : undefined;
  const medianPrice = medianIdx >= 0 ? parseFloat(cols[medianIdx].replace(/[^0-9.]/g, '')) : NaN;
  const salesCount = countIdx >= 0 ? parseInt(cols[countIdx].replace(/[^0-9]/g, ''), 10) : NaN;

  if (!suburb) return null;

  return {
    raw_address: `${suburb} VIC`,
    suburb,
    state: 'VIC',
    property_type: propertyType,
    sale_date: quarter,
    source: 'vic-vg-aggregate',
    raw_data: {
      median_price: !isNaN(medianPrice) ? medianPrice : undefined,
      sales_count: !isNaN(salesCount) ? salesCount : undefined,
      quarter,
      property_type: propertyType,
    },
  };
}

/**
 * Ingest VIC Valuer General quarterly suburb median data.
 */
export async function ingestVicSuburbMedians(): Promise<{ rows: number; errors: number }> {
  console.log('[ingest-vg] VIC: fetching dataset page...');

  let downloadUrl: string | null = null;

  try {
    const pageResp = await fetch(VIC_DATASET_PAGE, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pageResp.ok) {
      console.warn(`[ingest-vg] VIC: dataset page fetch failed (${pageResp.status})`);
      return { rows: 0, errors: 1 };
    }

    const html = await pageResp.text();

    // Find most recent Excel/CSV/ZIP download link
    const linkMatch = html.match(
      /href=["']([^"']*\.(?:xlsx?|csv|zip|XLSX?|CSV|ZIP)[^"']*)["']/i
    );
    if (linkMatch) {
      const href = linkMatch[1];
      downloadUrl = href.startsWith('http') ? href : `https://discover.data.vic.gov.au${href}`;
    }
  } catch (err) {
    console.error('[ingest-vg] VIC: dataset page error', err);
    return { rows: 0, errors: 1 };
  }

  if (!downloadUrl) {
    console.warn('[ingest-vg] VIC: no download link found on dataset page');
    return { rows: 0, errors: 1 };
  }

  console.log(`[ingest-vg] VIC: downloading ${downloadUrl}`);

  try {
    const fileResp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(120_000),
    });

    if (!fileResp.ok) {
      console.warn(`[ingest-vg] VIC: download failed (${fileResp.status})`);
      return { rows: 0, errors: 1 };
    }

    // Treat as text (CSV or text-extractable Excel)
    const text = await fileResp.text();
    const lines = text.split('\n').filter((l) => l.trim());

    if (lines.length < 2) {
      console.warn('[ingest-vg] VIC: downloaded file appears empty');
      return { rows: 0, errors: 1 };
    }

    // First non-empty line as header
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(sep).map((h) => h.replace(/^["']|["']$/g, '').trim());

    const records: PropertySaleRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const record = parseVicMedianLine(lines[i], headers);
      if (record) records.push(record);
    }

    if (records.length > 0) {
      await insertPropertySales(records);
    }

    console.log(`[ingest-vg] VIC complete: ${records.length} rows`);
    return { rows: records.length, errors: 0 };
  } catch (err) {
    console.error('[ingest-vg] VIC: download/parse error', err);
    return { rows: 0, errors: 1 };
  }
}

// ─── WA Landgate ──────────────────────────────────────────────────────────────

const WA_CATALOGUE_URL = 'https://catalogue.data.wa.gov.au/dataset/sales-evidence-data';

/**
 * Parse a single WA Landgate line (pipe-delimited or fixed-width).
 */
function parseWaLandgateLine(line: string): PropertySaleRecord | null {
  if (!line.trim() || line.startsWith('#') || line.startsWith('//')) return null;

  const parts = line.split('|');
  if (parts.length >= 4) {
    const [rawAddress, salePriceStr, saleDate, propertyType, suburb, postcode, lot, plan] =
      parts.map((p) => p.trim());

    const salePrice = parseFloat(salePriceStr.replace(/[^0-9.]/g, ''));

    if (!rawAddress) return null;

    return {
      raw_address: rawAddress,
      suburb: suburb || undefined,
      state: 'WA',
      postcode: postcode || undefined,
      property_type: propertyType || undefined,
      sale_price: !isNaN(salePrice) && salePrice > 0 ? salePrice : undefined,
      sale_date: saleDate || undefined,
      lot_number: lot || undefined,
      plan_number: plan || undefined,
      source: 'wa-landgate',
      raw_data: { raw_line: line },
    };
  }

  // Fixed-width fallback
  if (line.length >= 40) {
    const rawAddress = line.substring(0, 40).trim();
    if (!rawAddress) return null;

    return {
      raw_address: rawAddress,
      state: 'WA',
      source: 'wa-landgate',
      raw_data: { raw_line: line },
    };
  }

  return null;
}

/**
 * Ingest WA Landgate sales evidence data.
 */
export async function ingestWaLandgate(): Promise<{ inserted: number; errors: number }> {
  console.log('[ingest-vg] WA: fetching catalogue page...');

  let downloadUrl: string | null = null;

  try {
    const pageResp = await fetch(WA_CATALOGUE_URL, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pageResp.ok) {
      console.warn(`[ingest-vg] WA: catalogue page failed (${pageResp.status})`);
      return { inserted: 0, errors: 1 };
    }

    const html = await pageResp.text();

    // Find the most recent DAT/ZIP download link for the current year
    const currentYear = new Date().getFullYear().toString();
    const yearPattern = new RegExp(
      `href=["']([^"']*${currentYear}[^"']*\\.(?:dat|zip|DAT|ZIP)[^"']*)["']`,
      'i'
    );
    const linkMatch = html.match(yearPattern) ??
      html.match(/href=["']([^"']*\.(?:dat|zip|DAT|ZIP)[^"']*)["']/i);

    if (linkMatch) {
      const href = linkMatch[1];
      downloadUrl = href.startsWith('http')
        ? href
        : `https://catalogue.data.wa.gov.au${href}`;
    }
  } catch (err) {
    console.error('[ingest-vg] WA: catalogue page error', err);
    return { inserted: 0, errors: 1 };
  }

  if (!downloadUrl) {
    console.warn('[ingest-vg] WA: no download link found');
    return { inserted: 0, errors: 1 };
  }

  console.log(`[ingest-vg] WA: downloading ${downloadUrl}`);

  try {
    const fileResp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(120_000),
    });

    if (!fileResp.ok) {
      console.warn(`[ingest-vg] WA: download failed (${fileResp.status})`);
      return { inserted: 0, errors: 1 };
    }

    const text = await fileResp.text();
    const lines = text.split('\n');
    const records: PropertySaleRecord[] = [];

    for (const line of lines) {
      const record = parseWaLandgateLine(line);
      if (record) records.push(record);
    }

    if (records.length > 0) {
      await insertPropertySales(records);
    }

    console.log(`[ingest-vg] WA complete: ${records.length} records`);
    return { inserted: records.length, errors: 0 };
  } catch (err) {
    console.error('[ingest-vg] WA: download/parse error', err);
    return { inserted: 0, errors: 1 };
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface VgIngestionOptions {
  nsw?: boolean;
  vic?: boolean;
  wa?: boolean;
}

/**
 * Run all enabled Valuer General ingestion sources in parallel.
 * Defaults to all sources enabled.
 */
export async function runValuerGeneralIngestion(
  options: VgIngestionOptions = { nsw: true, vic: true, wa: true }
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  if (options.nsw !== false) {
    tasks.push(
      ingestNswValuerGeneral().then((r) =>
        console.log(`[ingest-vg] NSW summary: ${r.inserted} inserted, ${r.errors} errors`)
      )
    );
  }

  if (options.vic !== false) {
    tasks.push(
      ingestVicSuburbMedians().then((r) =>
        console.log(`[ingest-vg] VIC summary: ${r.rows} rows, ${r.errors} errors`)
      )
    );
  }

  if (options.wa !== false) {
    tasks.push(
      ingestWaLandgate().then((r) =>
        console.log(`[ingest-vg] WA summary: ${r.inserted} inserted, ${r.errors} errors`)
      )
    );
  }

  const results = await Promise.allSettled(tasks);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(`[ingest-vg] ${failed.length} source(s) failed`);
    for (const f of failed) {
      if (f.status === 'rejected') {
        console.error('[ingest-vg] Error:', f.reason);
      }
    }
  }

  console.log('[ingest-vg] All sources complete');
}
