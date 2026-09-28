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
npm run cli -- price-changes --suburb Berwick --since-days 30
npm run cli -- suburb-stats --suburb Berwick --period month --as-of 2026-08-15
npm run cli -- cma "9 Gloucester Ave, Berwick VIC 3806"
npm run cli -- proposal "9 Gloucester Ave, Berwick VIC 3806"
```

After `npm run build` it's installable as the `everypropertyai` binary.

## MCP server

Tools (1:1 over the HTTP API): `search_address`, `fetch_property`, `comparable_sales`,
`sold_sales`, `on_market_listings`, `rental_listings`, `agent_listings`, `vendor_report`,
`price_changes`, `suburb_stats`, `enrich`, `street_details`, plus composites `generate_cma_pack`, `proposal_property_data`.

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

### `on_market_listings`

Each row now carries the lifecycle fields `lifecycleStatus` (active | under_offer | sold |
withdrawn), `daysOnMarket` with `daysOnMarketBasis` (which date it was counted from),
`priceHistory` (asking-price observations, oldest first), `saleMethod` and `auctionDate`.
Closed rows are excluded by default; pass `includeInactive: true` (CLI `--include-inactive`)
to return them as well.

### `rental_listings`

Rows carry `lifecycleStatus` (active | leased | withdrawn), `daysOnMarket` with
`daysOnMarketBasis`, `priceHistory` (weekly-rent observations, oldest first) and `leasedAt`.
Closed rows are excluded by default; pass `includeInactive: true` (CLI `--include-inactive`)
to return them as well.

### `price_changes`

Asking-price changes in a suburb over a window (sale and rental listings). Each result pairs
the latest observed price with its predecessor. Midpoint = mean of low and high (weekly rent
for rentals); `changePct` is the midpoint change to one decimal place and is never null or
zero. `sinceDays` is 1..365 (default 30).

```json
{ "name": "price_changes", "arguments": { "suburb": "Berwick", "state": "VIC", "sinceDays": 30 } }
→ { "count": 3, "results": [{ "listingUrl": "...", "address": "12 Example St", "suburb": "Berwick",
    "table": "listings", "previousDisplayPrice": "$740,000 - $760,000", "currentDisplayPrice": "$710,000 - $730,000",
    "previousMid": 750000, "currentMid": 720000, "changePct": -4.0, "changedAt": "2026-09-20T21:00:00Z",
    "priceHistory": [ ... oldest first ... ] }] }
```

### `suburb_stats`

Market statistics for the month or week containing `asOf` (default today, Melbourne), with the
same block under `prior` and `yearAgo` (null when no data). Casey/Cardinia suburbs only.

```json
{ "name": "suburb_stats", "arguments": { "suburb": "Berwick", "state": "VIC", "period": "month", "asOf": "2026-08-15" } }
→ { "suburb": "Berwick", "period": "month", "periodStart": "2026-08-01", "periodEnd": "2026-08-31",
    "current": { "activeListings": 212, "newListings": 48, "medianAsking": 815000, "medianDaysOnMarket": 34,
                 "priceCutCount": 19, "priceCutMedianPct": -3.2, "withdrawnCount": 6, "salesCount": 41,
                 "medianSalePrice": 802500, "monthsOfSupply": 4.8, "saleToListRatio": 0.97,
                 "auctionsHeld": 9, "auctionsCleared": 6, "auctionClearanceRate": 0.667,
                 "privateSalesClosed": 37, "privateSalesSold": 31, "privateSaleConversionRate": 0.838,
                 "rentalListings": 58, "medianRent": 580, "sentimentIndex": null,
                 "sentimentBasis": { "formula": "...", "window": 12, "inputs": [], "reason": "insufficient-history" } },
    "prior": { ... }, "yearAgo": null, "provisional": true, "reconstructed": false, "computedAt": "...", "schemaVersion": 1 }
```

Definitions:

- **Auction clearance** — `auctionsHeld` is auction campaigns whose auction date falls in the
  period; `auctionsCleared` is those matched to a recorded sale within 14 days of the auction
  date. `auctionClearanceRate = cleared / held`, null when fewer than 5 auctions were held.
- **Private-sale conversion** — `privateSalesClosed` is non-auction campaigns that ended
  (sold or withdrawn) in the period; `privateSalesSold` is those that ended in a sale.
  `privateSaleConversionRate = sold / closed`, null below 5 closures.
- **Sentiment index** — `round(100 * mean(scaled inputs))` over `saleToListRatio`,
  `monthsOfSupply`, `priceCutShare` (price cuts / active listings), `medianDaysOnMarket` and
  `auctionClearanceRate`. Each input is scaled `clamp((value - min) / (max - min), 0, 1)`
  against its range over the trailing frozen, non-reconstructed months; months of supply, price
  cut share and days on market are inverted (`1 - scaled`) so higher always means a stronger
  market. Needs at least six months of frozen history and two usable inputs; until then
  `sentimentIndex` is null and `sentimentBasis.reason` is `insufficient-history`.
  `sentimentBasis.inputs` lists each input's value, range, scaled value and weight.
- Closed periods are `provisional` until 60 days after their end, then frozen;
  `reconstructed` marks periods computed from data predating the lifecycle go-live.

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
