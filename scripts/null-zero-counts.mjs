#!/usr/bin/env node
// ============================================================
// One-off: strip bedrooms/bathrooms/carSpaces === 0 from cached profiles.
//
// allhomes.com.au returns 0 for counts it can't map; until merger.ts learned
// to treat 0 as missing (COUNT_FIELDS), those zeros were persisted into
// property_cache.raw_data.data and then beat every `??` fallback downstream.
// Idempotent — re-running finds nothing to change.
//
// Usage: node scripts/null-zero-counts.mjs [--dry-run]
// Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* ignore */ }

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Missing Supabase env'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const COUNT_FIELDS = ['bedrooms', 'bathrooms', 'carSpaces'];
const dryRun = process.argv.includes('--dry-run');

async function fetchZeroRows() {
  const rows = [];
  for (const f of COUNT_FIELDS) {
    for (let off = 0; ; off += 1000) {
      const r = await fetch(`${URL_}/rest/v1/property_cache?raw_data->data->>${f}=eq.0&select=address_slug,raw_data&offset=${off}&limit=1000`, { headers: H });
      if (!r.ok) throw new Error(`fetch ${f} failed (${r.status})`);
      const j = await r.json();
      rows.push(...j);
      if (j.length < 1000) break;
    }
  }
  // dedupe on slug (a row can match several fields)
  return [...new Map(rows.map((r) => [r.address_slug, r])).values()];
}

const rows = await fetchZeroRows();
console.log(`${rows.length} cached profile(s) carry a 0 count${dryRun ? ' (dry-run)' : ''}.`);
let updated = 0;
for (const row of rows) {
  const data = row.raw_data?.data ?? {};
  const fc = row.raw_data?.fieldConfidences ?? {};
  let changed = false;
  for (const f of COUNT_FIELDS) {
    if (data[f] === 0) { delete data[f]; delete fc[f]; changed = true; }
  }
  if (!changed) continue;
  if (dryRun) { updated++; continue; }
  const r = await fetch(`${URL_}/rest/v1/property_cache?address_slug=eq.${encodeURIComponent(row.address_slug)}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ raw_data: { ...row.raw_data, data, fieldConfidences: fc } }),
  });
  if (!r.ok) { console.error(`  ${row.address_slug}: PATCH ${r.status}`); continue; }
  updated++;
}
console.log(`Done. ${updated} profile(s) ${dryRun ? 'would be' : ''} cleaned.`);
