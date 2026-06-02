# CRM project integration — Claude Code prompt ("Add property details from everyproperty")

Paste the block below into a **Claude Code session running inside the gea_crmai repo**. It wires an
**"add property details from everyproperty"** feature: on a contact/lead, the user confirms an
address and the CRM pulls a full merged property profile via the `everypropertyai` CLI and stores
the mapped fields on that record.

> Note: on Stuart's Mac the CLI is **already built and `npm link`ed** (global `everypropertyai`
> command verified working against PropertyIQ on `:3007`). On that machine, step 2 is a no-op
> beyond confirming `everypropertyai --version`. On a fresh machine, run step 2 in full.

## How to use

1. `cd` into the **gea_crmai** repo
2. Start a Claude Code session there
3. Paste everything inside the code fence below as the first message
4. Prereq: PropertyIQ must be reachable at `EVERYPROPERTY_API_URL` (defaults to `http://localhost:3007`)

---

```
You are integrating an existing internal tool, "everypropertyAI", into THIS project (gea_crmai,
the CRM). everypropertyAI is a CLI that returns PropertyIQ property data as JSON. Your job is to
add an "add property details from everyproperty" feature: on a CONTACT/LEAD record, given a
confirmed address, fetch the full merged property profile via the CLI and store the mapped fields
on that record. Work only in this repo except for the one build/link step noted below.

## Context (carry forward — do not re-derive)
- everypropertyAI lives in another local repo at:
  "/Users/stuartgrant_mbp13/Library/Mobile Documents/com~apple~CloudDocs/GEA_Projects/GEA_/GEA_everypropertyAI/propertyiq/services/everypropertyai"
- It is a thin CLI/MCP wrapper over the PropertyIQ HTTP API. It needs the PropertyIQ app
  reachable via the env var EVERYPROPERTY_API_URL (default http://localhost:3007). A deployed
  URL can be set later: EVERYPROPERTY_API_URL=[PROPERTYIQ_PROD_URL]. An optional
  EVERYPROPERTY_API_TOKEN bearer is supported if the data routes get shared-secret auth.
- Integration mode for THIS project = CLI (shell out, parse JSON). Do NOT add an MCP server,
  do NOT reimplement any scraping/merge/data logic, do NOT copy PropertyIQ source.

## CLI surface (commands you will call — all print JSON; add nothing else)
- everypropertyai property "<address>"   → FULL MERGED PROFILE — THE PRIMARY ONE for this feature
- everypropertyai search "<query>"       → address suggestions (resolve/confirm before fetching)
- everypropertyai comps  --suburb <s> --state <st> [--beds n --baths n]   (not needed here)
- everypropertyai sold   --suburb <s> --state <st> [--limit n]            (not needed here)
- everypropertyai cma "<address>"        → CMA pack (used by the CMA tool, not this one)
- everypropertyai proposal "<address>"   → presentation fields (used by the proposal tool, not this one)

`property` JSON shape (PropertyResponse):
{
  "profile": {
    "data": { ... },                  // LOOSE merged map of 20+ fields, read BY NAME (see below)
    "fieldConfidences": { "<field>": { "confidence": 0..1, "contributedBy": ["source", ...] } },
    "overallConfidence": 0..1,
    "sources": [ { "name", "extractedAt", "hasErrors" } ],
    "mergedAt": "ISO"
  },
  "source": "cache" | "fresh" | "partial",
  "addressSlug": "9-gloucester-ave-berwick-vic-3806",
  "warning": "optional string"
}

IMPORTANT about profile.data: it is intentionally LOOSE (the app merges 20+ sources into it).
Read fields by name; treat any field as possibly-absent. Use `fieldConfidences[field].confidence`
and `overallConfidence` to GATE what you write — do not blindly trust every field.

## Feature spec
On a contact/lead, when the user confirms an address:
1. Optionally call `search "<typed address>"` to resolve to a clean suggestion the user picks.
2. Call `property "<confirmed address>"`.
3. Map a DEFINED, STABLE subset of profile.data onto the contact's property fields, e.g.:
   bedrooms, bathrooms, carSpaces, landAreaSqm, buildingAreaSqm, propertyType,
   lastSalePrice, lastSaleDate, listedPrice, suburb, state, postcode.
   (Confirm exact source key names against the data you actually receive — log unknown keys,
   don't guess silently.)
4. Also store provenance on the record: overallConfidence, addressSlug, source, mergedAt.
5. Only write a field when present AND its confidence clears a threshold (default 0.5 — make it a
   constant). NEVER silently overwrite a value a user has manually edited; on conflict, prefer the
   user's value (or surface it for confirmation). STOP AND ASK before changing the CRM schema/model
   or defining a merge policy that overwrites user data.

## Latency note
`property` for an UNCACHED address can take up to ~120s (it triggers a live crawl); cached
addresses return in <2s. Make the fetch async with a loading state and a generous (~150s) timeout.
PropertyIQ (or its deployed URL) MUST be reachable or every call fails fast with a clear error.

## Starting state
This is the gea_crmai repo. Its stack is not assumed.

## Target state (done when ALL true)
1. The `everypropertyai` CLI is callable from this machine (verified).
2. This project has a single, thin data-access module that shells out to the CLI and returns
   typed/parsed JSON for: `getPropertyDetails(address)` (wraps `property`) and, optionally,
   `suggestAddresses(query)` (wraps `search`).
3. A pure FIELD-MAPPER function maps a PropertyResponse → this CRM's contact property fields,
   confidence-gated, with provenance.
4. EVERYPROPERTY_API_URL is configured for local dev and documented for prod (env, not hardcoded).
5. Exactly ONE place in the contact/lead add-address flow is wired to fetch + populate details
   (or, if no such flow exists yet, a single runnable example/script demonstrating it).
6. A short README/section documents setup + usage.

## Steps (do in order; output "✅ <step>" after each)
1. DETECT STACK: inspect this repo (package.json / pyproject / etc.). Report language, framework,
   the contact/lead model, and where data-fetching + the add-address flow live. STOP AND ASK if the
   stack is ambiguous or there are multiple apps.
2. BUILD + LINK THE CLI (one-time, in the everypropertyAI repo — the only out-of-repo action):
   cd into the path above, run `npm install` (if needed), `npm run build`, then `npm link`.
   Verify with `everypropertyai --version` and a smoke test:
   `EVERYPROPERTY_API_URL=http://localhost:3007 everypropertyai search "9 Gloucester Ave Berwick"`.
   If `npm link` is undesirable, call via the built binary's absolute path instead. Do not proceed
   until a CLI call returns JSON. (On Stuart's Mac this is already linked — just confirm `--version`.)
3. CONFIG: add EVERYPROPERTY_API_URL to this project's env mechanism (.env / config), default
   http://localhost:3007 for dev, with a documented [PROPERTYIQ_PROD_URL] slot for prod.
4. DATA MODULE: add ONE thin module in this project's language (Node child_process / Python
   subprocess / etc.) that runs `property` (and `search`), parses JSON, surfaces errors clearly,
   and exposes `getPropertyDetails(address)` + `suggestAddresses(query)`. Match this project's
   existing style and error handling. No new heavy dependencies — use the stdlib process API.
   STOP AND ASK before adding any dependency.
5. FIELD MAPPER: add a PURE function `mapPropertyToContactFields(propertyResponse)` that returns the
   confidence-gated subset above + provenance. Keep the field list and the confidence threshold as
   named constants. Log any profile.data keys you don't map (don't drop them silently).
6. WIRE ONE FLOW: connect the data module + mapper to ONE real spot in the contact/lead
   add-address path — fetch on address confirm, populate the mapped fields, respect the
   no-silent-overwrite rule. If the flow doesn't exist yet, add a single runnable example/script.
   Do NOT refactor unrelated code.
7. DOCS: add a short "PropertyIQ data (everypropertyAI)" section to the README — setup, env, the two
   functions, the field mapping + confidence gate, and the ~120s uncached-latency caveat.

## Hard constraints
- Only make changes directly requested. Do NOT add features, abstractions, or files beyond the
  data module + field mapper + config + one wiring point + docs.
- Do NOT modify the everypropertyAI/PropertyIQ source — only `npm run build` / `npm link` it.
- STOP AND ASK before: adding any dependency, changing this project's data model/schema, defining
  any overwrite/merge policy that can clobber user-entered data, or any destructive/irreversible
  action.
- Keep all property data behind the env-configured base URL — never hardcode a URL.

## Verify before declaring done
- `everypropertyai property "9 Gloucester Ave Berwick"` returns JSON with a non-empty
  `profile.data` and an `overallConfidence` (PropertyIQ running on :3007).
- This project's `getPropertyDetails("9 Gloucester Ave Berwick")` returns the same parsed data.
- `mapPropertyToContactFields(...)` returns the gated subset + provenance for that response.
- The wired flow (or example script) runs and populates the contact with the mapped fields.
- Report a final summary: files added/changed, how to set the prod URL, the fields mapped + the
  confidence threshold used, and any STOP-AND-ASK items still open.
```
