import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { pingUrl, pingStart, pingSuccess, pingFail } from './healthcheck.mjs';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('pingUrl', () => {
  it('builds the bare success URL', () => {
    expect(pingUrl(UUID)).toBe(`https://hc-ping.com/${UUID}`);
  });
  it('appends start/fail suffixes', () => {
    expect(pingUrl(UUID, 'start')).toBe(`https://hc-ping.com/${UUID}/start`);
    expect(pingUrl(UUID, 'fail')).toBe(`https://hc-ping.com/${UUID}/fail`);
  });
  it('returns null for a missing uuid (no-op)', () => {
    expect(pingUrl(undefined)).toBeNull();
    expect(pingUrl('')).toBeNull();
  });
});

describe('ping functions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pingStart hits the /start endpoint', async () => {
    await pingStart(UUID);
    expect(fetch).toHaveBeenCalledWith(
      `https://hc-ping.com/${UUID}/start`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('pingSuccess hits the bare endpoint and POSTs the body', async () => {
    await pingSuccess(UUID, 'items=42');
    expect(fetch).toHaveBeenCalledWith(
      `https://hc-ping.com/${UUID}`,
      expect.objectContaining({ method: 'POST', body: 'items=42' }),
    );
  });

  it('pingFail hits the /fail endpoint', async () => {
    await pingFail(UUID, 'boom');
    expect(fetch).toHaveBeenCalledWith(
      `https://hc-ping.com/${UUID}/fail`,
      expect.objectContaining({ method: 'POST', body: 'boom' }),
    );
  });

  it('no-ops (does not fetch) when the uuid is unset', async () => {
    const result = await pingSuccess(undefined, 'x');
    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('swallows fetch rejection and resolves false (monitor outage must not break the run)', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));
    await expect(pingSuccess(UUID, 'x')).resolves.toBe(false);
  });

  it('resolves false on a non-2xx response without throwing', async () => {
    fetch.mockResolvedValueOnce({ ok: false });
    await expect(pingStart(UUID)).resolves.toBe(false);
  });
});
