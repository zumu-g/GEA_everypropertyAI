import { describe, it, expect } from 'vitest';
import { pickSale, basisDate, salesSinceQuery, closedListingsQuery, reconcile } from './reconcile-lifecycle.mjs';

const day = (iso, n) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const closed = (over = {}) => ({
  id: 'L1', address_slug: 'vic-berwick-1-smith-st', lifecycle_status: 'withdrawn',
  listed_date: '2026-01-10T00:00:00Z', campaign_started_at: '2026-01-12T00:00:00Z', created_at: '2026-01-13T00:00:00Z',
  ...over,
});
const sale = (over = {}) => ({ id: 'S1', address_slug: 'vic-berwick-1-smith-st', sale_date: '2026-02-09', ...over });

describe('basisDate', () => {
  it('prefers listed_date, then campaign_started_at, then created_at', () => {
    expect(basisDate(closed())).toBe('2026-01-10');
    expect(basisDate(closed({ listed_date: null }))).toBe('2026-01-12');
    expect(basisDate(closed({ listed_date: null, campaign_started_at: null }))).toBe('2026-01-13');
  });
});

describe('pickSale', () => {
  it('withdrawn listing with a sale 30 days later on the same slug matches', () => {
    expect(pickSale(closed(), [sale({ sale_date: day('2026-01-10', 30) })])?.id).toBe('S1');
  });
  it('sale dated before the basis date does not match', () => {
    expect(pickSale(closed(), [sale({ sale_date: day('2026-01-10', -1) })])).toBeNull();
  });
  it('sale 500 days later does not match', () => {
    expect(pickSale(closed(), [sale({ sale_date: day('2026-01-10', 500) })])).toBeNull();
  });
  it('sale ingested today for a listing closed 300 days ago does match', () => {
    const l = closed({ listed_date: '2025-11-01T00:00:00Z', removed_at: '2025-12-02T00:00:00Z' });
    expect(pickSale(l, [sale({ sale_date: '2025-11-28', created_at: new Date().toISOString() })])?.id).toBe('S1');
  });
  it('never reclassifies an active listing', () => {
    expect(pickSale(closed({ lifecycle_status: 'active' }), [sale({ sale_date: day('2026-01-10', 30) })])).toBeNull();
  });
  it('ignores sales on other slugs and picks the earliest eligible sale', () => {
    const sales = [sale({ id: 'other', address_slug: 'x' }), sale({ id: 'late', sale_date: '2026-03-01' }), sale({ id: 'early', sale_date: '2026-02-01' })];
    expect(pickSale(closed(), sales)?.id).toBe('early');
  });
});

describe('selection filters', () => {
  it('sales since the watermark carry a slug and a sale_date, bounded page', () => {
    const q = salesSinceQuery('2026-09-01T00:00:00.000Z', 0);
    expect(q).toContain('property_sales?select=id,address_slug,sale_date');
    expect(q).toContain('created_at=gte.2026-09-01T00%3A00%3A00.000Z');
    expect(q).toContain('address_slug=not.is.null');
    expect(q).toMatch(/limit=\d+&offset=0/);
  });
  it('closed listings: withdrawn / under_offer / sold, removed or seen in the window', () => {
    const q = closedListingsQuery('2025-08-24T00:00:00.000Z', 0);
    expect(q).toContain('lifecycle_status=in.(withdrawn,under_offer,sold)');
    expect(q).toContain('or=(removed_at.gte.2025-08-24T00%3A00%3A00.000Z,last_seen_at.gte.2025-08-24T00%3A00%3A00.000Z)');
    expect(q).not.toContain('lifecycle_status=in.(active');
  });
});

describe('reconcile (fake PostgREST)', () => {
  function fakeDb(tables) {
    const calls = [];
    const fetch = async (url, init = {}) => {
      const u = new URL(url); const table = u.pathname.split('/').pop();
      calls.push({ method: init.method || 'GET', table, url: u.search, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'POST') return new Response(null, { status: 201 });
      if (init.method === 'PATCH') {
        const ids = decodeURIComponent(u.searchParams.get('id')).match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
        return Response.json(tables.property_listings.filter((r) => ids.includes(r.id)));
      }
      let rows = tables[table] || [];
      if (u.searchParams.has('offset') && u.searchParams.get('offset') !== '0') rows = [];
      if (u.searchParams.has('address_slug') && u.searchParams.get('address_slug').startsWith('in.')) {
        const slugs = decodeURIComponent(u.searchParams.get('address_slug')).match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
        rows = rows.filter((r) => slugs.includes(r.address_slug));
      }
      return Response.json(rows);
    };
    return { fetch, calls, env: { NEXT_PUBLIC_SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'k' } };
  }

  it('patches matched closed listings to sold and records one feed_runs row', async () => {
    const db = fakeDb({
      feed_runs: [{ run_start: '2026-09-20T00:00:00.000Z' }],
      property_sales: [sale({ sale_date: '2026-02-09' }), sale({ id: 'S2', address_slug: 'vic-berwick-2-smith-st', sale_date: '2026-02-09' })],
      property_listings: [closed(), closed({ id: 'L2', address_slug: 'vic-berwick-2-smith-st', lifecycle_status: 'active' }), closed({ id: 'L3', lifecycle_status: 'sold' })],
    });
    const out = await reconcile({ fetch: db.fetch, env: db.env, runStart: '2026-09-28T00:00:00.000Z' });
    expect(out.matched).toBe(1);
    const patches = db.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toContain('id=in.(%22L1%22)');
    expect(patches[0].url).toContain('lifecycle_status=neq.active');
    expect(patches[0].body).toEqual({ lifecycle_status: 'sold' });
    const runs = db.calls.filter((c) => c.method === 'POST' && c.table === 'feed_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].body).toMatchObject({ category: 'lifecycle-reconcile', source: 'reconcile', status: 'ok', seen: out.candidates, closed: 1 });
    expect(db.calls.find((c) => c.table === 'property_sales').url).toContain('created_at=gte.2026-09-20');
  });

  it('dry run issues no PATCH and no feed_runs row', async () => {
    const db = fakeDb({ feed_runs: [], property_sales: [sale()], property_listings: [closed()] });
    const out = await reconcile({ fetch: db.fetch, env: db.env, runStart: '2026-09-28T00:00:00.000Z', dryRun: true });
    expect(out.matched).toBe(1);
    expect(db.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
