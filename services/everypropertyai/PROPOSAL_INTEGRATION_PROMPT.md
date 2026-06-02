# Proposal tool integration — Claude Code prompt ("Look up property from everyproperty")

Paste the block below into a **Claude Code session running inside the proposal tool repo**. It wires
a **"look up property" search step**: the user searches an address, the tool fetches
presentation-ready property data from the `everypropertyai` CLI, previews it, and seeds the proposal
document with it.

> Note: on Stuart's Mac the CLI is **already built and `npm link`ed** (global `everypropertyai`
> command verified working against PropertyIQ on `:3007`). On that machine, step 2 is a no-op
> beyond confirming `everypropertyai --version`. On a fresh machine, run step 2 in full.

## How to use

1. `cd` into the **proposal tool** repo
2. Start a Claude Code session there
3. Paste everything inside the code fence below as the first message
4. Prereq: PropertyIQ must be reachable at `EVERYPROPERTY_API_URL` (defaults to `http://localhost:3007`)

---

```
You are integrating an existing internal tool, "everypropertyAI", into THIS project (the proposal
tool). everypropertyAI is a CLI that returns PropertyIQ property data as JSON. Your job is to add a
"look up property" search step so this tool fetches presentation-ready property data from the CLI
and seeds a proposal document with it. Work only in this repo except for the one build/link step
noted below.

## Context (carry forward — do not re-derive)
- everypropertyAI lives in another local repo at:
  "/Users/stuartgrant_mbp13/Library/Mobile Documents/com~apple~CloudDocs/GEA_Projects/GEA_/GEA_everypropertyAI/propertyiq/services/everypropertyai"
- It is a thin CLI/MCP wrapper over the PropertyIQ HTTP API. It needs the PropertyIQ app reachable
  via the env var EVERYPROPERTY_API_URL (default http://localhost:3007). A deployed URL can be set
  later: EVERYPROPERTY_API_URL=[PROPERTYIQ_PROD_URL]. An optional EVERYPROPERTY_API_TOKEN bearer is
  supported if the data routes get shared-secret auth.
- Integration mode for THIS project = CLI (shell out, parse JSON). Do NOT add an MCP server,
  do NOT reimplement any scraping/merge/data logic, do NOT copy PropertyIQ source.

## CLI surface (commands you will call — all print JSON; add nothing else)
- everypropertyai proposal "<address>"   → PRESENTATION-READY property data — THE PRIMARY ONE here
- everypropertyai search "<query>"       → address suggestions (the lookup/resolve step)
- everypropertyai property|cma|comps|sold ...  → exist, but OUT OF SCOPE for this tool

`proposal` JSON shape (ProposalPropertyData):
{
  "address", "addressSlug",
  "bedrooms", "bathrooms", "carSpaces", "landAreaSqm", "propertyType",
  "priceEstimate",                 // { low, mid, high, source } or similar (may be absent)
  "formattedEstimate",             // e.g. "$1,250,000" — ready to print
  "agency", "agentName",
  "heroPhotos": [],                // up to ~6 image URLs
  "suburb", "description",
  "confidence"                     // 0..1 overall confidence
}
IMPORTANT: any field may be absent/empty — guard before rendering into the proposal. Use
`confidence` to decide how prominently to surface auto-filled values.

## Feature spec — the lookup step
Add ONE "look up property" search box to the proposal-creation flow:
1. As the user types, call `search "<query>"` → show address suggestions; user picks one.
2. On select, call `proposal "<confirmed address>"` → PREVIEW the returned fields (formatted
   estimate, beds/baths/land, property type, hero photos, agency/agent, suburb, description).
3. On confirm, seed the proposal document with those fields. Never silently overwrite a value the
   user has already edited — prefer the user's value or ask.

## Latency note
`proposal` runs the full property pipeline internally: an UNCACHED address can take up to ~120s (it
triggers a live crawl); cached addresses return in <2s. Make the fetch async with a loading state
and a generous (~150s) timeout. PropertyIQ (or its deployed URL) MUST be reachable or every call
fails fast with a clear error.

## Starting state
This is the proposal tool repo. Its stack is not assumed.

## Target state (done when ALL true)
1. The `everypropertyai` CLI is callable from this machine (verified).
2. This project has a single, thin data-access module that shells out to the CLI and returns
   typed/parsed JSON: `getProposalData(address)` (wraps `proposal`) and `suggestAddresses(query)`
   (wraps `search`).
3. EVERYPROPERTY_API_URL is configured for local dev and documented for prod (env, not hardcoded).
4. Exactly ONE place — the lookup/search step in the proposal flow — is wired to resolve an address,
   fetch proposal data, preview it, and seed a proposal (or, if no flow exists yet, a single runnable
   example/script demonstrating it).
5. A short README/section documents setup + usage.

## Steps (do in order; output "✅ <step>" after each)
1. DETECT STACK: inspect this repo (package.json / pyproject / etc.). Report language, framework, the
   proposal-creation flow, and where a subject property/address is entered. STOP AND ASK if the stack
   is ambiguous or there are multiple apps.
2. BUILD + LINK THE CLI (one-time, in the everypropertyAI repo — the only out-of-repo action):
   cd into the path above, run `npm install` (if needed), `npm run build`, then `npm link`.
   Verify with `everypropertyai --version` and a smoke test:
   `EVERYPROPERTY_API_URL=http://localhost:3007 everypropertyai proposal "9 Gloucester Ave Berwick"`.
   If `npm link` is undesirable, call via the built binary's absolute path. Do not proceed until a
   CLI call returns JSON. (On Stuart's Mac this is already linked — just confirm `--version`.)
3. CONFIG: add EVERYPROPERTY_API_URL to this project's env mechanism (.env / config), default
   http://localhost:3007 for dev, with a documented [PROPERTYIQ_PROD_URL] slot for prod.
4. DATA MODULE: add ONE thin module in this project's language (Node child_process / Python
   subprocess / etc.) exposing `getProposalData(address)` + `suggestAddresses(query)`. Parse JSON,
   surface errors clearly, match this project's style. No new heavy dependencies — use the stdlib
   process API. STOP AND ASK before adding any dependency.
5. WIRE THE LOOKUP STEP: connect the module to the proposal flow — search box → suggestions →
   select → fetch proposal data → preview → seed the proposal document. Respect the
   no-silent-overwrite rule. If the flow doesn't exist yet, add a single runnable example/script.
   Do NOT refactor unrelated code.
6. DOCS: add a short "PropertyIQ data (everypropertyAI)" section to the README — setup, env, the two
   functions, the lookup-step flow, and the ~120s uncached-latency caveat.

## Hard constraints
- Only make changes directly requested. Do NOT add features, abstractions, or files beyond the data
  module + config + one wiring point (the lookup step) + docs.
- Do NOT modify the everypropertyAI/PropertyIQ source — only `npm run build` / `npm link` it.
- STOP AND ASK before: adding any dependency, changing this project's data model/schema, or any
  destructive/irreversible action.
- Keep all property data behind the env-configured base URL — never hardcode a URL.
- Never overwrite a user-edited proposal field silently.

## Verify before declaring done
- `everypropertyai proposal "9 Gloucester Ave Berwick"` returns JSON with non-empty subject fields
  and a `formattedEstimate` (PropertyIQ running on :3007).
- This project's `getProposalData("9 Gloucester Ave Berwick")` returns the same parsed data.
- The lookup step resolves an address (via `search`), previews the proposal fields, and seeds a
  proposal document.
- Report a final summary: files added/changed, how to set the prod URL, and any STOP-AND-ASK items
  still open.
```
