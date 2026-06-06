# CMA project integration — Claude Code prompt

Paste the block below into a **Claude Code session running inside the CMA project repo**.

> Note: on Stuart's Mac the CLI is **already built and `npm link`ed** (global `everypropertyai`
> command verified working against PropertyIQ on `:3007`). On that machine, step 2 is a no-op
> beyond confirming `everypropertyai --version`. On a fresh machine, run step 2 in full.

## How to use

1. `cd` into the CMA project repo
2. Start a Claude Code session there
3. Paste everything inside the code fence below as the first message
4. Prereq: PropertyIQ must be reachable at `EVERYPROPERTY_API_URL` (defaults to `http://localhost:3007`)

---

```
You are integrating an existing internal tool, "everypropertyAI", into THIS project (the CMA
tool). everypropertyAI is a CLI that returns PropertyIQ property data as JSON. Your job is to
make this project able to pull that data via the CLI. Work only in this repo except for the
one build/link step noted below.

## Context (carry forward — do not re-derive)
- everypropertyAI lives in another local repo at:
  "/Users/stuartgrant_mbp13/Library/Mobile Documents/com~apple~CloudDocs/GEA_Projects/GEA_/GEA_everypropertyAI/propertyiq/services/everypropertyai"
- It is a thin CLI/MCP wrapper over the PropertyIQ HTTP API. It needs the PropertyIQ app
  reachable via the env var EVERYPROPERTY_API_URL (default http://localhost:3007). A deployed
  URL can be set later: EVERYPROPERTY_API_URL=[PROPERTYIQ_PROD_URL].
- Integration mode for THIS project = CLI (shell out, parse JSON). Do NOT add an MCP server,
  do NOT reimplement any scraping/data logic, do NOT copy PropertyIQ source.

## CLI surface (commands you will call — all print JSON; add nothing else)
- everypropertyai cma "<address>"        → CMA pack (the primary one for this tool)
- everypropertyai proposal "<address>"   → presentation-ready fields
- everypropertyai property "<address>"   → full merged profile
- everypropertyai comps --suburb <s> --state <st> [--beds n --baths n]
- everypropertyai sold --suburb <s> --state <st> [--limit n]
- everypropertyai rentals --suburb <s> [--min-rent n --max-rent n] [--listed-within 1m|3m|6m|12m|2y] [--limit n]
- everypropertyai listings --suburb <s> [--listed-within 1m|3m|6m|12m|2y] [--limit n]
- everypropertyai search "<address>"     → address suggestions

CMA pack JSON shape:
{
  "address", "addressSlug", "source",
  "subject":       { "bedrooms", "bathrooms", "carSpaces", "landAreaSqm", "propertyType", "overallConfidence" },
  "priceEstimate": { "low", "mid", "high", "source" },
  "comparables":        [ { "address", "suburb", "price", "saleDate", "beds", "baths", "landAreaSqm", "similarityScore" } ],
  "recentSuburbSales":  [ { "rawAddress", "suburb", "salePrice", "saleDate", "propertyType" } ],
  "suburbStats", "marketData", "generatedAt"
}

Proposal JSON shape:
{
  "address", "bedrooms", "bathrooms", "carSpaces", "landAreaSqm", "propertyType",
  "priceEstimate", "formattedEstimate", "agency", "agentName",
  "heroPhotos": [], "suburb", "description", "confidence"
}

IMPORTANT latency note: `cma`/`property` for an UNCACHED address can take up to ~120s (it
triggers a live crawl); cached addresses return in <2s. Design any runtime call to be async
with a loading state and a generous timeout. The PropertyIQ app (or its deployed URL) MUST be
reachable or every call fails fast with a clear error.

## Starting state
This is the CMA project repo. Its stack is not assumed.

## Target state (done when ALL true)
1. The `everypropertyai` CLI is callable from this machine (verified).
2. This project has a single, thin data-access module that shells out to the CLI and returns
   typed/parsed JSON for at least: cma pack and proposal data.
3. EVERYPROPERTY_API_URL is configured for local dev and documented for prod (env, not hardcoded).
4. Exactly ONE place in the existing CMA flow is wired to fetch a CMA pack for a subject address
   (or, if no obvious flow exists yet, a single example usage / script demonstrating it).
5. A short README/section documents setup + usage.

## Steps (do in order; output "✅ <step>" after each)
1. DETECT STACK: inspect this repo (package.json / pyproject / go.mod / etc.). Report the
   language, framework, and where data-fetching/integration code belongs. STOP AND ASK if the
   stack is ambiguous or there are multiple apps.
2. BUILD + LINK THE CLI (one-time, in the everypropertyAI repo — the only out-of-repo action):
   cd into the path above, run `npm install` (if needed), `npm run build`, then `npm link`.
   Verify with `everypropertyai --version` and a smoke test:
   `EVERYPROPERTY_API_URL=http://localhost:3007 everypropertyai search "9 Gloucester Ave Berwick"`.
   If `npm link` is undesirable on this machine, instead call via the built binary's absolute
   path. Do not proceed until a CLI call returns JSON. (On Stuart's Mac this is already linked —
   just confirm `everypropertyai --version`.)
3. CONFIG: add EVERYPROPERTY_API_URL to this project's env mechanism (.env / config), default
   http://localhost:3007 for dev, with a documented [PROPERTYIQ_PROD_URL] slot for prod.
4. DATA MODULE: add ONE thin module in this project's language (e.g. Node child_process /
   Python subprocess) that runs the CLI commands, parses JSON, surfaces errors clearly, and
   exposes functions like `getCmaPack(address)` and `getProposalData(address)`. Match this
   project's existing style and error handling. No new heavy dependencies — use the stdlib
   process API. STOP AND ASK before adding any dependency.
5. WIRE ONE FLOW: connect that module to one real spot in the CMA generation flow (subject
   property + comparables + price estimate). If the flow doesn't exist yet, add a single
   runnable example/script instead. Do NOT refactor unrelated code.
6. DOCS: add a short "PropertyIQ data (everypropertyAI)" section to the README — setup, env,
   the two main functions, and the ~120s uncached-latency caveat.

## Hard constraints
- Only make changes directly requested. Do NOT add features, abstractions, or files beyond the
  data module + config + one wiring point + docs.
- Do NOT modify the everypropertyAI/PropertyIQ source — only `npm run build`/`npm link` it.
- STOP AND ASK before: adding any dependency, changing this project's data model/schema, or
  any destructive/irreversible action.
- Keep all property data behind the env-configured base URL — never hardcode a URL.

## Verify before declaring done
- `everypropertyai cma "9 Gloucester Ave Berwick"` returns JSON with a non-empty `subject` and
  `priceEstimate` (PropertyIQ running on :3007).
- This project's `getCmaPack("9 Gloucester Ave Berwick")` returns the same parsed data.
- The wired flow (or example script) runs and shows the subject + comps + estimate.
- Report a final summary: files added/changed, how to set the prod URL, and any STOP-AND-ASK
  items still open.
```
