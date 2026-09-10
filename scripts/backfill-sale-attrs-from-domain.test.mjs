import { describe, it, expect, beforeAll } from 'vitest';

// The script exits at import time without these; values are never used here.
let mod;
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x';
  process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN ||= 'x';
  mod = await import('./backfill-sale-attrs-from-domain.mjs');
});

describe('targetsQuery — the nightly drip must advance', () => {
  it('skips vacant land, which can never gain bedrooms', () => {
    const q = mod.targetsQuery();
    expect(q).toContain('property_type=not.in.("VacantLand","Vacant land","New land")');
  });

  it('skips rows already fetched-and-marked so the same rows are not refetched nightly', () => {
    const q = mod.targetsQuery();
    expect(q).toContain(`raw_data->>${mod.CHECKED_KEY}=is.null`);
    expect(q).toContain('select=');
    expect(q).toMatch(/select=[^&]*\braw_data\b/);
  });

  it('keeps the original null-bed + most-recent-first selection', () => {
    const q = mod.targetsQuery({ suburb: 'Clyde North' });
    expect(q).toContain('bedrooms=is.null&listing_url=not.is.null');
    expect(q).toContain('order=sale_date.desc');
    expect(q).toContain('suburb=ilike.Clyde%20North');
  });
});

describe('extractAttrs', () => {
  it('returns no bedrooms for a land listing (beds:0 junk is rejected)', () => {
    const out = mod.extractAttrs({ props: { pageProps: { listing: { beds: 0, baths: 0, landSize: '830.0 sqm' } } } });
    expect(out.bedrooms).toBeNull();
  });
});
