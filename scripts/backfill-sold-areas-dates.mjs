#!/usr/bin/env node
// ============================================================
// Backfill land_area_sqm / building_area_sqm / listed_date on property_sales
// rows from their stored raw_data JSONB (the original Apify Domain item).
//
// A column is only filled where it is currently missing (null, or 0 for
// land_area_sqm — zero is treated as missing, never as data) AND the value
// re-extracted from raw_data is non-null. Existing non-null/non-zero values
// are never overwritten, so re-runs are idempotent.
//
// Usage:
//   node scripts/backfill-sold-areas-dates.mjs          # apply updates
//   node scripts/backfill-sold-areas-dates.mjs --dry    # report candidate counts only
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no dep) — only fills missing process.env keys.
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env.local).');
  process.exit(1);
}

const DRY = process.argv.includes('--dry');
const PAGE_SIZE = 1000;

// ── Area normalisation — duplicated from src/lib/utils/area.ts (scripts are
// .mjs and cannot import TS; keep in sync with normaliseAreaSqm there). ──

const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_HECTARE = 10000;

function unitFromToken(token) {
  const t = token.toLowerCase().replace(/[.\s]/g, '');
  if (/^(m2|m²|sqm|sq m|squaremetres?|squaremeters?)$/.test(t)) return 'sqm';
  if (/^(ac|acre|acres)$/.test(t)) return 'acre';
  if (/^(ha|hectare|hectares)$/.test(t)) return 'hectare';
  return null;
}

function toSqm(value, unit) {
  switch (unit) {
    case 'acre': return value * SQM_PER_ACRE;
    case 'hectare': return value * SQM_PER_HECTARE;
    default: return value;
  }
}

/**
 * Normalise a source area value to square metres.
 * Returns m² rounded to 1 dp, or null for 0/negative/unparseable values and
 * unrecognised explicit units (never guess).
 */
function normaliseAreaSqm(value, unitHint) {
  let numeric = null;
  let unit = null;

  if (typeof unitHint === 'string' && unitHint.trim()) {
    unit = unitFromToken(unitHint);
    if (unit === null) return null; // explicit unit we don't recognise — never guess
  }

  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string' && value.trim()) {
    // "1,012 m²" / "2.5 ac" / "650" — number first, optional trailing unit token
    const m = value.trim().match(/^([\d,]+(?:\.\d+)?)\s*([a-zA-Z²\s.]+)?$/);
    if (!m) return null;
    numeric = Number(m[1].replace(/,/g, ''));
    if (m[2] && m[2].trim()) {
      const embedded = unitFromToken(m[2]);
      if (embedded === null) return null; // explicit unit we don't recognise
      // an explicit unitHint param wins over an embedded token
      if (unit === null) unit = embedded;
    }
  } else {
    return null;
  }

  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0) return null;

  const sqm = toSqm(numeric, unit ?? 'sqm');
  return Math.round(sqm * 10) / 10;
}

// ── Listed-date parsing — duplicated from parseListedDate in
// src/lib/ingest/domain-mapper.ts (keep in sync). ──

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Calendar-validate y/m/d strings → "YYYY-MM-DD" or null. */
function validYmd(y, m, d) {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
  if (yy < 1900 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const date = new Date(Date.UTC(yy, mm - 1, dd));
  if (date.getUTCFullYear() !== yy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseListedDate(it) {
  const obj = it ?? {};
  const listing = obj.listing ?? {};
  const candidates = [
    obj.dateListed, obj.date_listed, obj.listedDate, obj.listed_date,
    listing.date_listed, listing.dateListed, listing.date_available, listing.dateAvailable,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const s = String(c).trim();
    // ISO-ish: 2024-10-07 or 2024-10-07T...
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const v = validYmd(iso[1], iso[2], iso[3]);
      if (v) return v;
      continue;
    }
    // "07 Oct 2024"
    const m = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m) {
      const mm = MONTHS[m[2].toLowerCase()];
      if (mm) {
        const v = validYmd(m[3], mm, m[1].padStart(2, '0'));
        if (v) return v;
      }
    }
  }
  return null;
}

// ── Extraction from a stored raw_data item (mirrors mapDomainItem field
// access in src/lib/ingest/domain-mapper.ts) ──

function extractFromRawData(raw) {
  const prop = (raw && typeof raw === 'object' ? raw.property : null) ?? {};
  return {
    landAreaSqm: normaliseAreaSqm(prop.land_size, prop.land_unit ?? prop.landUnit),
    buildingAreaSqm: normaliseAreaSqm(prop.building_size ?? prop.building_area ?? prop.buildingArea),
    listedDate: parseListedDate(raw),
  };
}

const missingLand = (v) => v == null || v === 0; // 0 land area is missing, not data
const missingVal = (v) => v == null;

// ── Main ──

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let scanned = 0;
  const counts = { land_area_sqm: 0, building_area_sqm: 0, listed_date: 0 };
  let updatedRows = 0;
  let updateErrors = 0;
  // Sanity gate for --dry: distribution of parsed land areas under 40 m²
  // (suspiciously small — would indicate a unit/parsing problem).
  const tinyLandAreas = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: rows, error } = await supabase
      .from('property_sales')
      .select('id, land_area_sqm, building_area_sqm, listed_date, raw_data')
      .not('raw_data', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('Fetch failed:', error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const parsed = extractFromRawData(row.raw_data);

      const patch = {};
      if (missingLand(row.land_area_sqm) && parsed.landAreaSqm != null) {
        patch.land_area_sqm = parsed.landAreaSqm;
        counts.land_area_sqm += 1;
        if (parsed.landAreaSqm < 40) tinyLandAreas.push(parsed.landAreaSqm);
      }
      if (missingVal(row.building_area_sqm) && parsed.buildingAreaSqm != null) {
        patch.building_area_sqm = parsed.buildingAreaSqm;
        counts.building_area_sqm += 1;
      }
      if (missingVal(row.listed_date) && parsed.listedDate != null) {
        patch.listed_date = parsed.listedDate;
        counts.listed_date += 1;
      }

      if (Object.keys(patch).length === 0) continue;

      if (!DRY) {
        const { error: upErr } = await supabase
          .from('property_sales')
          .update(patch)
          .eq('id', row.id);
        if (upErr) {
          updateErrors += 1;
          console.error(`Update failed for id=${row.id}: ${upErr.message}`);
        } else {
          updatedRows += 1;
        }
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  console.log('');
  console.log(`${DRY ? 'DRY RUN — no writes.' : 'Backfill complete.'}`);
  console.log(`Rows scanned (raw_data present): ${scanned}`);
  console.log(`Candidates — land_area_sqm:     ${counts.land_area_sqm}`);
  console.log(`Candidates — building_area_sqm: ${counts.building_area_sqm}`);
  console.log(`Candidates — listed_date:       ${counts.listed_date}`);
  if (DRY) {
    console.log('');
    console.log(`Sanity gate — parsed land areas under 40 m²: ${tinyLandAreas.length}`);
    if (tinyLandAreas.length) {
      const sorted = [...tinyLandAreas].sort((a, b) => a - b);
      const buckets = {};
      for (const v of sorted) {
        const key = `${Math.floor(v / 10) * 10}-${Math.floor(v / 10) * 10 + 10} m²`;
        buckets[key] = (buckets[key] ?? 0) + 1;
      }
      for (const [bucket, n] of Object.entries(buckets)) console.log(`  ${bucket}: ${n}`);
      console.log(`  min=${sorted[0]}, max=${sorted[sorted.length - 1]}`);
    }
  } else {
    console.log(`Rows updated: ${updatedRows}${updateErrors ? ` (errors: ${updateErrors})` : ''}`);
    if (updateErrors) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
