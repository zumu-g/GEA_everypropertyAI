#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PropertyIQClient } from "./client.js";

const client = new PropertyIQClient();
const server = new McpServer({ name: "everypropertyai", version: "0.1.0" });

/** Wrap a client call so every tool returns JSON text content and never throws to the transport. */
function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}
async function safe(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

// ── Primitives ──────────────────────────────────────────────────────────────

server.tool(
  "search_address",
  "Resolve a free-text Australian address to structured address suggestions.",
  { query: z.string().describe("e.g. '9 Gloucester Ave, Berwick VIC 3806'") },
  ({ query }) => safe(() => client.suggestAddresses(query)),
);

server.tool(
  "fetch_property",
  "Full merged PropertyIQ profile for an address (beds/baths/land, price estimate, sale & rental history, confidence). May trigger a live crawl if uncached (slow).",
  { address: z.string().describe("free-text address or display address") },
  ({ address }) => safe(() => client.fetchProperty(address)),
);

server.tool(
  "comparable_sales",
  "Top comparable sales in a suburb, scored by similarity to the given attributes.",
  {
    suburb: z.string(),
    state: z.string().optional(),
    beds: z.number().optional(),
    baths: z.number().optional(),
    propertyType: z.string().optional(),
    excludeSlug: z.string().optional(),
  },
  (args) => safe(() => client.comparableSales(args)),
);

server.tool(
  "sold_sales",
  "Recent sold-sales feed for a suburb (Valuer General data).",
  {
    suburb: z.string(),
    state: z.string().optional(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    sinceDays: z.number().optional(),
    limit: z.number().optional(),
  },
  (args) => safe(() => client.soldSales(args)),
);

server.tool(
  "on_market_listings",
  "Current on-market (for-sale) listings in a suburb or around a lat/lng point (Domain feed). sinceDays filters to listings listed within the last N days.",
  {
    suburb: z.string().optional(),
    state: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radius: z.number().optional(),
    sinceDays: z.number().optional(),
    limit: z.number().optional(),
  },
  (args) => safe(() => client.onMarketListings(args)),
);

server.tool(
  "rental_listings",
  "Current on-market rental listings in a suburb or around a lat/lng point (Domain feed). Filter by weekly rent (minRent/maxRent) and recency (sinceDays = listed within the last N days).",
  {
    suburb: z.string().optional(),
    state: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radius: z.number().optional(),
    sinceDays: z.number().optional(),
    minRent: z.number().optional(),
    maxRent: z.number().optional(),
    limit: z.number().optional(),
  },
  (args) => safe(() => client.rentalListings(args)),
);

server.tool(
  "enrich",
  "Location enrichment for a suburb/address: planning/zoning, schools, transport, childcare, suburb stats, buyer demand, market data.",
  {
    suburb: z.string(),
    state: z.string(),
    postcode: z.string(),
    address: z.string().optional(),
  },
  (args) => safe(() => client.enrich(args)),
);

server.tool(
  "street_details",
  "All known addresses on a street with last sale/listing data.",
  { query: z.string().describe("e.g. 'Gloucester Ave, Berwick VIC'") },
  ({ query }) => safe(() => client.streetDetails(query)),
);

// ── Composites ───────────────────────────────────────────────────────────────

server.tool(
  "generate_cma_pack",
  "CMA-ready bundle for an address: subject attributes + price estimate + comparable sales + recent suburb sales + suburb stats/market data.",
  { address: z.string() },
  ({ address }) => safe(() => client.cmaPack(address, new Date().toISOString())),
);

server.tool(
  "proposal_property_data",
  "Presentation-ready property fields for a proposal document: formatted attributes, price estimate, agency/agent, hero photos, suburb, description.",
  { address: z.string() },
  ({ address }) => safe(() => client.proposalPropertyData(address)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[everypropertyai] MCP server ready (API: ${process.env.EVERYPROPERTY_API_URL ?? "http://localhost:3007"})`,
);
