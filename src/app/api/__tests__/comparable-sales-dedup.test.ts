// Comparable-sales route: dedupes properties that appear in both the
// property_cache and Valuer-General (property_sales) sources so the same
// address never renders as two cards.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

function chainableQuery(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'order', 'limit', 'neq']) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function cacheRow(opts: {
  slug: string;
  address: string;
  price: number;
  saleDate: string;
  beds?: number;
  baths?: number;
  imageUrl?: string;
}) {
  return {
    address_slug: opts.slug,
    cached_at: '2026-06-01',
    raw_data: {
      data: {
        address: { fullAddress: opts.address, suburb: 'Narre Warren East' },
        saleHistory: [{ price: opts.price, saleDate: opts.saleDate }],
        bedrooms: opts.beds,
        bathrooms: opts.baths,
        photos: opts.imageUrl ? [opts.imageUrl] : undefined,
      },
    },
  };
}

describe('comparable-sales dedup', () => {
  it('dedupes the same property appearing in both property_cache and VG sources, keeping the richer record', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db/supabase', () => ({
      isSupabaseConfigured: () => true,
      getSupabaseServerClient: () => ({
        from: () =>
          chainableQuery([
            cacheRow({
              slug: 'dup',
              address: '22 Boundary Road, Narre Warren East VIC 3804',
              price: 1_500_000,
              saleDate: '2026-03-20',
              beds: 4,
              baths: 2,
              imageUrl: 'https://i2.au.reastatic.net/dup.jpg',
            }),
            cacheRow({
              slug: 'unique-cache',
              address: '5 Unique Ct, Narre Warren East VIC 3804',
              price: 1_200_000,
              saleDate: '2026-02-01',
            }),
          ]),
      }),
    }));
    vi.doMock('@/lib/db/queries', () => ({
      getSalesForSuburb: async () => [
        // Same property as the cache row above, different casing/punctuation,
        // no beds/baths/image — the VG record is the poorer duplicate.
        {
          raw_address: '22 boundary rd narre warren east vic 3804',
          suburb: 'Narre Warren East',
          state: 'VIC',
          sale_price: 1_500_000,
          sale_date: '2026-03-20',
        },
        {
          raw_address: '56 Edebohls Road, Narre Warren East VIC 3804',
          suburb: 'Narre Warren East',
          state: 'VIC',
          sale_price: 1_700_000,
          sale_date: '2026-03-20',
        },
      ],
    }));

    const { GET } = await import('../comparable-sales/route');
    const res = await GET(
      new NextRequest(new URL('/api/comparable-sales?suburb=Narre Warren East', 'http://localhost:3000')),
    );
    expect(res.status).toBe(200);
    const { comparables } = await res.json();

    const addresses = comparables.map((c: { address: string }) => c.address);
    const boundaryRoadCount = addresses.filter((a: string) =>
      a.toLowerCase().includes('boundary'),
    ).length;
    expect(boundaryRoadCount).toBe(1);

    // The richer (cache) record won, not the bare VG duplicate.
    const boundary = comparables.find((c: { address: string }) =>
      c.address.toLowerCase().includes('boundary'),
    );
    expect(boundary.imageUrl).toBe('https://i2.au.reastatic.net/dup.jpg');
    expect(boundary.beds).toBe(4);

    // Backfill: 3 unique properties among the candidates → all 3 returned.
    expect(comparables).toHaveLength(3);
    expect(addresses.some((a: string) => a.toLowerCase().includes('unique'))).toBe(true);
    expect(addresses.some((a: string) => a.toLowerCase().includes('edebohls'))).toBe(true);
  });

  it('returns all comparables unchanged when there are no duplicates', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db/supabase', () => ({
      isSupabaseConfigured: () => true,
      getSupabaseServerClient: () => ({
        from: () =>
          chainableQuery([
            cacheRow({ slug: 'a', address: '1 A St, Berwick VIC 3806', price: 700_000, saleDate: '2026-01-01' }),
            cacheRow({ slug: 'b', address: '2 B St, Berwick VIC 3806', price: 710_000, saleDate: '2026-01-02' }),
          ]),
      }),
    }));
    vi.doMock('@/lib/db/queries', () => ({
      getSalesForSuburb: async () => [
        {
          raw_address: '3 C St, Berwick VIC 3806',
          suburb: 'Berwick',
          state: 'VIC',
          sale_price: 720_000,
          sale_date: '2026-01-03',
        },
      ],
    }));

    const { GET } = await import('../comparable-sales/route');
    const res = await GET(
      new NextRequest(new URL('/api/comparable-sales?suburb=Berwick', 'http://localhost:3000')),
    );
    const { comparables } = await res.json();
    expect(comparables).toHaveLength(3);
  });
});
