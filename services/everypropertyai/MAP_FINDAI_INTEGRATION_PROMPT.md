> # ⚠️ SUPERSEDED — merged into GEA_CRM (2026-06-16)
> MAP_findAI is **no longer a separate consumer**. Its "market appraisal / nurture" capability —
> nearby sold evidence (`sold --suburb`), comparable sales (`comps --suburb`) and street-level
> listed data (`street`) — is now owned by **GEA_CRM** and available to GEA_CRM's `epai_crm_` key
> (consumer keys are global across all everypropertyAI endpoints, so no new key or provisioning is
> needed). MAP_findAI was never provisioned with its own `epai_` key, so there is nothing to revoke.
> This document is retained as historical reference for the CLI commands only — do **not** wire it as
> a new integration. See `INTEGRATIONS.md` for the live consumer inventory.

# MAP_findAI integration — Claude Code prompt ("Nearby sold + listed properties for a market appraisal")

Paste the block below into a **Claude Code session running inside the MAP_findAI repo**. It wires a
feature to **find recent sold + listed properties around a client's property we're nurturing**, to
support a market-appraisal discussion: suburb-wide sold evidence + comparable sales, plus the
client's own street (the only source of "listed" data), handed to MAP_findAI as one tagged list.

> Note: on Stuart's Mac the CLI is **already built and `npm link`ed** (global `everypropertyai`
> command verified working against PropertyIQ on `:3007`). On that machine, step 2 is a no-op
> beyond confirming `everypropertyai --version`. On a fresh machine, run step 2 in full.

## How to use

1. `cd` into the **MAP_findAI** repo
2. Start a Claude Code session there
3. Paste everything inside the code fence below as the first message
4. Prereq: PropertyIQ must be reachable at `EVERYPROPERTY_API_URL` (defaults to `http://localhost:3007`)

---

```
You are integrating an existing internal tool, "everypropertyAI", into THIS project (MAP_findAI).
everypropertyAI is a CLI that returns PropertyIQ property data as JSON. Your job is to add a
"nearby sold + listed properties" feature: given a client's property we are nurturing, fetch the
recent SOLD sales and LISTED properties around it so the user can talk through a market appraisal.
Work only in this repo except for the one build/link step noted below.

## Context (carry forward — do not re-derive)
- everypropertyAI lives in another local repo at:
  "/Users/stuartgrant_mbp13/Library/Mobile Documents/com~apple~CloudDocs/GEA_Projects/GEA_/GEA_everypropertyAI/propertyiq/services/everypropertyai"
- It is a thin CLI/MCP wrapper over the PropertyIQ HTTP API. It needs the PropertyIQ app
  reachable via the env var EVERYPROPERTY_API_URL (default http://localhost:3007). A deployed URL
  can be set later: EVERYPROPERTY_API_URL=[PROPERTYIQ_PROD_URL]. An optional EVERYPROPERTY_API_TOKEN
  bearer is supported if the data routes get shared-secret auth.
- Integration mode for THIS project = CLI (shell out, parse JSON). Do NOT add an MCP server,
  do NOT reimplement any scraping/merge/data logic, do NOT copy PropertyIQ source.

## HARD DATA CONSTRAINTS (read first — do not design around capabilities that don't exist)
- The API is SUBURB-SCOPED. There is NO radius/distance search. "Around the client" = the client's
  SUBURB (for sold evidence) plus the client's STREET (for immediate neighbours). Do not invent a
  radius query.
- There is NO suburb-wide "currently listed" feed. LISTED data exists ONLY at the street level
  (the `street` command's lastListedDate / listedPrice fields). Suburb-wide data is SOLD only.
- Rows are ADDRESS-LEVEL — they do NOT include lat/lng. MAP_findAI already geocodes addresses for
  its map; pin placement is THIS project's job. Do NOT add geocoding to the integration.

## CLI surface (commands you will call — all print JSON; add nothing else)
- everypropertyai sold   --suburb <s> [--state VIC] [--min n] [--max n] [--since-days n] [--limit n]
    → { suburb, state, count, results: SoldSaleResult[] }    ── SUBURB-WIDE SOLD FEED (primary)
- everypropertyai comps  --suburb <s> [--state VIC] [--beds n] [--baths n] [--type t]
    → { comparables: ComparableResult[] }                    ── SUBURB-WIDE COMPARABLE SOLD SALES, ranked (primary)
- everypropertyai street "<street> <suburb>"
    → { rows: StreetRow[], streetLabel, locationLabel }       ── SAME-STREET ROWS, the ONLY LISTED source (primary)
- everypropertyai search "<query>"                            ── resolve the client address → suburb/state/street (helper)
- everypropertyai property|cma|proposal|enrich ...            ── exist, but NOT used by this feature

Response shapes:
SoldSaleResult  = { rawAddress, suburb, salePrice, saleDate, settlementDate?, landAreaSqm?, propertyType?, source? }
ComparableResult= { address, suburb, price, saleDate, beds?, baths?, landAreaSqm?, similarityScore }
StreetRow       = { streetAddress, suburb, state, postcode, slug, propertyHref,
                    landAreaSqm, buildingAreaSqm, bedrooms, bathrooms, garage,
                    lastSaleDate, lastSalePrice, lastListedDate, listedPrice }

## Feature spec
Given a client's nurtured property address:
1. RESOLVE: `search "<client address>"` → take the suburb, state, and street name.
2. SOLD EVIDENCE (suburb scope):
   - `sold --suburb <suburb> --state <state> --since-days 365 --limit 50` → recent sold sales.
   - `comps --suburb <suburb> --state <state> --beds <n> --baths <n> --type <t>` → like-for-like
     comparable sold sales, similarity-ranked (use the client's beds/baths/type if known).
3. NEIGHBOURS (street scope):
   - `street "<streetName> <suburb>"` → for each row, classify:
       • recently SOLD  → has lastSalePrice / lastSaleDate
       • currently/recently LISTED → has listedPrice / lastListedDate
4. COMBINE: merge the three sources into ONE normalised, de-duplicated list. De-dupe by
   address/slug. Tag each entry with `type` ("sold" | "listed" | "comp") and `scope`
   ("street" | "suburb"). Pass addresses straight through — MAP_findAI geocodes them for pins.

## Latency note
`sold` / `comps` / `street` are suburb/street lookups — fast (typically <5s). They are NOT on the
~120s live-crawl path (that's only `property` / `cma`). Still: set a sane timeout (~30s) and fail
fast with a clear error if PropertyIQ is unreachable.

## Starting state
This is the MAP_findAI repo. Its stack is not assumed.

## Target state (done when ALL true)
1. The `everypropertyai` CLI is callable from this machine (verified).
2. This project has a single, thin data-access module that shells out to the CLI and returns
   typed/parsed JSON: `getSoldNearby(suburb, opts)`, `getComps(suburb, {beds,baths,type})`,
   `getStreetNeighbours(street, suburb)`, and `suggestAddresses(query)`.
3. A pure COMBINE/NORMALISE function merges the three sources into one tagged, de-duped list:
   `{ address, type, scope, price?, date?, beds?, baths?, landAreaSqm?, similarityScore?, source }`.
4. EVERYPROPERTY_API_URL is configured for local dev and documented for prod (env, not hardcoded).
5. Exactly ONE place in MAP_findAI's "discuss a client property / market appraisal" flow is wired to
   fetch the nearby set for a chosen property (or, if no such flow exists yet, a single runnable
   example/script demonstrating it).
6. A short README/section documents setup + usage.

## Steps (do in order; output "✅ <step>" after each)
1. DETECT STACK: inspect this repo (package.json / pyproject / etc.). Report language, framework,
   where the map / appraisal flow lives, and where a client property is selected. STOP AND ASK if
   the stack is ambiguous or there are multiple apps.
2. BUILD + LINK THE CLI (one-time, in the everypropertyAI repo — the only out-of-repo action):
   cd into the path above, run `npm install` (if needed), `npm run build`, then `npm link`.
   Verify with `everypropertyai --version` and a smoke test:
   `EVERYPROPERTY_API_URL=http://localhost:3007 everypropertyai sold --suburb Berwick --limit 5`.
   If `npm link` is undesirable, call via the built binary's absolute path. Do not proceed until a
   CLI call returns JSON. (On Stuart's Mac this is already linked — just confirm `--version`.)
3. CONFIG: add EVERYPROPERTY_API_URL to this project's env mechanism (.env / config), default
   http://localhost:3007 for dev, with a documented [PROPERTYIQ_PROD_URL] slot for prod.
4. DATA MODULE: add ONE thin module in this project's language (Node child_process / Python
   subprocess / etc.) exposing getSoldNearby / getComps / getStreetNeighbours / suggestAddresses.
   Parse JSON, surface errors clearly, match this project's style. No new heavy dependencies — use
   the stdlib process API. STOP AND ASK before adding any dependency.
5. COMBINE/NORMALISE: add a PURE function that merges sold + comps + street rows into one list,
   tagged by type ("sold"/"listed"/"comp") and scope ("street"/"suburb"), de-duped by address/slug.
   Keep field names stable; pass addresses through untouched for MAP's geocoder.
6. WIRE ONE FLOW: connect the module + combine function to ONE real spot in MAP_findAI's
   appraisal / discuss-client-property path — fetch the nearby set for the selected property and
   surface it (list and/or pins). If the flow doesn't exist yet, add a single runnable
   example/script. Do NOT refactor unrelated code.
7. DOCS: add a short "PropertyIQ data (everypropertyAI)" section to the README — setup, env, the
   four functions, the combine output shape, and the suburb-scope + listed-is-street-only caveats.

## Hard constraints
- Only make changes directly requested. Do NOT add features, abstractions, or files beyond the
  data module + combine function + config + one wiring point + docs.
- Do NOT modify the everypropertyAI/PropertyIQ source — only `npm run build` / `npm link` it.
- Do NOT add geocoding — MAP_findAI owns pin placement; the integration returns addresses only.
- STOP AND ASK before: adding any dependency, changing this project's data model/schema, or any
  destructive/irreversible action.
- Keep all property data behind the env-configured base URL — never hardcode a URL.

## Verify before declaring done
- `everypropertyai sold --suburb Berwick --limit 5`, `everypropertyai comps --suburb Berwick --beds 4`,
  and `everypropertyai street "Gloucester Ave Berwick"` each return JSON (PropertyIQ on :3007).
- This project's data module returns the same parsed data for each.
- The combine function yields one tagged, de-duped list containing sold + listed + comp entries.
- The wired flow (or example script) shows nearby properties around a chosen client property.
- Report a final summary: files added/changed, how to set the prod URL, the combine output shape,
  and any STOP-AND-ASK items still open.
```
