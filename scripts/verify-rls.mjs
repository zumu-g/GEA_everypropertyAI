#!/usr/bin/env node
// verify-rls.mjs — confirm RLS posture on everypropertyAI Supabase tables
// Usage: node --env-file=.env.local scripts/verify-rls.mjs
//
// Checks:
//   LOCKED  tables: anon INSERT must return 42501; anon SELECT must return 0 rows or 401
//   PUBLIC  tables: anon SELECT must succeed (listed for reference; adjust if intentionally opened)
//
// Run BEFORE and AFTER applying migration 011 to confirm the fix.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

// Tables that must deny anon access (both reads and writes)
const LOCKED = [
  'addresses',
  'crawl_queue',
  'property_sales',
  'property_cache',
  'property_listings',
  'property_rentals',
];

async function checkTable(table) {
  const base = `${SUPABASE_URL}/rest/v1/${table}`;

  // anon SELECT
  const sel = await fetch(`${base}?limit=1`, { headers: { ...headers, Prefer: 'return=representation' } });
  const selData = await sel.json().catch(() => null);
  const selRows = Array.isArray(selData) ? selData.length : null;

  // anon INSERT (deliberately invalid payload — expect RLS denial before column validation)
  const ins = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const insBody = await ins.json().catch(() => null);
  const insCode = insBody?.code ?? ins.status;

  return { table, selStatus: sel.status, selRows, insStatus: ins.status, insCode };
}

const results = await Promise.all(LOCKED.map(checkTable));

let allPassed = true;
console.log('\n=== RLS verification results ===\n');
for (const r of results) {
  const readOk  = r.selStatus === 401 || r.selRows === 0;
  const writeOk = String(r.insCode) === '42501' || r.insStatus === 401;
  const pass    = readOk && writeOk;
  if (!pass) allPassed = false;

  const icon = pass ? '✓' : '✗';
  const readLabel  = readOk  ? `SELECT ok (${r.selStatus}, rows=${r.selRows ?? '?'})` : `SELECT EXPOSED (${r.selStatus}, rows=${r.selRows})`;
  const writeLabel = writeOk ? `INSERT denied (${r.insCode})` : `INSERT EXPOSED (${r.insCode})`;
  console.log(`${icon}  ${r.table.padEnd(22)} | ${readLabel} | ${writeLabel}`);
}

console.log('\n' + (allPassed ? '✓ All tables correctly locked.' : '✗ Some tables still exposed — check output above.'));
process.exit(allPassed ? 0 : 1);
