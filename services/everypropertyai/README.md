# everypropertyAI

MCP server **and** CLI that expose PropertyIQ's property data to GEA's **CMA** and
**proposal** tools. It's a thin, typed wrapper over the running PropertyIQ HTTP API — no
scraping/merge logic or API keys are duplicated here; the app owns those.

## Configure

| Env var | Default | Purpose |
|---|---|---|
| `EVERYPROPERTY_API_URL` | `http://localhost:3007` | Base URL of the everypropertyAI API. Prod: `https://geaeverypropertyai-production.up.railway.app` |
| `EVERYPROPERTY_API_TOKEN` | — | Bearer token sent as `Authorization: Bearer <token>`. Must be one of the server's `EVERYPROPERTY_API_KEYS`. Required against prod. |

Install: `npm install` (from this directory). Requires the everypropertyAI API to be running/reachable.

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

Tools (1:1 over the HTTP API): `search_address`, `fetch_property`, `comparable_sales`,
`sold_sales`, `on_market_listings`, `rental_listings`, `agent_listings`, `vendor_report`,
`enrich`, `street_details`, plus composites `generate_cma_pack`, `proposal_property_data`.

Inspect locally:

```bash
npx @modelcontextprotocol/inspector npm run mcp
```

### Consumer setup (server-to-server, e.g. GEA_ST_SG_assistant)

Build once (`npm run build`), then register the server pointing at prod with the consumer's
own key. **Claude Code:**

```bash
claude mcp add everypropertyai \
  --env EVERYPROPERTY_API_URL=https://geaeverypropertyai-production.up.railway.app \
  --env EVERYPROPERTY_API_TOKEN=epai_stsg_… \
  -- node /ABS/PATH/services/everypropertyai/dist/mcp.js
```

**Claude Desktop / OpenClaw (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "everypropertyai": {
      "command": "node",
      "args": ["/ABS/PATH/services/everypropertyai/dist/mcp.js"],
      "env": {
        "EVERYPROPERTY_API_URL": "https://geaeverypropertyai-production.up.railway.app",
        "EVERYPROPERTY_API_TOKEN": "epai_stsg_…"
      }
    }
  }
}
```

Required env: `EVERYPROPERTY_API_URL` (prod URL above) and `EVERYPROPERTY_API_TOKEN` (the
consumer's `epai_…` key, which must be present in the server's `EVERYPROPERTY_API_KEYS`
allowlist). Never commit the token.

## Smoke test

`services/everypropertyai/src/__tests__/mcp-smoke.test.ts` drives `search_address` and
`sold_sales` through the MCP protocol against the live API. It skips unless a real token is
set:

```bash
EVERYPROPERTY_API_TOKEN=epai_stsg_… \
EVERYPROPERTY_API_URL=https://geaeverypropertyai-production.up.railway.app \
npx vitest run services/everypropertyai/src/__tests__/mcp-smoke.test.ts
```

## Notes

- `fetch_property` / `generate_cma_pack` / `proposal_property_data` for an **uncached**
  address can take ~120s (the API runs the live crawl cascade); the MCP client uses a 130s
  timeout for these. All other tools use a 30s timeout. Cached addresses return fast.
- Rent figures are **weekly**. Address autocomplete is VIC-biased. `agent_listings` returns
  an empty result (not an error) for an unknown agent.
- Composite tools bundle several primitive calls into one ready-to-use result.
