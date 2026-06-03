# Vendor campaign report integration — Claude Code prompt ("Recent sales" + "New to market")

Paste the block below into a **Claude Code session running inside the vendor campaign report tool's
repo**. It fills two report sections from the `everypropertyai` CLI — **Recent sales** and **New to
market** — for the area around a vendor's listed property.

> Note: on Stuart's Mac the CLI is **already built and `npm link`ed** (global `everypropertyai`
> command verified working against PropertyIQ on `:3007`). On that machine, step 2 is a no-op
> beyond confirming `everypropertyai --version`. On a fresh machine, run step 2 in full.

## How to use

1. `cd` into the **vendor report tool** repo
2. Start a Claude Code session there
3. Paste everything inside the code fence below as the first message
4. Prereq: PropertyIQ must be reachable at `EVERYPROPERTY_API_URL` (defaults to `http://localhost:3007`)

---

```
You are integrating an existing internal tool, "everypropertyAI", into THIS project (the weekly
vendor campaign report generator). everypropertyAI is a CLI that returns PropertyIQ property data as
JSON. Your job is to fill TWO report sections from the CLI — "Recent sales" and "New to market" —
for the area around the vendor's listed property. Work only in this repo except for the one
build/link step noted below.

## Context (carry forward — do not re-derive)
- everypropertyAI lives in another local repo at:
  "/Users/stuartgrant_mbp13/Library/Mobile Documents/com~apple~CloudDocs/GEA_Projects/GEA_/GEA_everypropertyAI/propertyiq/services/everypropertyai"
- It is a thin CLI/MCP wrapper over the PropertyIQ HTTP API. It needs the PropertyIQ app reachable
  via the env var EVERYPROPERTY_API_URL (default http://localhost:3007). A deployed URL can be set
  later: EVERYPROPERTY_API_URL=[PROPERTYIQ_PROD_URL]. An optional EVERYPROPERTY_API_TOKEN bearer is
  supported if the data routes get shared-secret auth.
- Integration mode for THIS project = CLI (shell out, parse JSON). Do NOT add an MCP server,
  do NOT reimplement any scraping/data logic, do NOT copy PropertyIQ source.
- Scope is the two report sections only. Do NOT build the weekly scheduling/automation — how/when the
  report runs each week is this tool's own concern.

## CLI surface (the two primaries — both in radius mode; all print JSON)
- everypropertyai sold     --lat <lat> --lng <lng> --radius <km> [--since-days N] [--limit N]
    → RECENT SALES around the property
- everypropertyai listings --lat <lat> --lng <lng> --radius <km> [--limit N]
    → NEW TO MARKET (current on-market for-sale listings) around the property
- Suburb fallback (when coords aren't available): replace the lat/lng/radius flags with
    --suburb <suburb> --state <state>   on EITHER command.
- everypropertyai search "<query>"  → address suggestions ONLY (does NOT return coordinates).

Response shapes:
sold     → { suburb, state, count, results: SoldSaleResult[] }
listings → { suburb, state, count, results: OnMarketListing[] }
SoldSaleResult  = { rawAddress, suburb, postcode, salePrice, saleDate, settlementDate,
                    landAreaSqm, propertyType, latitude, longitude, source }
OnMarketListing = { rawAddress, suburb, postcode, displayPrice, priceLow, priceHigh, status,
                    bedrooms, bathrooms, carSpaces, landAreaSqm, propertyType,
                    latitude, longitude, source }

## COORDINATES (important — radius mode needs them)
Radius mode requires the vendor property's lat/lng. THIS tool already knows the listed property
(it's a vendor campaign) — pass its lat/lng straight through. If only an address is known, geocode it
(this tool's own concern) OR fall back to `--suburb`/`--state`. Default radius if you must pick one:
~2 km. `everypropertyai search` does NOT return coords, so don't rely on it for the centre point.

## Feature spec — the two sections
For a given vendor property (lat/lng, with suburb fallback):
1. RECENT SALES = `sold --lat --lng --radius R --since-days <WINDOW>`. WINDOW is CONFIGURABLE — make
   it a parameter with a default of 90 days. Sort results by `saleDate` descending. Render per row:
   address, sale price, sale date, beds/baths, land area.
2. NEW TO MARKET = `listings --lat --lng --radius R`. Render per row: address, price
   (`displayPrice`, or `priceLow`–`priceHigh` when present), status, beds/baths, land area.
Each section must degrade gracefully when `count` is 0 — show e.g. "No recent sales in the last
<WINDOW> days" / "No new listings this period", never an error or an empty crash.

## Latency / data notes
- `sold` and `listings` are fast suburb/box queries (NOT the ~120s live-crawl path) — a ~30s timeout
  is plenty. Fail fast with a clear message if PropertyIQ is unreachable.
- `sold` has live data today. `listings` ("New to market") returns rows once PropertyIQ's Domain
  on-market ingest has run; until then it returns count 0 — handle that as the empty state above.

## Starting state
This is the vendor report tool repo. Its stack is not assumed.

## Target state (done when ALL true)
1. The `everypropertyai` CLI is callable from this machine (verified).
2. This project has a single, thin data-access module that shells out to the CLI and returns
   typed/parsed JSON: `getRecentSales({lat,lng,radius,sinceDays})` and
   `getNewToMarket({lat,lng,radius})` (each also accepting a `{suburb,state}` fallback).
3. EVERYPROPERTY_API_URL is configured for local dev and documented for prod (env, not hardcoded).
4. Exactly ONE place in the report generator is wired to populate the two sections for a vendor
   property (or, if no generator exists yet, a single runnable example/script demonstrating it).
5. The recent-sales window is a parameter with a default (90 days).
6. A short README/section documents setup + usage.

## Steps (do in order; output "✅ <step>" after each)
1. DETECT STACK: inspect this repo. Report language, framework, the report generator, and where a
   vendor property + its coordinates live. STOP AND ASK if the stack is ambiguous or multi-app.
2. BUILD + LINK THE CLI (one-time, in the everypropertyAI repo — the only out-of-repo action):
   cd into the path above, `npm install` (if needed), `npm run build`, then `npm link`. Verify with
   `everypropertyai --version` and a smoke test:
   `EVERYPROPERTY_API_URL=http://localhost:3007 everypropertyai sold --suburb Berwick --limit 3`.
   If `npm link` is undesirable, call via the built binary's absolute path. Do not proceed until a
   CLI call returns JSON. (On Stuart's Mac this is already linked — just confirm `--version`.)
3. CONFIG: add EVERYPROPERTY_API_URL to this project's env mechanism (.env / config), default
   http://localhost:3007 for dev, with a documented [PROPERTYIQ_PROD_URL] slot for prod.
4. DATA MODULE: add ONE thin module in this project's language (Node child_process / Python
   subprocess / etc.) exposing `getRecentSales` + `getNewToMarket` (radius mode + suburb fallback).
   Parse JSON, surface errors clearly, match this project's style. No new heavy dependencies — use
   the stdlib process API. STOP AND ASK before adding any dependency.
5. WIRE THE TWO SECTIONS: populate "Recent sales" and "New to market" in the report template from the
   module — radius mode, suburb fallback, configurable window, graceful empty states. Do NOT refactor
   unrelated code. Do NOT add scheduling.
6. DOCS: add a short "PropertyIQ data (everypropertyAI)" section to the README — setup, env, the two
   functions, the radius/coords requirement, the configurable window, and the empty-state behaviour.

## Hard constraints
- Only make changes directly requested: the data module + config + the two section wiring points +
  docs. No extra features/files.
- Do NOT modify the everypropertyAI/PropertyIQ source — only `npm run build` / `npm link` it.
- Do NOT build the weekly scheduling/automation — out of scope.
- STOP AND ASK before: adding any dependency, changing this project's data model/schema, or any
  destructive/irreversible action.
- Keep all property data behind the env-configured base URL — never hardcode a URL.

## Verify before declaring done
- `everypropertyai sold --lat -38.03 --lng 145.35 --radius 2 --since-days 90` and
  `everypropertyai listings --lat -38.03 --lng 145.35 --radius 2` each return JSON (PropertyIQ on :3007).
- This project's `getRecentSales(...)` and `getNewToMarket(...)` return the same parsed data.
- The report renders both sections for a vendor property, including the graceful empty state when a
  section has no rows.
- Report a final summary: files added/changed, how to set the prod URL, and any STOP-AND-ASK items
  still open.
```
