import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp';

// Live smoke test: drives search_address + sold_sales through the MCP protocol
// against the real API. Requires a real token; skips cleanly without one so CI
// without secrets doesn't fail. Set EVERYPROPERTY_API_URL to target prod.
const hasToken = !!process.env.EVERYPROPERTY_API_TOKEN;
const d = hasToken ? describe : describe.skip;

if (!hasToken) {
  // eslint-disable-next-line no-console
  console.warn('[mcp-smoke] skipped — set EVERYPROPERTY_API_TOKEN (and optionally EVERYPROPERTY_API_URL) to run.');
}

/** Parse the JSON text content a tool returns; fail loudly if the call errored. */
function parseToolResult(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }) {
  expect(result.isError ?? false).toBe(false);
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
  return client;
}

// Offline: a bare street name once returned 89 rows Australia-wide (72,480 chars) and filled an LLM caller's context.
describe('street_details keeps its result small', () => {
  afterEach(() => vi.unstubAllGlobals());

  const row = (n: number, state: 'NSW' | 'VIC') => ({
    streetAddress: `${n} Rhinelander ${state === 'VIC' ? 'Cl' : 'Rd'}`,
    suburb: state === 'VIC' ? 'Clyde North' : 'Box Hill',
    state,
    postcode: state === 'VIC' ? '3978' : '2765',
    slug: `${n}-rhinelander-${state.toLowerCase()}`,
    propertyHref: `/property?address=${'%22streetName%22%3A%22Rhinelander%22'.repeat(8)}`,
    landAreaSqm: null,
    buildingAreaSqm: null,
    bedrooms: null,
    bathrooms: null,
    garage: null,
    lastSaleDate: null,
    lastSalePrice: null,
    lastListedDate: null,
    listedPrice: null,
  });

  it('returns Victorian rows only, without the link and empty fields', async () => {
    const rows = [
      ...Array.from({ length: 70 }, (_, i) => row(i + 1, 'NSW')),
      ...Array.from({ length: 19 }, (_, i) => row(i + 1, 'VIC')),
    ];
    const body = JSON.stringify({ rows, streetLabel: 'Rhinelander', locationLabel: 'Australia' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const client = await connectedClient();
    const res = (await client.callTool({ name: 'street_details', arguments: { query: 'Rhinelander' } })) as never;
    const text = (res as { content: Array<{ text?: string }> }).content[0].text ?? '';
    const data = parseToolResult(res);
    await client.close();

    expect(data.rows).toHaveLength(19);
    expect(data.totalRows).toBe(19);
    expect(data.rows.every((r: { state: string }) => r.state === 'VIC')).toBe(true);
    expect(data.note).toBeUndefined();
    expect(text).not.toContain('propertyHref');
    expect(text).not.toContain('null');
    expect(text.length).toBeLessThan(10_000);
  });

  it('keeps an address with sale history when the street is longer than the cap', async () => {
    const sold = { ...row(61, 'VIC'), lastSaleDate: '2024-03-02', lastSalePrice: 910000 };
    const rows = [...Array.from({ length: 60 }, (_, i) => row(i + 1, 'VIC')), sold];
    const body = JSON.stringify({ rows, streetLabel: 'Rhinelander Cl', locationLabel: 'Clyde North VIC' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const client = await connectedClient();
    const data = parseToolResult((await client.callTool({ name: 'street_details', arguments: { query: 'Rhinelander Cl, Clyde North VIC' } })) as never);
    await client.close();

    expect(data.rows).toHaveLength(50);
    expect(data.totalRows).toBe(61);
    expect(data.note).toMatch(/suburb/i);
    expect(data.rows[0]).toMatchObject({ streetAddress: '61 Rhinelander Cl', lastSalePrice: 910000 });
  });

  it('adds no note when the street fits', async () => {
    const body = JSON.stringify({ rows: [row(13, 'VIC')], streetLabel: 'Rhinelander Cl', locationLabel: 'Clyde North VIC' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const client = await connectedClient();
    const data = parseToolResult((await client.callTool({ name: 'street_details', arguments: { query: 'Rhinelander Cl, Clyde North VIC' } })) as never);
    await client.close();

    expect(data.rows).toEqual([{ streetAddress: '13 Rhinelander Cl', suburb: 'Clyde North', state: 'VIC', postcode: '3978', slug: '13-rhinelander-vic' }]);
    expect(data.totalRows).toBe(1);
    expect(data.note).toBeUndefined();
  });
});

d('everypropertyai MCP server (live)', () => {
  it('lists the expected tools including the two new ones', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_address', 'sold_sales', 'agent_listings', 'vendor_report', 'price_changes', 'suburb_stats']),
    );
    await client.close();
  });

  it('search_address returns non-empty suggestions', async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: 'search_address', arguments: { query: '9 Gloucester Ave, Berwick VIC' } });
    const data = parseToolResult(res as never);
    expect(Array.isArray(data.suggestions)).toBe(true);
    expect(data.suggestions.length).toBeGreaterThan(0);
    await client.close();
  });

  it('sold_sales returns a well-formed sales result for a real suburb', async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: 'sold_sales', arguments: { suburb: 'Berwick' } });
    const data = parseToolResult(res as never);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]).toHaveProperty('rawAddress');
    await client.close();
  });

  it('suburb_stats returns a non-empty Berwick month block with a sentiment basis', async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: 'suburb_stats', arguments: { suburb: 'Berwick', state: 'VIC', period: 'month' } });
    const data = parseToolResult(res as never);
    expect(typeof data.current.activeListings).toBe('number');
    expect(data.current.activeListings).toBeGreaterThan(0);
    expect(data.current.sentimentBasis).toBeDefined();
    await client.close();
  });

  it('price_changes returns a results array for Berwick', async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: 'price_changes', arguments: { suburb: 'Berwick' } });
    const data = parseToolResult(res as never);
    expect(Array.isArray(data.results)).toBe(true);
    await client.close();
  });
});
