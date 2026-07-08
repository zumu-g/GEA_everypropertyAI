import { describe, it, expect } from 'vitest';
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

d('everypropertyai MCP server (live)', () => {
  async function connectedClient() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'smoke-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), buildServer().connect(serverTransport)]);
    return client;
  }

  it('lists the expected tools including the two new ones', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_address', 'sold_sales', 'agent_listings', 'vendor_report']),
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
});
