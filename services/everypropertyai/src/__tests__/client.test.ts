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
