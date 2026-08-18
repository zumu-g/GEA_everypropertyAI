#!/usr/bin/env npx tsx
/**
 * Backtest the comparables estimator against recent sold properties with known
 * prices (plan 2026-08-18-001 U6). Each subject's own sale is held out via
 * excludeAddress, then the estimate is compared to the actual sale price.
 *
 * Usage:
 *   npx -y tsx scripts/backtest-estimator.ts [--limit 30] [--suburb Pakenham]
 *
 * Reports per-property actual vs estimated price, % error, and whether the
 * suburb-median cross-check flagged; summary reports median absolute % error
 * and the suburb-median flag rate. To compare constant sets, run this script
 * on main and on the calibration branch and diff the summaries — the
 * calibrated constants must not worsen median absolute error (U2 guardrail).
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // rely on ambient env
}

const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  // Import after env is loaded — the supabase client reads env at module init.
  // Node 20 lacks global WebSocket; realtime is unused here (REST only), so a
  // stub constructor satisfies supabase-js client init without pulling in 'ws'.
  (globalThis as { WebSocket?: unknown }).WebSocket ??= class {};

  const { getEstimate } = await import('../src/lib/estimation/estimate-service');
  const { createClient } = await import('@supabase/supabase-js');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const limit = Number(argOf('--limit') ?? 30);
  const suburb = argOf('--suburb');

  // Recent sales with full attributes + coords so the subject side is known.
  let q = supabase
    .from('property_sales')
    .select('raw_address,suburb,state,postcode,sale_price,sale_date,bedrooms,bathrooms,land_area_sqm,property_type,latitude,longitude')
    .not('bedrooms', 'is', null)
    .not('land_area_sqm', 'is', null)
    .not('latitude', 'is', null)
    .gt('sale_price', 100_000)
    .order('sale_date', { ascending: false })
    .limit(limit * 3); // over-fetch, then diversify
  if (suburb) q = q.ilike('suburb', suburb);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Diversify: round-robin by suburb so one estate doesn't dominate.
  const bySuburb = new Map<string, typeof data>();
  for (const r of data ?? []) {
    const key = (r.suburb ?? '?').toLowerCase();
    if (!bySuburb.has(key)) bySuburb.set(key, []);
    bySuburb.get(key)!.push(r);
  }
  const sample: NonNullable<typeof data> = [];
  while (sample.length < limit && [...bySuburb.values()].some((v) => v.length)) {
    for (const rows of bySuburb.values()) {
      const r = rows.shift();
      if (r) sample.push(r);
      if (sample.length >= limit) break;
    }
  }

  const errors: number[] = [];
  let flagCount = 0;
  let estimated = 0;
  console.log('actual\testimate\terr%\tsuburbFlag\taddress');
  for (const r of sample) {
    const result = await getEstimate({
      latitude: r.latitude,
      longitude: r.longitude,
      suburb: r.suburb,
      state: r.state ?? 'VIC',
      postcode: r.postcode ?? undefined,
      propertyType: r.property_type ?? undefined,
      bedrooms: r.bedrooms ?? undefined,
      bathrooms: r.bathrooms ?? undefined,
      landAreaSqm: r.land_area_sqm ?? undefined,
      excludeAddress: r.raw_address,
    });
    if (!result || result.priceSource !== 'comparables') {
      console.log(`${r.sale_price}\t—\t—\t—\t${r.raw_address} (no comparables estimate)`);
      continue;
    }
    estimated++;
    const err = (result.priceMid - r.sale_price) / r.sale_price;
    errors.push(Math.abs(err));
    const crossChecks = (result as { crossChecks?: Array<{ label: string; flagged: boolean }> }).crossChecks ?? [];
    const suburbFlagged = crossChecks.find((c) => c.label === 'Suburb median')?.flagged ?? false;
    if (suburbFlagged) flagCount++;
    console.log(
      `${r.sale_price}\t${result.priceMid}\t${(err * 100).toFixed(1)}%\t${suburbFlagged ? 'FLAG' : 'ok'}\t${r.raw_address}`,
    );
  }

  errors.sort((a, b) => a - b);
  const medianAbsErr = errors.length ? errors[Math.floor(errors.length / 2)] : NaN;
  console.log(`\nProperties estimated: ${estimated}/${sample.length}`);
  console.log(`Median absolute error: ${(medianAbsErr * 100).toFixed(1)}%`);
  console.log(`Suburb-median flag rate: ${estimated ? ((flagCount / estimated) * 100).toFixed(0) : '—'}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
