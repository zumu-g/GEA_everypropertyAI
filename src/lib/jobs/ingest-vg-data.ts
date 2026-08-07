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
import { toSlug } from '@/lib/utils/address';
import { CASEY_CARDINIA_POSTCODES } from '@/data/casey-cardinia';

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

// ─── VIC Valuer General (individual property sales) ──────────────────────────
//
// Distinct from ingestVicSuburbMedians() above (aggregate quarterly stats):
// this ingests one row per actual sale, giving property_sales a genuine
// multi-sale history over time as it re-runs each quarter.

const VIC_INDIVIDUAL_SALES_PAGE =
  'https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics';

/**
 * Parse a VIC Valuer-General individual property sales CSV row.
 *
 * The quarterly "Property Sales Statistics" CSV published at:
 *   https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics
 * uses a header row followed by comma-separated data rows.
 *
 * Typical columns (may vary by release year):
 *   Year, Quarter, Suburb, Postcode, Property Type, Sale Price, Sale Date,
 *   Settlement Date, Lot Number, Plan Number, House Number, Street, Land Area
 *
 * The parser is header-driven so it tolerates column reordering.
 */
export function parseVicSalesCsvRow(
  cols: string[],
  headers: string[],
): PropertySaleRecord | null {
  const idx = (candidates: string[]): number =>
    candidates.reduce(
      (found, name) =>
        found >= 0
          ? found
          : headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase())),
      -1,
    );

  const col = (candidates: string[]): string => {
    const i = idx(candidates);
    return i >= 0 ? (cols[i] ?? '').replace(/^["']|["']$/g, '').trim() : '';
  };

  const suburb = col(['suburb']);
  const postcode = col(['postcode', 'post_code']);
  const houseNumber = col(['house_number', 'house number', 'number']);
  const street = col(['street_name', 'street name', 'street']);
  const rawAddress = [houseNumber, street, suburb, 'VIC', postcode]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!rawAddress) return null;

  // Compute a stable address slug so VG rows can be joined to crawled profiles
  // and enumerated by the backfill orchestrator. Best-effort: VG `street` often
  // already includes the street type, so we leave streetType empty.
  const addressSlug =
    houseNumber && street && suburb
      ? toSlug({
          streetNumber: houseNumber,
          streetName: street,
          streetType: '',
          suburb,
          state: 'VIC',
          postcode,
        })
      : undefined;

  const salePriceRaw = col(['sale_price', 'saleprice', 'price']);
  const salePrice = parseFloat(salePriceRaw.replace(/[^0-9.]/g, ''));

  const saleDateRaw = col(['sale_date', 'saledate', 'contract_date', 'contract date']);
  const settlementRaw = col(['settlement_date', 'settlement date']);
  const propertyType = col(['property_type', 'property type', 'prop_type']);
  const lotNumber = col(['lot', 'lot_number', 'lot number']);
  const planNumber = col(['plan', 'plan_number', 'plan number']);
  const landAreaRaw = col(['land_area', 'land area', 'area']);
  const landArea = parseFloat(landAreaRaw.replace(/[^0-9.]/g, ''));

  return {
    address_slug: addressSlug,
    raw_address: rawAddress || `${suburb} VIC ${postcode}`,
    suburb: suburb || undefined,
    state: 'VIC',
    postcode: postcode || undefined,
    lot_number: lotNumber || undefined,
    plan_number: planNumber || undefined,
    land_area_sqm: !isNaN(landArea) && landArea > 0 ? landArea : undefined,
    property_type: propertyType || undefined,
    sale_price: !isNaN(salePrice) && salePrice > 0 ? salePrice : undefined,
    sale_date: saleDateRaw || undefined,
    settlement_date: settlementRaw || undefined,
    source: 'vic-vg',
    raw_data: { raw_cols: cols },
  };
}

/**
 * Split a CSV line respecting double-quoted fields that may contain commas.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped double-quote ("") inside a quoted field
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Fetch a VIC individual-sales CSV from the given URL, parse it, filter to
 * Casey/Cardinia postcodes, and insert into property_sales. Shared by the
 * manual `?csvUrl=` override and the auto-discovering path below.
 */
export async function ingestVicSalesCsvUrl(
  csvUrl: string,
): Promise<{ parsed: number; inserted: number; skipped: number; error?: string }> {
  let text: string;
  try {
    const resp = await fetch(csvUrl, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      return { parsed: 0, inserted: 0, skipped: 0, error: `HTTP ${resp.status} from ${csvUrl}` };
    }
    text = await resp.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { parsed: 0, inserted: 0, skipped: 0, error: `Fetch failed: ${message}` };
  }

  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    return { parsed: 0, inserted: 0, skipped: 0, error: 'CSV appears empty (< 2 lines)' };
  }

  const headers = splitCsvLine(lines[0]).map((h) =>
    h.replace(/^["']|["']$/g, '').trim(),
  );

  const records: PropertySaleRecord[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const record = parseVicSalesCsvRow(cols, headers);
    if (!record) continue;

    // Filter to Casey / Cardinia postcodes only
    if (record.postcode && !CASEY_CARDINIA_POSTCODES.has(record.postcode)) {
      skipped++;
      continue;
    }

    records.push(record);
  }

  if (records.length > 0) {
    // insertPropertySales throws on failed chunks — surface as this function's
    // error-result shape (callers branch on `error`, they don't catch throws).
    try {
      await insertPropertySales(records);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { parsed: lines.length - 1, inserted: 0, skipped, error: message };
    }
  }

  return {
    parsed: lines.length - 1,
    inserted: records.length,
    skipped,
  };
}

/**
 * Find every `.csv`/`.xlsx?`/`.zip` download link on a VIC data-portal page,
 * resolved to absolute URLs. Shared by the current-quarter auto-discovery
 * (takes the first link) and the historical backfill (takes them all).
 */
function findDownloadLinks(html: string, baseOrigin: string): string[] {
  const linkPattern = /href=["']([^"']*\.(?:xlsx?|csv|zip|XLSX?|CSV|ZIP)[^"']*)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    links.push(href.startsWith('http') ? href : `${baseOrigin}${href}`);
  }
  return links;
}

/**
 * Fetch the VIC individual-sales statistics page and return every download
 * link it exposes. Shared by the current-quarter auto-discovery (takes the
 * first link) and the historical backfill (takes them all) — `logPrefix`
 * keeps their log lines distinguishable. Returns `null` on a fetch failure
 * (already logged); an empty array means the fetch succeeded but no
 * download link was found.
 */
async function discoverVicIndividualSalesLinks(logPrefix: string): Promise<string[] | null> {
  console.log(`${logPrefix}: fetching statistics page...`);

  let html: string;
  try {
    const pageResp = await fetch(VIC_INDIVIDUAL_SALES_PAGE, {
      headers: { 'User-Agent': 'PropertyIQ/1.0 (+https://propertyiq.com.au)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!pageResp.ok) {
      console.warn(`${logPrefix}: page fetch failed (${pageResp.status})`);
      return null;
    }
    html = await pageResp.text();
  } catch (err) {
    console.error(`${logPrefix}: page fetch error`, err);
    return null;
  }

  return findDownloadLinks(html, 'https://www.land.vic.gov.au');
}

/**
 * Auto-discover and ingest the current quarter's VIC individual property
 * sales CSV — no manual URL required. Mirrors ingestVicSuburbMedians()'s
 * fetch-page/regex-link/fetch-file shape, against the individual-sales
 * statistics page instead of the yearly-summary dataset page.
 */
export async function ingestVicIndividualSales(): Promise<{ inserted: number; errors: number }> {
  const links = await discoverVicIndividualSalesLinks('[ingest-vg] VIC individual sales');
  if (links === null) return { inserted: 0, errors: 1 };
  if (links.length === 0) {
    console.warn('[ingest-vg] VIC individual sales: no download link found on statistics page');
    return { inserted: 0, errors: 1 };
  }

  const result = await ingestVicSalesCsvUrl(links[0]);
  if (result.error) {
    console.error(`[ingest-vg] VIC individual sales: ${result.error}`);
    return { inserted: 0, errors: 1 };
  }

  console.log(
    `[ingest-vg] VIC individual sales complete: ${result.inserted} inserted, ${result.skipped} skipped (non-Casey/Cardinia)`
  );
  return { inserted: result.inserted, errors: 0 };
}

/**
 * One-time historical backfill: enumerate every download link discoverable
 * on the individual-sales statistics page (not just the first/current one)
 * and ingest each. Run explicitly and separately from the recurring cron —
 * see the manual GET `?backfill=true` trigger in the route handler.
 *
 * If the page only ever exposes the current quarter (no archive), this
 * degrades to the same single-file result as ingestVicIndividualSales() and
 * says so explicitly rather than silently looking like a no-op.
 */
// ponytail: sequential per-file loop with no overall deadline could run past a
// serverless function's timeout mid-batch if the archive is large. Each file's
// insert already commits before moving to the next (a kill mid-batch leaves
// consistent partial progress, not corruption), and this cap bounds the worst
// case to a rerunnable size — raise it if the real archive turns out bigger.
const MAX_BACKFILL_FILES = 20;

export async function backfillVicIndividualSalesHistory(): Promise<{
  filesFound: number;
  totalInserted: number;
  perFile: Array<{ url: string; inserted: number; error?: string }>;
}> {
  const links = await discoverVicIndividualSalesLinks('[ingest-vg] VIC backfill');
  if (links === null) return { filesFound: 0, totalInserted: 0, perFile: [] };
  if (links.length === 0) {
    console.warn('[ingest-vg] VIC backfill: no historical archive found — only current-quarter data will accumulate going forward');
    return { filesFound: 0, totalInserted: 0, perFile: [] };
  }

  const toProcess = links.slice(0, MAX_BACKFILL_FILES);
  if (links.length > MAX_BACKFILL_FILES) {
    console.warn(
      `[ingest-vg] VIC backfill: found ${links.length} files, processing the first ${MAX_BACKFILL_FILES} this run — rerun the backfill trigger to continue with the rest`
    );
  }

  const perFile: Array<{ url: string; inserted: number; error?: string }> = [];
  for (const url of toProcess) {
    // Isolated per-file: one bad file doesn't abort the rest of the batch.
    try {
      const result = await ingestVicSalesCsvUrl(url);
      perFile.push({ url, inserted: result.inserted, error: result.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ingest-vg] VIC backfill: ${url} failed:`, message);
      perFile.push({ url, inserted: 0, error: message });
    }
  }

  const totalInserted = perFile.reduce((sum, f) => sum + f.inserted, 0);
  console.log(
    `[ingest-vg] VIC backfill complete: ${links.length} file(s) found, ${toProcess.length} processed, ${totalInserted} total rows inserted`
  );
  return { filesFound: links.length, totalInserted, perFile };
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
    tasks.push(
      ingestVicIndividualSales().then((r) =>
        console.log(`[ingest-vg] VIC individual sales summary: ${r.inserted} inserted, ${r.errors} errors`)
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
