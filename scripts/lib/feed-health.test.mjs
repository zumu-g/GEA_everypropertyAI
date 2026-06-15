import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { writeFeedHealth, deriveStatus, fetchNewestRowAt } from './feed-health.mjs';

const CFG = { supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc-key' };

describe('deriveStatus', () => {
  it('returns blocked when blocked, regardless of items', () => {
    expect(deriveStatus({ blocked: true, items: 0 })).toBe('blocked');
    expect(deriveStatus({ blocked: true, items: 5 })).toBe('blocked');
  });
  it('returns ok for a normal run, including zero-yield', () => {
    expect(deriveStatus({ blocked: false, items: 42 })).toBe('ok');
    expect(deriveStatus({ blocked: false, items: 0 })).toBe('ok');
  });
});

describe('writeFeedHealth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('upserts to feed_health with on_conflict=category and merge-duplicates', async () => {
    const ok = await writeFeedHealth(CFG, {
      category: 'sold', source_used: 'domain-web-unlocker', items: 12,
      newest_row_at: '2026-06-16T00:00:00Z', status: 'ok',
    });
    expect(ok).toBe(true);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/rest/v1/feed_health?on_conflict=category');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Prefer).toContain('resolution=merge-duplicates');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ category: 'sold', items: 12, status: 'ok', source_used: 'domain-web-unlocker' });
    expect(body.last_run_at).toBeTruthy();
  });

  it('writes items=0 with status=ok for a zero-yield run (no blocked)', async () => {
    await writeFeedHealth(CFG, { category: 'on-market', items: 0, status: 'ok' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.items).toBe(0);
    expect(body.status).toBe('ok');
  });

  it('writes status=blocked when the run was blocked', async () => {
    await writeFeedHealth(CFG, { category: 'sold', items: 0, status: 'blocked' });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.status).toBe('blocked');
  });

  it('returns false and does not throw when Supabase returns non-2xx', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });
    await expect(writeFeedHealth(CFG, { category: 'sold', items: 1, status: 'ok' })).resolves.toBe(false);
  });

  it('no-ops without creds (does not crash the run)', async () => {
    const ok = await writeFeedHealth({}, { category: 'sold', items: 1, status: 'ok' });
    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('swallows a fetch rejection and resolves false', async () => {
    fetch.mockRejectedValueOnce(new Error('down'));
    await expect(writeFeedHealth(CFG, { category: 'sold', items: 1, status: 'ok' })).resolves.toBe(false);
  });
});

describe('fetchNewestRowAt', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('returns the newest created_at from the table', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [{ created_at: '2026-06-16T01:02:03Z' }] });
    const v = await fetchNewestRowAt(CFG, 'property_sales');
    expect(v).toBe('2026-06-16T01:02:03Z');
    expect(fetch.mock.calls[0][0]).toContain('property_sales?select=created_at&order=created_at.desc&limit=1');
  });

  it('returns null when the table is empty', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [] });
    await expect(fetchNewestRowAt(CFG, 'property_listings')).resolves.toBeNull();
  });

  it('returns null (no throw) on error', async () => {
    fetch.mockRejectedValueOnce(new Error('down'));
    await expect(fetchNewestRowAt(CFG, 'property_sales')).resolves.toBeNull();
  });

  it('returns null without creds', async () => {
    await expect(fetchNewestRowAt({}, 'property_sales')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
