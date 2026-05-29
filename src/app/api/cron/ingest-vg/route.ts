import { NextRequest, NextResponse } from 'next/server';
import { runValuerGeneralIngestion } from '@/lib/jobs/ingest-vg-data';
import { insertPropertySales, type PropertySaleRecord } from '@/lib/db/queries';
import { toSlug } from '@/lib/utils/address';
import { CASEY_CARDINIA_POSTCODES } from '@/data/casey-cardinia';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

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
function parseVicSalesCsvRow(
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
function splitCsvLine(line: string): string[] {
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
 * Fetch a CSV from the given URL, parse it, filter to Casey/Cardinia postcodes,
 * and insert into property_sales.  Returns a summary.
 */
async function ingestVicSalesCsvUrl(
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
    await insertPropertySales(records);
  }

  return {
    parsed: lines.length - 1,
    inserted: records.length,
    skipped,
  };
}

// ─── Authentication helper ────────────────────────────────────────────────────

function isAuthorised(request: NextRequest): boolean {
  if (!CRON_SECRET) return true; // dev mode — no secret set
  const auth =
    request.headers.get('authorization') ??
    request.headers.get('x-cron-secret');
  return auth === `Bearer ${CRON_SECRET}` || auth === CRON_SECRET;
}

// ─── POST /api/cron/ingest-vg ─────────────────────────────────────────────────
//
// Triggers Valuer General bulk data ingestion for NSW, VIC, and WA.
// Runs on a weekly Vercel Cron schedule (Monday 2am UTC).
//
// Auth: Authorization: Bearer {CRON_SECRET} (skipped if CRON_SECRET not set)

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runValuerGeneralIngestion({ nsw: true, vic: true, wa: true });

    return NextResponse.json({
      status: 'completed',
      sources: ['nsw-vg', 'vic-vg', 'wa-landgate'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[cron/ingest-vg] Error:', message);
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 });
  }
}

// ─── GET /api/cron/ingest-vg?csvUrl=<url> ────────────────────────────────────
//
// Manually ingest a VIC Valuer-General individual property sales CSV file.
// Accepts the CSV URL as a query parameter so Stuart can trigger ingestion by
// pasting the download URL from:
//   https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics
//
// Filters rows to Casey / Cardinia postcodes before inserting.
//
// Example:
//   GET /api/cron/ingest-vg?csvUrl=https://s3.data.vic.gov.au/...quarterly_sales.csv
//
// Auth: same CRON_SECRET header as POST (skipped in dev)

export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const csvUrl = request.nextUrl.searchParams.get('csvUrl');

  if (!csvUrl) {
    return NextResponse.json(
      {
        error: 'csvUrl query param is required',
        hint: 'Pass the full URL to a VIC Valuer-General quarterly sales CSV. ' +
          'Download links are available at: ' +
          'https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics',
        postcodes: Array.from(CASEY_CARDINIA_POSTCODES).sort(),
      },
      { status: 400 },
    );
  }

  try {
    new URL(csvUrl); // validate it's a proper URL
  } catch {
    return NextResponse.json(
      { error: 'csvUrl is not a valid URL' },
      { status: 400 },
    );
  }

  console.log(`[cron/ingest-vg] Manual VIC CSV ingest from: ${csvUrl}`);

  const result = await ingestVicSalesCsvUrl(csvUrl);

  if (result.error) {
    return NextResponse.json(
      { status: 'failed', ...result },
      { status: 502 },
    );
  }

  return NextResponse.json({
    status: 'completed',
    source: 'vic-vg',
    csvUrl,
    ...result,
  });
}
