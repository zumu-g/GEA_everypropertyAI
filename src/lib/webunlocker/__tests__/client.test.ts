import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The client reads BRIGHTDATA_WEB_UNLOCKER_* at module load, so each test sets
// env then imports the module fresh via resetModules + dynamic import.
async function loadClient(env: { token?: string; zone?: string }) {
  vi.resetModules();
  if (env.token === undefined) delete process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN;
  else process.env.BRIGHTDATA_WEB_UNLOCKER_TOKEN = env.token;
  if (env.zone === undefined) delete process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE;
  else process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE = env.zone;
  return import('../client');
}

function mockResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe('scrapeWithWebUnlocker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a failed result when unconfigured, with no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { scrapeWithWebUnlocker, isWebUnlockerConfigured } = await loadClient({});
    expect(isWebUnlockerConfigured()).toBe(false);
    const r = await scrapeWithWebUnlocker('https://www.domain.com.au/sold-listings/berwick-vic-3806/', 'domain');
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns success with the rendered HTML on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, '<html>__NEXT_DATA__ listings</html>')));
    const { scrapeWithWebUnlocker } = await loadClient({ token: 't', zone: 'z' });
    const r = await scrapeWithWebUnlocker('https://www.domain.com.au/sold-listings/berwick-vic-3806/', 'domain');
    expect(r.status).toBe('success');
    expect(r.html).toContain('__NEXT_DATA__');
    expect(r.metadata?.backend).toBe('web-unlocker');
  });

  it('retries a transient 503 then succeeds', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(503, 'busy'))
      .mockResolvedValueOnce(mockResponse(200, '<html>ok</html>'));
    vi.stubGlobal('fetch', fetchSpy);
    const { scrapeWithWebUnlocker } = await loadClient({ token: 't', zone: 'z' });
    const r = await scrapeWithWebUnlocker('https://example.com/x', 'domain', { maxAttempts: 2 });
    expect(r.status).toBe('success');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-429 4xx and returns failed', async () => {
    const fetchSpy = vi.fn(async () => mockResponse(403, 'forbidden'));
    vi.stubGlobal('fetch', fetchSpy);
    const { scrapeWithWebUnlocker } = await loadClient({ token: 't', zone: 'z' });
    const r = await scrapeWithWebUnlocker('https://example.com/x', 'domain', { maxAttempts: 3 });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/HTTP 403/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns failed after exhausting retries on persistent 500s', async () => {
    const fetchSpy = vi.fn(async () => mockResponse(500, 'err'));
    vi.stubGlobal('fetch', fetchSpy);
    const { scrapeWithWebUnlocker } = await loadClient({ token: 't', zone: 'z' });
    const r = await scrapeWithWebUnlocker('https://example.com/x', 'domain', { maxAttempts: 2 });
    expect(r.status).toBe('failed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
