import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../map-static/route';

const req = (qs: string) => new NextRequest(`http://localhost/api/map-static${qs}`);

beforeEach(() => {
  process.env.MAPBOX_ACCESS_TOKEN = 'pk.test-token';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAPBOX_ACCESS_TOKEN;
});

describe('GET /api/map-static', () => {
  it('400s without lat/lng', async () => {
    const res = await GET(req(''));
    expect(res.status).toBe(400);
  });

  it('proxies the Mapbox static image with the token appended, muted style, and cache headers', async () => {
    let requested = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        requested = String(url);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }),
    );
    const res = await GET(req('?lat=-38.03&lng=145.34'));
    expect(res.status).toBe(200);
    expect(requested).toContain('light-v11'); // discrete/muted style
    expect(requested).toContain('access_token=pk.test-token');
    expect(requested).toContain('145.34,-38.03'); // lng,lat order
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
  });

  it('502s when Mapbox errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const res = await GET(req('?lat=-38&lng=145'));
    expect(res.status).toBe(502);
  });

  it('503s when the token is not configured', async () => {
    delete process.env.MAPBOX_ACCESS_TOKEN;
    const res = await GET(req('?lat=-38&lng=145'));
    expect(res.status).toBe(503);
  });
});
