# everypropertyAI

MCP server **and** CLI that expose PropertyIQ's property data to GEA's **CMA** and
**proposal** tools. It's a thin, typed wrapper over the running PropertyIQ HTTP API — no
scraping/merge logic or API keys are duplicated here; the app owns those.

## Configure

| Env var | Default | Purpose |
|---|---|---|
| `EVERYPROPERTY_API_URL` | `http://localhost:3007` | Base URL of the running PropertyIQ app (local or deployed) |
| `EVERYPROPERTY_API_TOKEN` | — | Optional bearer sent to the API (if you add shared-secret auth to the data routes) |

Install: `npm install` (from this directory). Requires the PropertyIQ app to be running/reachable.

## CLI

```bash
npm run cli -- property "9 Gloucester Ave, Berwick VIC 3806"
npm run cli -- comps --suburb Berwick --state VIC --beds 4 --baths 2
npm run cli -- sold --suburb Berwick --limit 25
npm run cli -- rentals --suburb Berwick --min-rent 400 --max-rent 650 --listed-within 6m
npm run cli -- cma "9 Gloucester Ave, Berwick VIC 3806"
npm run cli -- proposal "9 Gloucester Ave, Berwick VIC 3806"
```

After `npm run build` it's installable as the `everypropertyai` binary.

## MCP server

Tools: `search_address`, `fetch_property`, `comparable_sales`, `sold_sales`, `enrich`,
`street_details`, `generate_cma_pack`, `proposal_property_data`.

Inspect locally:

```bash
npx @modelcontextprotocol/inspector npm run mcp
```

Add to Claude Code:

```bash
claude mcp add everypropertyai -- npm --prefix /ABS/PATH/services/everypropertyai run mcp
```

Or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "everypropertyai": {
      "command": "npx",
      "args": ["tsx", "/ABS/PATH/services/everypropertyai/src/mcp.ts"],
      "env": { "EVERYPROPERTY_API_URL": "http://localhost:3007" }
    }
  }
}
```

## Notes

- `fetch_property` / `generate_cma_pack` for an **uncached** address can take up to ~120s
  (the API runs the live Apify/Firecrawl/stealth cascade). Cached addresses return fast.
- Composite tools (`cma_pack`, `proposal_property_data`) bundle several primitive calls into
  one ready-to-use result for the CMA and proposal tools respectively.
