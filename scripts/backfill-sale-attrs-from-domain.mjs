#!/usr/bin/env node
// ============================================================
// Backfill bedrooms/bathrooms/car_spaces/land_area_sqm/building_area_sqm on
// property_sales rows by fetching each row's own Domain listing page
// (listing_url) through Bright Data Web Unlocker and parsing __NEXT_DATA__.
//
// Why: Domain's sold FEEDS omit attributes for most sold items, so ~2/3 of
// comps enter the estimator with bedrooms NULL and dodge bed-match weighting
// (12 Basalt Dr investigation). The individual listing PAGES do carry them.
//
// Only NULL columns are filled — existing values are never overwritten, so
// re-runs are idempotent. Paced with a delay between fetches: this is a slow
// drip backfill, not a crawl.
//
// Usage:
//   node scripts/backfill-sale-attrs-from-domain.mjs [--suburb "Clyde North"] [--limit 25] \
//     [--near "-38.0838,145.3613,1.1"] [--delay 4000] [--dry]
// Omit --suburb to drip across ALL suburbs, most-recent sales first (nightly cron mode).
//
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   BRIGHTDATA_WEB_UNLOCKER_TOKEN, BRIGHTDATA_WEB_UNLOCKER_ZONE (default web_unlocker1)
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WU_TOKEN = process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN;
const WU_ZONE = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE || 'web_unlocker1';
if (!SUPABASE_URL || !SERVICE_KEY || !WU_TOKEN) {
  console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY / BRIGHTDATA_WEB_UNLOCKER_TOKEN (.env.local).');
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DRY = process.argv.includes('--dry');
const SUBURB = arg('suburb', null);
const LIMIT = Number(arg('limit', '25'));
const DELAY_MS = Number(arg('delay', '4000'));
const NEAR = arg('near', null); // "lat,lng,km"

const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchTargets() {
  const url =
    `${SUPABASE_URL}/rest/v1/property_sales?` +
    (SUBURB ? `suburb=ilike.${encodeURIComponent(SUBURB)}&` : '') +
    `bedrooms=is.null&listing_url=not.is.null` +
    `&select=id,raw_address,sale_date,listing_url,latitude,longitude,bedrooms,bathrooms,car_spaces,land_area_sqm,building_area_sqm` +
    `&order=sale_date.desc&limit=1000`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`select failed: HTTP ${res.status}`);
  let rows = await res.json();
  if (NEAR) {
    const [lat, lng, km] = NEAR.split(',').map(Number);
    rows = rows.filter(
      (r) => typeof r.latitude === 'number' && haversineKm(lat, lng, r.latitude, r.longitude) <= km,
    );
  }
  return rows.slice(0, LIMIT);
}

async function fetchPage(url, maxAttempts = 3) {
  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WU_TOKEN}` },
        body: JSON.stringify({ zone: WU_ZONE, url, format: 'raw' }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 1000 && /<script id="__NEXT_DATA__"/i.test(html)) return html;
        const brdErr = res.headers.get('x-brd-err-msg') || res.headers.get('x-brd-error');
        if (brdErr) { lastErr = `Bright Data: ${brdErr}`; break; }
        lastErr = `no __NEXT_DATA__ (${html?.length ?? 0}b)`;
      } else {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) break;
      }
    } catch (e) { lastErr = e.message; }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error(lastErr);
}

const asNum = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

// Deep-scan __NEXT_DATA__ for the first object carrying beds+baths; collect
// land/building sizes from the same or any object. Domain's page shape drifts
// between releases, so key-scanning beats a fixed path.
export function extractAttrs(nextData) {
  const out = { bedrooms: null, bathrooms: null, car_spaces: null, land_area_sqm: null, building_area_sqm: null };
  // Breadth-first so the page's MAIN listing (shallow) wins over recommended-
  // property cards nested deeper in the tree.
  const queue = [nextData];
  while (queue.length) {
    const o = queue.shift();
    if (o == null || typeof o !== 'object') continue;
    if (Array.isArray(o)) { for (const v of o) queue.push(v); continue; }
    const beds = asNum(o.beds ?? o.bedrooms);
    const baths = asNum(o.baths ?? o.bathrooms);
    // Sanity at match time — search-filter objects carry beds:0/baths:0 junk.
    if (out.bedrooms == null && beds != null && baths != null && beds >= 1 && beds <= 12 && baths >= 1 && baths <= 8) {
      out.bedrooms = beds;
      out.bathrooms = baths;
      out.car_spaces = asNum(o.parking ?? o.carspaces ?? o.carSpaces ?? o.cars);
    }
    // Land / building sizes: number or { value, unit: 'm²'|'sqm' } or "448m²" strings.
    const sizeOf = (v) => {
      const n = asNum(v);
      if (n != null) return n;
      if (v && typeof v === 'object') {
        const u = String(v.unit ?? '').toLowerCase();
        if ((u.includes('m') || u === '') && asNum(v.value) != null) return asNum(v.value);
      }
      if (typeof v === 'string') {
        const m = v.match(/^([\d,.]+)\s*(m²|m2|sqm)$/i);
        if (m) return Number(m[1].replace(/,/g, ''));
      }
      return null;
    };
    if (out.land_area_sqm == null) {
      out.land_area_sqm = sizeOf(o.landsize ?? o.landSize ?? o.landArea ?? o.landAreaSqm);
    }
    if (out.building_area_sqm == null) {
      out.building_area_sqm = sizeOf(o.buildingArea ?? o.buildingAreaSqm ?? o.internalArea);
    }
    for (const v of Object.values(o)) queue.push(v);
  }
  // Sanity bounds — reject junk rather than write it.
  if (out.car_spaces != null && (out.car_spaces < 0 || out.car_spaces > 10)) out.car_spaces = null;
  if (out.land_area_sqm != null && (out.land_area_sqm < 40 || out.land_area_sqm > 200_000)) out.land_area_sqm = null;
  if (out.building_area_sqm != null && (out.building_area_sqm < 60 || out.building_area_sqm > 3_000)) out.building_area_sqm = null;
  return out;
}

async function updateRow(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/property_sales?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
}

async function main() {
  const targets = await fetchTargets();
  console.log(`${targets.length} null-bed ${SUBURB ?? 'all-suburb'} rows targeted${NEAR ? ` (near ${NEAR})` : ''}${DRY ? ' [DRY]' : ''}`);
  let updated = 0, noAttrs = 0, fetchFail = 0;
  for (const [i, row] of targets.entries()) {
    try {
      const html = await fetchPage(row.listing_url);
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      const attrs = extractAttrs(JSON.parse(m[1]));
      const patch = {};
      for (const k of ['bedrooms', 'bathrooms', 'car_spaces', 'land_area_sqm', 'building_area_sqm']) {
        if (row[k] == null && attrs[k] != null) patch[k] = attrs[k];
      }
      if (Object.keys(patch).length === 0) {
        noAttrs++;
        console.log(`[${i + 1}/${targets.length}] ${row.raw_address} — no attrs found on page`);
      } else {
        if (!DRY) await updateRow(row.id, patch);
        updated++;
        console.log(`[${i + 1}/${targets.length}] ${row.raw_address} ← ${JSON.stringify(patch)}`);
      }
    } catch (e) {
      fetchFail++;
      console.log(`[${i + 1}/${targets.length}] ${row.raw_address} — FAILED: ${e.message}`);
    }
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`\ndone: ${updated} updated, ${noAttrs} pages without attrs, ${fetchFail} fetch failures`);
}

const invokedDirectly = process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
