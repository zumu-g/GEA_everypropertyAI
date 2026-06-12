#!/usr/bin/env node
// ============================================================
// Field-coverage report for the sold dataset (property_sales).
//
// Pages through ALL property_sales rows, batch-fetches the enrichment lookups
// (property_cache profiles + property_listings listed_dates by address_slug),
// and reports column-only vs post-merge coverage for the CMA enrichment
// fields, plus per-suburb buildingAreaSqm coverage (thinnest first).
//
// The merge semantics here deliberately duplicate the pure logic in
// src/lib/sold/enrich.ts (zero-as-missing land area; sold value wins, profile
// fills blanks; firstListedDate = own listed_date else latest candidate
// listed_date ≤ sale_date; daysOnMarket = whole days when ≥ 0). If that file
// changes, change this one.
//
// Usage:
//   node scripts/report-sold-coverage.mjs
//
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws'; // Node 20 lacks native WebSocket; realtime-js needs a transport

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
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });

const PAGE_SIZE = 1000;
const SLUG_CHUNK = 200;

// ── Migration 008 probe ──
// building_area_sqm and listed_date are added by migration 008. If that
// migration has not been applied yet PostgREST returns error code 42703.
// We probe once at startup and set a flag so the rest of the script still
// runs cleanly, just with those two columns treated as null.
let migration008Missing = false;

async function probeMigration008() {
  const { error } = await supabase
    .from('property_sales')
    .select('building_area_sqm, listed_date')
    .limit(1);
  if (error) {
    // 42703 = column does not exist (PostgREST surfaces this in error.message)
    migration008Missing = true;
    console.warn('');
    console.warn('┌─────────────────────────────────────────────────────────────────────┐');
    console.warn('│  NOTE: migration 008 not applied — building_area_sqm / listed_date  │');
    console.warn('│  columns absent; column-only coverage for those fields reported as  │');
    console.warn('│  0%, post-merge still measured from profile/listings joins.         │');
    console.warn('└─────────────────────────────────────────────────────────────────────┘');
    console.warn('');
  }
}

// ── Pure helpers mirrored from src/lib/sold/enrich.ts ──

function asNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Mirrors sqmOrNull in src/lib/utils/area.ts: 0/negative/non-finite → null. */
function sqmOrNull(v) {
  const n = asNumber(typeof v === 'string' ? Number(v) : v);
  return n !== null && n > 0 ? n : null;
}

/** "YYYY-MM-DD" (or ISO timestamp) → epoch ms at UTC midnight, or null. */
function dayMs(v) {
  if (typeof v !== 'string' || !v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Latest candidate listed_date ≤ sale_date, else null (mirrors selectFirstListedDate). */
function selectFirstListedDate(saleDate, candidates) {
  if (!candidates?.length) return null;
  const saleMs = dayMs(saleDate);
  if (saleMs === null) return null;
  let best = null;
  for (const c of candidates) {
    const t = dayMs(c);
    if (t === null || t > saleMs) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : ymd(best);
}

/** Whole days listed→sold; null when either missing or diff < 0 (mirrors deriveDaysOnMarket). */
function deriveDaysOnMarket(saleDate, firstListedDate) {
  const saleMs = dayMs(saleDate);
  const listedMs = dayMs(firstListedDate);
  if (saleMs === null || listedMs === null) return null;
  const days = Math.round((saleMs - listedMs) / 86_400_000);
  return days >= 0 ? days : null;
}

// ── Data fetch ──

async function fetchAllSales() {
  // When migration 008 is absent, omit the two columns that don't exist yet.
  const selectCols = migration008Missing
    ? 'address_slug, suburb, land_area_sqm, bedrooms, bathrooms, car_spaces, sale_date'
    : 'address_slug, suburb, land_area_sqm, building_area_sqm, bedrooms, bathrooms, car_spaces, listed_date, sale_date';
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('property_sales')
      .select(selectCols)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`property_sales page at ${from}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** slug → { landAreaSqm, buildingAreaSqm, bedrooms, bathrooms, carSpaces } from property_cache.raw_data.data */
async function fetchProfiles(slugs) {
  const map = new Map();
  for (const part of chunk(slugs, SLUG_CHUNK)) {
    const { data, error } = await supabase
      .from('property_cache')
      .select('address_slug, raw_data')
      .in('address_slug', part);
    if (error) throw new Error(`property_cache lookup: ${error.message}`);
    for (const row of data ?? []) {
      const d = row.raw_data?.data ?? {};
      map.set(row.address_slug, {
        landAreaSqm: asNumber(d.landAreaSqm) ?? asNumber(d.landArea),
        buildingAreaSqm: asNumber(d.buildingAreaSqm) ?? asNumber(d.buildingArea),
        bedrooms: asNumber(d.bedrooms),
        bathrooms: asNumber(d.bathrooms),
        carSpaces: asNumber(d.garages) ?? asNumber(d.carSpaces),
      });
    }
  }
  return map;
}

/** slug → string[] of listed_date candidates (all campaigns). */
async function fetchListedDates(slugs) {
  const map = new Map();
  for (const part of chunk(slugs, SLUG_CHUNK)) {
    const { data, error } = await supabase
      .from('property_listings')
      .select('address_slug, listed_date')
      .in('address_slug', part)
      .not('listed_date', 'is', null);
    if (error) throw new Error(`property_listings lookup: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.address_slug || !row.listed_date) continue;
      const list = map.get(row.address_slug) ?? [];
      list.push(row.listed_date);
      map.set(row.address_slug, list);
    }
  }
  return map;
}

// ── Report ──

function pct(n, total) {
  return total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  await probeMigration008();
  console.log('Fetching property_sales...');
  const rows = await fetchAllSales();
  const total = rows.length;
  console.log(`Total rows: ${total}`);

  const slugs = [...new Set(rows.map((r) => r.address_slug).filter(Boolean))];
  console.log(`Distinct non-null slugs: ${slugs.length}`);
  console.log('Fetching enrichment lookups...');
  const [profiles, listedDates] = await Promise.all([fetchProfiles(slugs), fetchListedDates(slugs)]);
  console.log(`Profiles matched: ${profiles.size}; slugs with listed_date candidates: ${listedDates.size}\n`);

  const FIELDS = ['buildingAreaSqm', 'landAreaSqm', 'bedrooms', 'bathrooms', 'carSpaces', 'firstListedDate', 'daysOnMarket'];
  const colOnly = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const merged = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let nullSlugs = 0;

  // per-suburb buildingAreaSqm post-merge coverage
  const suburbStats = new Map(); // suburb → { rows, covered }

  for (const s of rows) {
    if (!s.address_slug) nullSlugs++;
    const profile = s.address_slug ? profiles.get(s.address_slug) ?? null : null;
    const candidates = s.address_slug ? listedDates.get(s.address_slug) : undefined;

    // Column-only values (zero-as-missing for land area; sqm sanity on building too,
    // matching enrich.ts which runs both through sqmOrNull).
    // When migration 008 is absent the columns don't exist on the row object;
    // treat them as null so post-merge coverage is still measured via profile/listings joins.
    const colLand = sqmOrNull(s.land_area_sqm);
    const colBuilding = migration008Missing ? null : sqmOrNull(s.building_area_sqm);
    const rawListed = migration008Missing ? null : (s.listed_date ?? null);
    const colListed = rawListed && dayMs(rawListed) !== null ? ymd(dayMs(rawListed)) : null;
    const colDom = deriveDaysOnMarket(s.sale_date ?? null, colListed);

    // Post-merge values (mirrors toEnrichedSoldResult in src/lib/sold/enrich.ts)
    const mLand = colLand ?? sqmOrNull(profile?.landAreaSqm);
    const mBuilding = colBuilding ?? sqmOrNull(profile?.buildingAreaSqm);
    const mBeds = s.bedrooms ?? profile?.bedrooms ?? null;
    const mBaths = s.bathrooms ?? profile?.bathrooms ?? null;
    const mCars = s.car_spaces ?? profile?.carSpaces ?? null;
    const mListed = colListed ?? selectFirstListedDate(s.sale_date ?? null, candidates);
    const mDom = deriveDaysOnMarket(s.sale_date ?? null, mListed);

    if (colBuilding !== null) colOnly.buildingAreaSqm++;
    if (colLand !== null) colOnly.landAreaSqm++;
    if (s.bedrooms != null) colOnly.bedrooms++;
    if (s.bathrooms != null) colOnly.bathrooms++;
    if (s.car_spaces != null) colOnly.carSpaces++;
    if (colListed !== null) colOnly.firstListedDate++;
    if (colDom !== null) colOnly.daysOnMarket++;

    if (mBuilding !== null) merged.buildingAreaSqm++;
    if (mLand !== null) merged.landAreaSqm++;
    if (mBeds != null) merged.bedrooms++;
    if (mBaths != null) merged.bathrooms++;
    if (mCars != null) merged.carSpaces++;
    if (mListed !== null) merged.firstListedDate++;
    if (mDom !== null) merged.daysOnMarket++;

    const suburb = (s.suburb ?? '(no suburb)').trim() || '(no suburb)';
    const st = suburbStats.get(suburb) ?? { rows: 0, covered: 0 };
    st.rows++;
    if (mBuilding !== null) st.covered++;
    suburbStats.set(suburb, st);
  }

  // ── Field coverage table ──
  console.log('Field coverage (column-only vs post-merge):');
  console.log('  field             column-only          post-merge');
  for (const f of FIELDS) {
    console.log(
      `  ${f.padEnd(17)} ${String(colOnly[f]).padStart(6)} (${pct(colOnly[f], total).padStart(6)})   ${String(merged[f]).padStart(6)} (${pct(merged[f], total).padStart(6)})`
    );
  }

  console.log(`\naddress_slug null: ${nullSlugs} / ${total} (${pct(nullSlugs, total)})`);

  // ── Per-suburb buildingAreaSqm coverage (≥10 rows, thinnest first) ──
  const suburbRows = [...suburbStats.entries()]
    .filter(([, st]) => st.rows >= 10)
    .map(([suburb, st]) => ({ suburb, ...st, pctNum: st.rows ? st.covered / st.rows : 0 }))
    .sort((a, b) => a.pctNum - b.pctNum || a.suburb.localeCompare(b.suburb));

  console.log('\nPer-suburb buildingAreaSqm post-merge coverage (>=10 rows, thinnest first):');
  console.log('  suburb                      rows  covered      %');
  for (const r of suburbRows) {
    console.log(`  ${r.suburb.padEnd(26)} ${String(r.rows).padStart(5)} ${String(r.covered).padStart(8)} ${pct(r.covered, r.rows).padStart(7)}`);
  }

  // ── Sanity check ──
  const violations = FIELDS.filter((f) => merged[f] < colOnly[f]);
  if (violations.length) {
    console.error(`\nSANITY CHECK FAILED: post-merge < column-only for: ${violations.join(', ')}`);
    process.exit(1);
  }
  console.log('\nSanity check passed: post-merge >= column-only for every field.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
