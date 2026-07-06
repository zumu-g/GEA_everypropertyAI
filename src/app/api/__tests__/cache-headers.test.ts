// U3 regression coverage: public GET routes must carry the browser-caching
// header on success, and must NOT carry it on error responses. Supabase env
// vars are unset in the test process, so these routes exercise their
// in-memory/no-config fallback paths (still real 200 responses) rather than
// hitting a live database.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

function req(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

// enrich fans out to several live external services (geocoding, schools,
// transport, market data...) — mock them all so this test is fast and
// deterministic rather than exercising real network calls.
vi.mock('@/lib/enrichment/geocoding', () => ({ geocodeAddress: async () => null }));
vi.mock('@/lib/enrichment/planning', () => ({ fetchPlanningData: async () => null }));
vi.mock('@/lib/enrichment/schools', () => ({ fetchNearbySchools: async () => [] }));
vi.mock('@/lib/enrichment/transport', () => ({ fetchNearbyTransport: async () => [] }));
vi.mock('@/lib/enrichment/childcare', () => ({ fetchNearbyChildcare: async () => [] }));
vi.mock('@/lib/enrichment/suburb-stats', () => ({ fetchSuburbStats: async () => null }));
vi.mock('@/lib/enrichment/buyer-demand', () => ({ fetchBuyerDemand: async () => null }));
vi.mock('@/lib/enrichment/market-data', () => ({ fetchSuburbMarketData: async () => null }));

describe('browser cache headers on public GET routes', () => {
  it('comparable-sales: 200 (in-memory fallback) carries Cache-Control; 400 does not', async () => {
    const { GET } = await import('../comparable-sales/route');
    const ok = await GET(req('/api/comparable-sales?suburb=Berwick'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300, stale-while-revalidate=86400');

    const bad = await GET(req('/api/comparable-sales'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBeNull();
  });

  it('estimate: 200 carries Cache-Control; 400 does not', async () => {
    const { GET } = await import('../estimate/route');
    const ok = await GET(req('/api/estimate?suburb=Berwick'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300, stale-while-revalidate=86400');

    const bad = await GET(req('/api/estimate'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBeNull();
  });

  it('estimate-rent: 200 carries Cache-Control; 400 does not', async () => {
    const { GET } = await import('../estimate-rent/route');
    const ok = await GET(req('/api/estimate-rent?suburb=Berwick'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300, stale-while-revalidate=86400');

    const bad = await GET(req('/api/estimate-rent'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBeNull();
  });

  it('street-details: 200 (empty suggestions) carries Cache-Control; 400 does not', async () => {
    const { GET } = await import('../street-details/route');
    const ok = await GET(req('/api/street-details?q=NoSuchStreetXyz'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300, stale-while-revalidate=86400');

    const bad = await GET(req('/api/street-details?q=ab'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBeNull();
  });

  it('enrich: 200 carries Cache-Control; 400 does not', async () => {
    const { GET } = await import('../enrich/route');
    const ok = await GET(req('/api/enrich?suburb=Berwick&state=VIC&postcode=3806'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300, stale-while-revalidate=86400');

    const bad = await GET(req('/api/enrich'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('Cache-Control')).toBeNull();
  });

  it('guard: no auth/user/team/admin route imports the public-GET cache headers', () => {
    const apiDir = join(__dirname, '..');
    const gatedRoots = ['auth', 'user', 'team', 'admin'];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'route.ts') {
          const relative = full.slice(apiDir.length + 1);
          const topSegment = relative.split('/')[0];
          if (!gatedRoots.includes(topSegment)) continue;
          const contents = readFileSync(full, 'utf8');
          if (contents.includes('cache-headers') || contents.includes('PUBLIC_GET_CACHE_HEADERS')) {
            offenders.push(relative);
          }
        }
      }
    }
    walk(apiDir);

    expect(offenders).toEqual([]);
  });
});
