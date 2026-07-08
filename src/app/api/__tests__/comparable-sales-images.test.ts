// Comparable-sales route: surfaces a thumbnail imageUrl per comparable.
// - property_cache path: first valid entry of raw_data.data.photos, which may
//   be plain URL strings or { url } objects (same contract as /api/proposal).
// - property_sales (VG) supplement path: passes image_url straight through.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Chainable Supabase query mock — every builder method returns the same
// thenable object so any call order resolves to `rows`.
function chainableQuery(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'order', 'limit', 'neq']) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

const cacheRows = [
  {
    address_slug: 'string-photo',
    cached_at: '2026-06-01',
    raw_data: {
      data: {
        address: { fullAddress: '1 String St, Berwick', suburb: 'Berwick' },
        saleHistory: [{ price: 700000, saleDate: '2026-05-01' }],
        photos: ['https://i2.au.reastatic.net/photo-a.jpg'],
      },
    },
  },
  {
    address_slug: 'object-photo',
    cached_at: '2026-06-01',
    raw_data: {
      data: {
        address: { fullAddress: '2 Object St, Berwick', suburb: 'Berwick' },
        saleHistory: [{ price: 710000, saleDate: '2026-05-02' }],
        photos: [{ url: 'https://rimh2.domainstatic.com.au/photo-b.jpg' }],
      },
    },
  },
  {
    address_slug: 'no-photo',
    cached_at: '2026-06-01',
    raw_data: {
      data: {
        address: { fullAddress: '3 Bare St, Berwick', suburb: 'Berwick' },
        saleHistory: [{ price: 720000, saleDate: '2026-05-03' }],
      },
    },
  },
];

vi.mock('@/lib/db/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseServerClient: () => ({ from: () => chainableQuery(cacheRows) }),
}));

vi.mock('@/lib/db/queries', () => ({
  getSalesForSuburb: async () => [
    {
      raw_address: '4 Vg St, Berwick',
      suburb: 'Berwick',
      state: 'VIC',
      sale_price: 730000,
      sale_date: '2026-05-04',
      image_url: 'https://cdn.homely.com.au/photo-c.jpg',
      source: 'vg',
    },
  ],
}));

describe('comparable-sales imageUrl', () => {
  it('surfaces imageUrl from raw_data photos (string and {url} forms), omits it when absent, and passes VG image_url through', async () => {
    const { GET } = await import('../comparable-sales/route');
    const res = await GET(
      new NextRequest(new URL('/api/comparable-sales?suburb=Berwick', 'http://localhost:3000')),
    );
    expect(res.status).toBe(200);
    const { comparables } = await res.json();
    const byAddress = Object.fromEntries(
      comparables.map((c: { address: string; imageUrl?: string }) => [c.address, c.imageUrl]),
    );
    expect(byAddress['1 String St, Berwick']).toBe('https://i2.au.reastatic.net/photo-a.jpg');
    expect(byAddress['2 Object St, Berwick']).toBe('https://rimh2.domainstatic.com.au/photo-b.jpg');
    expect(byAddress['3 Bare St, Berwick']).toBeUndefined();
    expect(byAddress['4 Vg St, Berwick']).toBe('https://cdn.homely.com.au/photo-c.jpg');
  });
});
