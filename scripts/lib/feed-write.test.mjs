import { describe, it, expect, vi } from 'vitest';
import { writeFeedBatch, sweepSource, recordRun, assertMigration } from './feed-write.mjs';

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const SRC = 'rea-apify';
const RUN = '2026-09-28T04:00:00.000Z';
const hoursBefore = (iso, h) => new Date(new Date(iso).getTime() - h * 3600_000).toISOString();
const hoursAfter = (iso, h) => hoursBefore(iso, -h);

// ─── Minimal in-memory PostgREST: enough of the filter grammar for this module ─
function splitIn(s) {
  // "(a,"b, c",d)" → ['a','b, c','d']
  const out = []; let cur = '', q = false;
  for (const ch of s.slice(1, -1)) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || out.length) out.push(cur);
  return out;
}
function cmp(a, b) {
  const na = Number(a), nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function test1(row, col, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot), val = expr.slice(dot + 1);
  const v = row[col];
  switch (op) {
    case 'eq': return String(v) === val;
    case 'neq': return String(v) !== val;
    case 'lt': return v != null && cmp(v, val) < 0;
    case 'gte': return v != null && cmp(v, val) >= 0;
    case 'is': return val === 'null' ? v == null : String(v) === val;
    case 'in': return splitIn(val).includes(String(v));
    default: throw new Error(`fake postgrest: unsupported op ${op}`);
  }
}
function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.slice(1, -1).split(',');
      if (!parts.some((p) => { const [col, ...rest] = p.split('.'); return test1(row, col, rest.join('.')); })) return false;
      continue;
    }
    if (!test1(row, k, v)) return false;
  }
  return true;
}
function fakeDb(seed = {}) {
  const tables = { property_listings: [], property_rentals: [], listing_price_history: [], feed_runs: [], ...seed };
  const calls = [];
  let nextId = 1;
  const fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const method = opts.method || 'GET';
    calls.push({ method, table, url: decodeURIComponent(u.search), body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    const rows = tables[table];
    if (!rows) return { ok: false, status: 404, text: async () => 'no table' };
    const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, u.searchParams));
      const order = u.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[col], b[col])); }
      const lim = u.searchParams.get('limit');
      if (lim) out = out.slice(0, Number(lim));
      return json(out);
    }
    if (method === 'POST') {
      const body = Array.isArray(opts.body ? JSON.parse(opts.body) : []) ? JSON.parse(opts.body) : [JSON.parse(opts.body)];
      const conflict = u.searchParams.get('on_conflict')?.split(',');
      const keys = new Set(body.flatMap((o) => Object.keys(o)));
      for (const o of body) if (Object.keys(o).length !== keys.size) return { ok: false, status: 400, text: async () => 'All object keys must match' };
      for (const o of body) {
        const hit = conflict && rows.find((r) => conflict.every((c) => String(r[c]) === String(o[c])));
        if (hit) Object.assign(hit, o);
        else rows.push({ id: nextId++, created_at: new Date().toISOString(), lifecycle_status: 'active', miss_count: 0, sale_method: 'unknown', active: true, ...o });
      }
      return json([]);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const hit = rows.filter((r) => matches(r, u.searchParams));
      for (const r of hit) Object.assign(r, patch);
      return json(hit.map((r) => ({ ...r })));
    }
    return { ok: false, status: 405, text: async () => 'nope' };
  });
  return { tables, calls, fetch };
}

const listing = (addr, price, extra = {}) => ({
  raw_address: addr, suburb: 'Berwick', state: 'VIC', postcode: '3806', source: SRC,
  display_price: price, listing_url: `https://rea/${encodeURIComponent(addr)}`, status: null, ...extra,
});
const write = (db, rows, over = {}) => writeFeedBatch({ table: 'property_listings', source: SRC, runStart: RUN, rows, fetch: db.fetch, env: ENV, ...over });
const sweep = (db, over = {}) => sweepSource({ table: 'property_listings', source: SRC, runStart: RUN, coverage: { Berwick: { seen: 100 } }, fetch: db.fetch, env: ENV, ...over });
const activeIn = (db, table = 'property_listings') => db.tables[table].filter((r) => r.active);

describe('writeFeedBatch — stamping and price history', () => {
  it('3 new rows → 3 history rows, every payload stamped with last_seen_at = run start', async () => {
    const db = fakeDb();
    const res = await write(db, [listing('1 A St, Berwick VIC 3806', '$800,000'), listing('2 A St, Berwick VIC 3806', '$850,000 - $900,000'), listing('3 A St, Berwick VIC 3806', 'Contact agent')]);
    expect(res).toMatchObject({ seen: 3, newRows: 3, priced: 3 });
    expect(db.tables.listing_price_history).toHaveLength(3);
    const up = db.calls.find((c) => c.method === 'POST' && c.table === 'property_listings');
    expect(up.url).toContain('on_conflict=raw_address,source');
    expect(up.headers.Prefer).toBe('resolution=merge-duplicates,missing=default,return=minimal');
    for (const p of up.body) {
      expect(p).toMatchObject({ last_seen_at: RUN, active: true, miss_count: 0, miss_marked_at: null, lifecycle_status: 'active', campaign_started_at: RUN, removed_at: null });
    }
    expect(up.body.map((p) => p.sale_method)).toEqual(['private', 'private', 'unknown']);
    expect(db.tables.listing_price_history[1]).toMatchObject({ table_name: 'listings', source: SRC, price_low: 850000, price_high: 900000, display_price: '$850,000 - $900,000', observed_at: RUN });
  });

  it('parsed price equal to the latest history row writes nothing; spacing differences compare equal', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', '$850,000-$900,000')]);
    const r2 = await write(db, [listing('1 A St, Berwick VIC 3806', '$850,000 - $900,000')], { runStart: hoursAfter(RUN, 24) });
    expect(r2).toMatchObject({ newRows: 0, priced: 0 });
    expect(db.tables.listing_price_history).toHaveLength(1);
  });

  it('a changed parsed price writes one history row with the new low/high', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', '$850,000 - $900,000')]);
    await write(db, [listing('1 A St, Berwick VIC 3806', '$820,000 - $870,000')], { runStart: hoursAfter(RUN, 24) });
    expect(db.tables.listing_price_history).toHaveLength(2);
    expect(db.tables.listing_price_history[1]).toMatchObject({ price_low: 820000, price_high: 870000 });
  });

  it('unparsed text only diffs against unparsed text: auction date drift writes nothing, wording change does', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', 'Auction Sat 6 Jun')]);
    await write(db, [listing('1 A St, Berwick VIC 3806', 'Auction Sat 13 Jun')], { runStart: hoursAfter(RUN, 24) });
    expect(db.tables.listing_price_history).toHaveLength(1);
    await write(db, [listing('1 A St, Berwick VIC 3806', 'Contact agent')], { runStart: hoursAfter(RUN, 48) });
    expect(db.tables.listing_price_history).toHaveLength(2);
  });

  it('rows mapped sold or under_offer are not diffed (but a brand-new one still gets first sight)', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', '$800,000')]);
    await write(db, [listing('1 A St, Berwick VIC 3806', '$790,000', { status: 'Sold' }), listing('2 A St, Berwick VIC 3806', '$500,000', { status: 'Under Offer' })], { runStart: hoursAfter(RUN, 24) });
    expect(db.tables.listing_price_history).toHaveLength(2);
    expect(db.tables.listing_price_history.map((h) => h.raw_address)).toEqual(['1 A St, Berwick VIC 3806', '2 A St, Berwick VIC 3806']);
    const row1 = db.tables.property_listings.find((r) => r.raw_address.startsWith('1 A'));
    expect(row1.lifecycle_status).toBe('sold');
  });

  it('a row with no listing URL still gets history keyed on address and source', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', '$800,000', { listing_url: null })]);
    expect(db.tables.listing_price_history[0]).toMatchObject({ raw_address: '1 A St, Berwick VIC 3806', source: SRC, listing_url: null });
  });

  it('quotes and URL-encodes addresses with commas/parentheses in the identity lookup', async () => {
    const db = fakeDb();
    await write(db, [listing('Lot 2 (rear), 5 A St, Berwick VIC 3806', '$800,000')]);
    const get = db.calls.find((c) => c.method === 'GET' && c.table === 'property_listings');
    expect(get.url).toContain('raw_address=in.("Lot 2 (rear), 5 A St, Berwick VIC 3806")');
    expect(db.tables.listing_price_history).toHaveLength(1);
    // Second write finds it (no duplicate history)
    await write(db, [listing('Lot 2 (rear), 5 A St, Berwick VIC 3806', '$800,000')], { runStart: hoursAfter(RUN, 24) });
    expect(db.tables.listing_price_history).toHaveLength(1);
  });

  it('rentals: weekly_rent lands in price_low/price_high and payloads carry leased_at, never removed_at', async () => {
    const db = fakeDb();
    await writeFeedBatch({ table: 'property_rentals', source: 'domain-web-unlocker', runStart: RUN, fetch: db.fetch, env: ENV,
      rows: [{ raw_address: '9 B St, Berwick VIC 3806', suburb: 'Berwick', state: 'VIC', source: 'domain-web-unlocker', display_price: '$550 per week', weekly_rent: 550, status: null }] });
    expect(db.tables.listing_price_history[0]).toMatchObject({ table_name: 'rentals', price_low: 550, price_high: 550 });
    const p = db.calls.find((c) => c.method === 'POST' && c.table === 'property_rentals').body[0];
    expect(p.leased_at).toBeNull();
    expect('removed_at' in p).toBe(false);
    expect('sale_method' in p).toBe(false);
  });
});

describe('writeFeedBatch — listed_date carry-forward', () => {
  it('a null incoming listed_date never overwrites a stored one; the stored source rides along', async () => {
    const db = fakeDb({ property_listings: [{ id: 1, raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', source: SRC, active: true, campaign_started_at: RUN, listed_date: '2026-09-01', listed_date_source: 'portal' }] });
    await write(db, [listing('1 A St, Berwick VIC 3806', '$800,000', { listed_date: null, listed_date_source: null })]);
    const sel = db.calls.find((c) => c.method === 'GET' && c.table === 'property_listings');
    expect(sel.url).toMatch(/select=[^&]*listed_date,listed_date_source/);
    expect(db.tables.property_listings[0]).toMatchObject({ listed_date: '2026-09-01', listed_date_source: 'portal' });
  });
  it('a non-null incoming listed_date wins', async () => {
    const db = fakeDb({ property_listings: [{ id: 1, raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', source: SRC, active: true, campaign_started_at: RUN, listed_date: '2026-09-01', listed_date_source: 'portal' }] });
    await write(db, [listing('1 A St, Berwick VIC 3806', '$800,000', { listed_date: '2026-09-20', listed_date_source: 'first_seen' })]);
    expect(db.tables.property_listings[0]).toMatchObject({ listed_date: '2026-09-20', listed_date_source: 'first_seen' });
  });
});

describe('writeFeedBatch — reopen (AE5) and sticky auction', () => {
  it('a closed row seen again reopens with a new campaign start and cleared removal', async () => {
    const march = '2026-03-10T04:00:00.000Z';
    const db = fakeDb({ property_listings: [{ id: 1, raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', source: SRC, active: false, lifecycle_status: 'withdrawn', miss_count: 2, miss_marked_at: march, removed_at: march, campaign_started_at: '2026-01-10T00:00:00.000Z', sale_method: 'auction', auction_date: '2026-02-20' }] });
    const res = await write(db, [listing('1 A St, Berwick VIC 3806', 'Contact agent')]);
    expect(res.reopened).toBe(1);
    const row = db.tables.property_listings[0];
    expect(row).toMatchObject({ active: true, miss_count: 0, miss_marked_at: null, removed_at: null, campaign_started_at: RUN, lifecycle_status: 'active' });
    expect(row.sale_method).toBe('unknown'); // a reopen starts a fresh campaign: auction does not carry over
    expect(row.auction_date).toBeNull();
  });

  it('a still-open row keeps campaign_started_at; auction sticks when the text later says "Contact agent"', async () => {
    const db = fakeDb();
    await write(db, [listing('1 A St, Berwick VIC 3806', 'Auction Sat 14 Nov')]);
    const before = db.tables.property_listings[0];
    expect(before).toMatchObject({ sale_method: 'auction', auction_date: '2026-11-14', campaign_started_at: RUN });
    await write(db, [listing('1 A St, Berwick VIC 3806', 'Contact agent')], { runStart: hoursAfter(RUN, 24) });
    const after = db.tables.property_listings[0];
    expect(after).toMatchObject({ sale_method: 'auction', auction_date: '2026-11-14', campaign_started_at: RUN, last_seen_at: hoursAfter(RUN, 24) });
  });
});

describe('sweepSource', () => {
  const seeded = (over = {}) => ({ id: 1, raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', state: 'VIC', source: SRC, active: true, lifecycle_status: 'active', miss_count: 0, miss_marked_at: null, removed_at: null, last_seen_at: hoursBefore(RUN, 24 * 7), ...over });

  it('miss 0 with stale last_seen_at → miss 1, still active, miss_marked_at stamped', async () => {
    const db = fakeDb({ property_listings: [seeded()] });
    const res = await sweep(db);
    expect(res).toMatchObject({ miss1: 1, closed: 0, skippedSuburbs: [] });
    expect(db.tables.property_listings[0]).toMatchObject({ active: true, miss_count: 1, miss_marked_at: RUN, removed_at: null });
  });

  it('a row seen this run is not touched', async () => {
    const db = fakeDb({ property_listings: [seeded({ last_seen_at: RUN })] });
    const res = await sweep(db);
    expect(res.miss1).toBe(0);
    expect(db.tables.property_listings[0].miss_count).toBe(0);
  });

  it('miss 1 marked a week ago closes: inactive, removed_at = run start, withdrawn; sold stays sold', async () => {
    const db = fakeDb({ property_listings: [
      seeded({ id: 1, miss_count: 1, miss_marked_at: hoursBefore(RUN, 24 * 7) }),
      seeded({ id: 2, raw_address: '2 A St, Berwick VIC 3806', miss_count: 1, miss_marked_at: hoursBefore(RUN, 24 * 7), lifecycle_status: 'sold' }),
      seeded({ id: 3, raw_address: '3 A St, Berwick VIC 3806', miss_count: 1, miss_marked_at: hoursBefore(RUN, 24 * 7), lifecycle_status: 'under_offer' }),
    ] });
    const res = await sweep(db);
    expect(res).toMatchObject({ miss1: 0, closed: 3 });
    const [a, b, c] = db.tables.property_listings;
    expect(a).toMatchObject({ active: false, removed_at: RUN, lifecycle_status: 'withdrawn', miss_count: 2 });
    expect(b).toMatchObject({ active: false, removed_at: RUN, lifecycle_status: 'sold' });
    expect(c).toMatchObject({ active: false, removed_at: RUN, lifecycle_status: 'withdrawn' });
  });

  it('two sweeps thirty minutes apart leave an unseen row at miss 1', async () => {
    const db = fakeDb({ property_listings: [seeded()] });
    await sweep(db);
    const res = await sweep(db, { runStart: hoursAfter(RUN, 0.5) });
    expect(res).toMatchObject({ miss1: 0, closed: 0 });
    expect(db.tables.property_listings[0]).toMatchObject({ active: true, miss_count: 1, miss_marked_at: RUN });
  });

  it('coverage guard: truncated suburb or seen under half of active is skipped and named', async () => {
    const db = fakeDb({ property_listings: [
      seeded({ id: 1 }), seeded({ id: 2, raw_address: '2 A St, Berwick VIC 3806' }), seeded({ id: 3, raw_address: '3 A St, Berwick VIC 3806' }), seeded({ id: 4, raw_address: '4 A St, Berwick VIC 3806' }),
      seeded({ id: 5, raw_address: '1 C St, Clyde VIC 3978', suburb: 'Clyde' }),
      seeded({ id: 6, raw_address: '1 D St, Cranbourne VIC 3977', suburb: 'Cranbourne' }),
    ] });
    const res = await sweep(db, { coverage: { Berwick: { seen: 1 }, Clyde: { seen: 5, truncated: true }, Cranbourne: { seen: 1 } } });
    expect(res.skippedSuburbs).toEqual([
      { suburb: 'Berwick', reason: 'low-coverage', seen: 1, active: 4 },
      { suburb: 'Clyde', reason: 'truncated', seen: 5, active: 1 },
    ]);
    expect(res.sweptSuburbs).toEqual(['Cranbourne']);
    expect(db.tables.property_listings.filter((r) => r.miss_count === 1).map((r) => r.suburb)).toEqual(['Cranbourne']);
  });

  it('never touches another source or an uncovered suburb (filter string asserted)', async () => {
    const db = fakeDb({ property_listings: [
      seeded({ id: 1 }),
      seeded({ id: 2, raw_address: '1 X St, Berwick VIC 3806', source: 'domain-web-unlocker' }),
      seeded({ id: 3, raw_address: '1 C St, Clyde VIC 3978', suburb: 'Clyde' }),
    ] });
    await sweep(db);
    const patches = db.calls.filter((c) => c.method === 'PATCH');
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) {
      expect(p.url).toContain(`source=eq.${SRC}`);
      expect(p.url).toContain('suburb=in.("Berwick")');
      expect(p.url).toContain('active=eq.true');
      expect(p.url).toContain(`last_seen_at=lt.${RUN}`);
      expect(p.url).toContain(`or=(miss_marked_at.is.null,miss_marked_at.lt.${hoursBefore(RUN, 20)})`);
    }
    expect(db.tables.property_listings.map((r) => r.miss_count)).toEqual([1, 0, 0]);
  });

  it('rentals close with leased_at and never removed_at', async () => {
    const db = fakeDb({ property_rentals: [seeded({ miss_count: 1, miss_marked_at: hoursBefore(RUN, 24 * 7) })] });
    delete db.tables.property_rentals[0].removed_at;
    const res = await sweep(db, { table: 'property_rentals' });
    expect(res.closed).toBe(1);
    const r = db.tables.property_rentals[0];
    expect(r).toMatchObject({ active: false, leased_at: RUN, lifecycle_status: 'withdrawn' });
    expect('removed_at' in r).toBe(false);
  });

  it('AE1: three full sweeps and four new-only runs remove only after the third full sweep', async () => {
    const db = fakeDb();
    const day = (d, h = 4) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
    const row = listing('1 A St, Berwick VIC 3806', '$800,000');
    // Monday 7 Sep: full sweep sees it
    await write(db, [row], { runStart: day(7) });
    await sweep(db, { runStart: day(7) });
    // Tue–Fri new-only runs: nothing to write for this row, no sweep
    for (const d of [8, 9, 10, 11]) await write(db, [], { runStart: day(d) });
    expect(db.tables.property_listings[0]).toMatchObject({ active: true, miss_count: 0 });
    // Monday 14 Sep: full sweep, absent → miss 1; a second full run the same day adds nothing
    await sweep(db, { runStart: day(14) });
    await sweep(db, { runStart: day(14, 9) });
    expect(db.tables.property_listings[0]).toMatchObject({ active: true, miss_count: 1, miss_marked_at: day(14) });
    for (const d of [15, 16, 17, 18]) await write(db, [], { runStart: day(d) });
    expect(db.tables.property_listings[0]).toMatchObject({ active: true, miss_count: 1 });
    // Monday 21 Sep: third full sweep → closed
    const res = await sweep(db, { runStart: day(21) });
    expect(res.closed).toBe(1);
    expect(db.tables.property_listings[0]).toMatchObject({ active: false, removed_at: day(21), lifecycle_status: 'withdrawn' });
  });
});

describe('recordRun and assertMigration', () => {
  it('recordRun posts one feed_runs row', async () => {
    const db = fakeDb();
    const ok = await recordRun({ category: 'on-market', source: SRC, mode: 'full', run_start: RUN, status: 'ok', seen: 10, closed: 1, notes: { skippedSuburbs: [] } }, { fetch: db.fetch, env: ENV });
    expect(ok).toBe(true);
    expect(db.tables.feed_runs[0]).toMatchObject({ category: 'on-market', source: SRC, seen: 10, closed: 1 });
    expect(db.tables.feed_runs[0].run_end).toBeTruthy();
  });

  it('recordRun never throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('down'));
    await expect(recordRun({ category: 'rent', source: SRC }, { fetch, env: ENV })).resolves.toBe(false);
  });

  it('assertMigration exits non-zero with the migration message when the column select fails', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"code":"42703","message":"column property_listings.lifecycle_status does not exist"}' });
    const exit = vi.fn(); const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await assertMigration({ table: 'property_listings', fetch, env: ENV, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls.flat().join(' ')).toContain('migration 015 not applied');
    expect(fetch.mock.calls[0][0]).toContain('select=lifecycle_status,miss_count,miss_marked_at,campaign_started_at');
    err.mockRestore();
  });

  it('assertMigration passes silently when the select works', async () => {
    const exit = vi.fn();
    await assertMigration({ table: 'property_rentals', fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }), env: ENV, exit });
    expect(exit).not.toHaveBeenCalled();
  });
});
