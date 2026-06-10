import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-table fake rows the mocked Supabase client will return, set per test.
const tableRows: Record<string, unknown[]> = {};
let configured = true;

vi.mock('../supabase', () => ({
  isSupabaseConfigured: () => configured,
  getSupabaseServerClient: () => makeFakeClient(),
}));

/**
 * Minimal Supabase query-builder stub supporting the chain
 * `.from(t).select().eq().order().limit()` → Promise<{data,error}>.
 */
function makeFakeClient() {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: tableRows[table] ?? [], error: null }),
      };
      return builder;
    },
  };
}

import { getFeedSeedBySlug } from '../queries';

beforeEach(() => {
  configured = true;
  for (const k of Object.keys(tableRows)) delete tableRows[k];
});

describe('getFeedSeedBySlug', () => {
  it('returns the sold row with feed:"sold" when present', async () => {
    tableRows.property_sales = [{ address_slug: 's', sale_price: 1_200_000, bedrooms: 5 }];
    const seed = await getFeedSeedBySlug('s');
    expect(seed?.feed).toBe('sold');
    expect(seed?.row.sale_price).toBe(1_200_000);
  });

  it('prefers sold over on-market when both exist (precedence)', async () => {
    tableRows.property_sales = [{ sale_price: 900_000 }];
    tableRows.property_listings = [{ price_low: 800_000 }];
    const seed = await getFeedSeedBySlug('s');
    expect(seed?.feed).toBe('sold');
  });

  it('falls back to on-market when no sale exists', async () => {
    tableRows.property_listings = [{ price_low: 800_000 }];
    const seed = await getFeedSeedBySlug('s');
    expect(seed?.feed).toBe('on-market');
  });

  it('falls back to rent when only a rental exists', async () => {
    tableRows.property_rentals = [{ weekly_rent: 550 }];
    const seed = await getFeedSeedBySlug('s');
    expect(seed?.feed).toBe('rent');
  });

  it('returns null for an unknown slug (no throw)', async () => {
    expect(await getFeedSeedBySlug('missing')).toBeNull();
  });

  it('returns null when Supabase is unconfigured (fail-soft)', async () => {
    configured = false;
    tableRows.property_sales = [{ sale_price: 1 }];
    expect(await getFeedSeedBySlug('s')).toBeNull();
  });

  it('returns null for an empty slug', async () => {
    expect(await getFeedSeedBySlug('')).toBeNull();
  });
});
