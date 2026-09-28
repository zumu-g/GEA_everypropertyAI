import { describe, it, expect } from 'vitest';
import { selectFilter, findListedDate, planBatches, backfill, PROBE_SIZE } from './backfill-listed-dates.mjs';

const row = (i, suburb = 'Berwick') => ({ id: `L${i}`, listing_url: `https://www.realestate.com.au/property-house-vic-berwick-${i}`, suburb, raw_address: `${i} Smith St, ${suburb} VIC` });

/** Fake PostgREST + Apify behind one fetch. `items` is what the actor dataset returns per run. */
function fake({ rows, items }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    const ok = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/rest/v1/property_listings') && method === 'GET') {
      const offset = Number(new URL(url).searchParams.get('offset') || 0);
      return ok(rows.slice(offset, offset + 1000));
    }
    if (url.includes('/rest/v1/property_listings') && method === 'PATCH') return ok([{ id: 'x' }]);
    if (url.includes('/rest/v1/feed_runs')) return ok([]);
    if (url.includes('/acts/')) return ok({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } });
    if (url.includes('/datasets/')) {
      const n = calls.filter((c) => c.url.includes('/acts/')).length;
      const urls = calls.filter((c) => c.url.includes('/acts/'))[n - 1].body.property_inputs;
      return ok(urls.map((u) => items(u)));
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'k', APIFY_API_TOKEN: 't' };
  return { fetch, calls, env, actorStarts: () => calls.filter((c) => c.url.includes('/acts/')), patches: () => calls.filter((c) => c.method === 'PATCH'), feedRun: () => calls.find((c) => c.url.includes('feed_runs'))?.body };
}

describe('selectFilter', () => {
  it('restricts to active REA rows with null listed_date in the five VIC suburbs', () => {
    const f = selectFilter();
    expect(f).toContain('source=eq.rea-apify-one-api');
    expect(f).toContain('active=eq.true');
    expect(f).toContain('listed_date=is.null');
    expect(f).toContain('state=eq.VIC');
    expect(f).toContain('listing_url=not.is.null');
    expect(decodeURIComponent(f)).toContain('suburb=in.("Berwick","Officer","Clyde North","Narre Warren","Pakenham")');
  });
});

describe('findListedDate', () => {
  it('reads plausible key shapes and normalises to an ISO date', () => {
    expect(findListedDate({ 'Listed Date': '10 Jan 2026' })).toBe('2026-01-10');
    expect(findListedDate({ dateListed: '2026-01-10T03:00:00.000Z' })).toBe('2026-01-10');
    expect(findListedDate({ first_seen: '10/01/2026' })).toBe('2026-01-10');
    expect(findListedDate({ details: { datePosted: '2026-02-01' } })).toBe('2026-02-01');
  });
  it('returns null when no date key or the value is not a date', () => {
    expect(findListedDate({ Price: '$800,000', Beds: 3 })).toBeNull();
    expect(findListedDate({ listedAt: 'recently' })).toBeNull();
    expect(findListedDate(null)).toBeNull();
  });
});

describe('planBatches', () => {
  it('splits into a probe then capped batches and reports the remainder', () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i));
    const p = planBatches(rows, { max: 120, batch: 50 });
    expect(p.probe).toHaveLength(PROBE_SIZE);
    expect(p.batches.map((b) => b.length)).toEqual([50, 50]);
    expect(p.remaining).toBe(130);
  });
});

describe('backfill', () => {
  it('probe without a date field stops after one actor call with a probe-negative feed_runs row', async () => {
    const db = fake({ rows: Array.from({ length: 60 }, (_, i) => row(i)), items: (u) => ({ 'Listing URL': u, Price: '$1' }) });
    const out = await backfill({ fetch: db.fetch, env: db.env, runStart: '2026-09-28T00:00:00.000Z' });
    expect(out.status).toBe('probe-negative');
    expect(db.actorStarts()).toHaveLength(1);
    expect(db.patches()).toHaveLength(0);
    expect(db.feedRun()).toMatchObject({ category: 'listed-date-backfill', source: 'rea-apify-one-api', status: 'probe-negative', fetched: PROBE_SIZE });
    expect(db.feedRun().notes.keys).toContain('Price');
  });

  it('probe with a date field continues, writes guarded PATCHes and stops at the cap', async () => {
    const db = fake({ rows: Array.from({ length: 60 }, (_, i) => row(i)), items: (u) => ({ 'Listing URL': u, 'Listed Date': '10 Jan 2026' }) });
    const out = await backfill({ fetch: db.fetch, env: db.env, runStart: '2026-09-28T00:00:00.000Z', maxItems: 40, batchSize: 20 });
    expect(out.status).toBe('ok');
    expect(db.actorStarts()).toHaveLength(2); // probe + one batch
    expect(out.fetched).toBe(40);
    expect(out.remaining).toBe(20);
    const p = db.patches()[0];
    expect(p.url).toContain('listed_date=is.null');
    expect(p.body).toEqual({ listed_date: '2026-01-10', listed_date_source: 'rea-detail' });
    expect(db.feedRun()).toMatchObject({ status: 'ok', fetched: 40, dated: 40, failed: 0, est_cost_usd: 0.12 });
  });

  it('dry-run selects and plans but starts no actor and writes nothing', async () => {
    const db = fake({ rows: Array.from({ length: 30 }, (_, i) => row(i)), items: () => ({}) });
    const out = await backfill({ fetch: db.fetch, env: db.env, dryRun: true });
    expect(out).toMatchObject({ status: 'dry-run', candidates: 30 });
    expect(db.actorStarts()).toHaveLength(0);
    expect(db.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
