import { describe, it, expect } from 'vitest';
import { retire, retireFilter, retirePatch, UNSWEPT_SOURCES } from './retire-unswept-sources.mjs';

describe('retire-unswept-sources filter', () => {
  it('targets only ACTIVE rows of the two unswept sources', () => {
    expect(UNSWEPT_SOURCES).toEqual(['domain-apify', 'gea-legacy-db']);
    expect(retireFilter()).toBe('source=in.("domain-apify","gea-legacy-db")&active=eq.true');
  });
  it('closes as withdrawn with removed_at at the run start', () => {
    expect(retirePatch('2026-09-28T00:00:00.000Z')).toEqual({ active: false, removed_at: '2026-09-28T00:00:00.000Z', lifecycle_status: 'withdrawn' });
  });
});

describe('retire (fake PostgREST)', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const now = new Date('2026-09-28T00:00:00.000Z');
  function fakeDb() {
    const calls = [];
    const fetch = async (url, init = {}) => {
      const u = new URL(url);
      calls.push({ method: init.method || 'GET', table: u.pathname.split('/').pop(), search: decodeURIComponent(u.search), body: init.body ? JSON.parse(init.body) : null, signal: init.signal });
      if (init.method === 'POST') return new Response(null, { status: 201 });
      if (init.method === 'PATCH') return Response.json([{ id: 'a' }, { id: 'b' }]);
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/2' } });
    };
    return { fetch, calls };
  }

  it('dry run issues the count GET only — no PATCH, no feed_runs POST', async () => {
    const { fetch, calls } = fakeDb();
    expect(await retire({ apply: false, fetch, env, now })).toEqual({ total: 2, closed: 0 });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(calls[0].table).toBe('property_listings');
    expect(calls[0].search).toContain(retireFilter());
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('apply issues exactly one PATCH from retireFilter()/retirePatch() and one feed_runs POST', async () => {
    const { fetch, calls } = fakeDb();
    expect(await retire({ apply: true, fetch, env, now })).toEqual({ total: 2, closed: 2 });
    const patches = calls.filter((c) => c.method === 'PATCH');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(patches).toHaveLength(1);
    expect(patches[0].table).toBe('property_listings');
    expect(patches[0].search).toBe(`?${retireFilter()}`);
    expect(patches[0].body).toEqual(retirePatch(now.toISOString()));
    expect(patches[0].signal).toBeInstanceOf(AbortSignal);
    expect(posts).toHaveLength(1);
    expect(posts[0].table).toBe('feed_runs');
    expect(posts[0].body).toMatchObject({ category: 'on-market', mode: 'retire', closed: 2, run_start: now.toISOString() });
  });
});
