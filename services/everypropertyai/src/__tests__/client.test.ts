import { describe, it, expect, vi, afterEach } from 'vitest';
import { PropertyIQClient, PropertyIQError } from '../client';

/** Stub global fetch to return a given status/body, capturing the request. */
function stubFetch(status: number, body: string) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(body, { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const UNAUTH_BODY = JSON.stringify({ error: 'Unauthorized — missing or invalid API key' });

describe('PropertyIQClient auth-failure hardening', () => {
  it('401 with NO token → error names the missing EVERYPROPERTY_API_TOKEN', async () => {
    stubFetch(401, UNAUTH_BODY);
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: undefined });

    const err = await client.suggestAddresses('120 Moondarra Drive').catch((e) => e as PropertyIQError);
    expect(err).toBeInstanceOf(PropertyIQError);
    expect(err.message).toMatch(/no API token was attached/i);
    expect(err.message).toMatch(/EVERYPROPERTY_API_TOKEN/);
    expect(err.status).toBe(401);
    expect(err.body).toBe(UNAUTH_BODY); // server body preserved
  });

  it('401 WITH a token → error says the token was rejected by the allowlist', async () => {
    stubFetch(401, UNAUTH_BODY);
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_wrong' });

    const err = await client.suggestAddresses('120 Moondarra Drive').catch((e) => e as PropertyIQError);
    expect(err.message).toMatch(/rejected/i);
    expect(err.message).toMatch(/EVERYPROPERTY_API_KEYS/);
    expect(err.status).toBe(401);
  });

  it('attaches Authorization: Bearer <token> when a token is set', async () => {
    const calls = stubFetch(200, JSON.stringify({ suggestions: [] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    await client.suggestAddresses('Berwick');
    expect(calls[0].headers['Authorization']).toBe('Bearer epai_good');
  });

  it('sends no Authorization header when no token is set', async () => {
    const calls = stubFetch(200, JSON.stringify({ suggestions: [] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: undefined });
    await client.suggestAddresses('Berwick');
    expect(calls[0].headers['Authorization']).toBeUndefined();
  });

  it('a non-401 error keeps the existing message (no regression)', async () => {
    stubFetch(500, 'boom');
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    const err = await client.suggestAddresses('Berwick').catch((e) => e as PropertyIQError);
    expect(err.message).toMatch(/returned 500/);
    expect(err.message).not.toMatch(/EVERYPROPERTY_API_TOKEN/);
    expect(err.status).toBe(500);
  });

  it('a 200 response returns parsed JSON (the 401 branch does not intercept healthy calls)', async () => {
    stubFetch(200, JSON.stringify({ suggestions: [{ fullAddress: '1 Test St' }] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    const out = await client.suggestAddresses('Test');
    expect(out.suggestions).toHaveLength(1);
  });
});

describe('agent_listings + vendor_report client methods', () => {
  it('agentListings issues GET /api/agents/listings with name+agency and bearer', async () => {
    const calls = stubFetch(200, JSON.stringify({ agent: { name: 'Jane Smith', agency: 'Barry Plant' }, listings: [] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    const out = await client.agentListings({ name: 'Jane Smith', agency: 'Barry Plant' });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/agents/listings');
    expect(url.searchParams.get('name')).toBe('Jane Smith');
    expect(url.searchParams.get('agency')).toBe('Barry Plant');
    expect(calls[0].headers['Authorization']).toBe('Bearer epai_good');
    expect(out.agent?.name).toBe('Jane Smith');
  });

  it('agentListings passes an unknown agent through as { agent: null, listings: [] } (not an error)', async () => {
    stubFetch(200, JSON.stringify({ agent: null, listings: [] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    const out = await client.agentListings({ name: 'Nobody' });
    expect(out.agent).toBeNull();
    expect(out.listings).toEqual([]);
  });

  it('vendorReport issues ?address= when given an address, and ?lat=&lng= when given coords', async () => {
    const calls = stubFetch(200, JSON.stringify({ solds: [], listings: [] }));
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });

    await client.vendorReport({ address: '10 Smith St, Berwick' });
    expect(new URL(calls[0].url).searchParams.get('address')).toBe('10 Smith St, Berwick');

    await client.vendorReport({ lat: -38.03, lng: 145.3, radius: 2 });
    const q = new URL(calls[1].url).searchParams;
    expect(q.get('lat')).toBe('-38.03');
    expect(q.get('lng')).toBe('145.3');
    expect(q.get('radius')).toBe('2');
  });

  it('non-200 surfaces as a PropertyIQError carrying the response body (not swallowed)', async () => {
    stubFetch(500, 'downstream boom');
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });
    const err = await client.vendorReport({ lat: 1, lng: 2 }).catch((e) => e as PropertyIQError);
    expect(err).toBeInstanceOf(PropertyIQError);
    expect(err.status).toBe(500);
    expect(err.body).toBe('downstream boom');
  });
});

describe('per-request timeouts', () => {
  it('fetchProperty uses the 130s crawl timeout; fast endpoints use 30s', async () => {
    stubFetch(
      200,
      JSON.stringify({
        suggestions: [
          { streetAddress: '10 Smith St', suburb: 'Berwick', state: 'VIC', postcode: '3806', fullAddress: '10 Smith St, Berwick VIC 3806' },
        ],
        profile: {},
      }),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const client = new PropertyIQClient({ baseUrl: 'http://x', token: 'epai_good' });

    await client.soldSales({ suburb: 'Berwick' });
    expect(timeoutSpy).toHaveBeenLastCalledWith(30_000);

    timeoutSpy.mockClear();
    await client.fetchProperty('10 Smith St, Berwick');
    // resolveAddress (fast, 30s) then POST /api/property (crawl, 130s).
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(timeoutSpy).toHaveBeenCalledWith(130_000);
  });
});
