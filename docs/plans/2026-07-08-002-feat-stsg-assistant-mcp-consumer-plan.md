---
title: "feat: Add GEA_ST_SG_assistant as an MCP consumer of the everypropertyAI API"
status: active
date: 2026-07-08
type: feat
depth: standard
---

# feat: Add GEA_ST_SG_assistant as an MCP consumer of the everypropertyAI API

## Summary

Onboard a new server-to-server consumer, **GEA_ST_SG_assistant** (Stuart's work-assistant bot + its OpenClaw agent, running on the Vultr VPS and Stuart's Mac), to the existing authenticated everypropertyAI HTTP API via MCP.

**Key scoping decision (confirmed with user):** a working stdio MCP server already exists at `services/everypropertyai/` and already wraps 8 of the 9 requested tools with the exact shape the spec describes (official `@modelcontextprotocol/sdk`, stdio transport, bearer-header client, `EVERYPROPERTY_API_URL` / `EVERYPROPERTY_API_TOKEN` env config, per-request timeout). Rather than build a parallel `services/mcp-everypropertyai/` that duplicates it, we **extend the existing server**: add the two missing tools (`agent_listings`, `vendor_report`), align timeouts to spec, provision a dedicated consumer key, and ship the deliverables (smoke test, README MCP config, INTEGRATIONS.md updates). GEA_ST_SG_assistant points at the one server with its own independently-rotatable key.

This supersedes the spec's "build a new server at `services/mcp-everypropertyai/`" — same outcome (a thin, per-consumer MCP entry point), no second server to keep in sync.

---

## Problem Frame

The everypropertyAI Next.js app exposes an authenticated HTTP API (`Authorization: Bearer <token>`, token ∈ `EVERYPROPERTY_API_KEYS`). Claude-based agents can't call HTTP endpoints directly as tools — they need an MCP server that maps endpoints to tools with LLM-legible descriptions.

`services/everypropertyai/` is that MCP server. Its current tool set: `search_address`, `fetch_property`, `comparable_sales`, `sold_sales`, `on_market_listings`, `rental_listings`, `enrich`, `street_details`, `generate_cma_pack`, `proposal_property_data`. Mapping to the spec's requested 9:

| Spec tool | Status in existing server |
|---|---|
| `search_address` | ✅ exists |
| `get_property` | ✅ exists as `fetch_property` (POST `/api/property`, `fast`) |
| `get_proposal` | ✅ exists as `proposal_property_data` (GET `/api/proposal`) |
| `sold_sales` | ✅ exists |
| `comparable_sales` | ✅ exists |
| `on_market_listings` | ✅ exists (incl. `sinceDays`) |
| `rental_listings` | ✅ exists (incl. `minRent`/`maxRent`/`sinceDays`) |
| `agent_listings` | ❌ **missing** — GET `/api/agents/listings` |
| `vendor_report` | ❌ **missing** — GET `/api/vendor-report` |

So the code delta is two tools + client methods, a timeout alignment, and deliverables. The consumer-onboarding delta is a new key and docs.

**Naming note:** the existing tools `fetch_property` / `proposal_property_data` already satisfy the spec's `get_property` / `get_proposal` intent. Renaming them would break the current CMA/proposal consumers that depend on those tool names. **Decision:** keep existing names; do not add aliases (an LLM reads the description, not the name). Flagged as an open question below in case the user wants the spec names surfaced.

---

## Requirements

- R1. A dedicated consumer key `epai_stsg_<32 hex CSPRNG>` exists in the server's `EVERYPROPERTY_API_KEYS` allowlist (local `.env.local` + Railway `geaeverypropertyai-production`), independently rotatable.
- R2. The MCP server exposes `agent_listings` mapping 1:1 to `GET /api/agents/listings` (`name`+optional `agency`, or `agentId`).
- R3. The MCP server exposes `vendor_report` mapping 1:1 to `GET /api/vendor-report` (`address`, or `lat`+`lng`; optional `radius`, `excludeAddress`).
- R4. Fetch timeouts match spec: 130s for `fetch_property` / `proposal_property_data` (synchronous crawl ≤110s), 30s for all other tools.
- R5. Non-200 responses surface as tool errors carrying the response body text — not swallowed. (Confirm the existing `safe()` wrapper + `PropertyIQError` already do this; extend if not.)
- R6. A smoke test drives `search_address` and `sold_sales` **through the MCP protocol** (given a real token) and asserts non-empty, well-formed results.
- R7. Deliverables: `services/everypropertyai/README.md` documents the `claude mcp add` / JSON config snippet + required env vars for GEA_ST_SG_assistant; `INTEGRATIONS.md` gains the new consumer row, `epai_stsg_` key-convention entry, and an MCP section.
- R8. The new key value is reported to the user at the end (stored in the consumer's env; committed nowhere).

---

## Key Technical Decisions

- **Extend `services/everypropertyai/`, don't fork.** One server, one client, no drift. (see Problem Frame)
- **Keep existing tool names** `fetch_property` / `proposal_property_data`; do not rename or alias to `get_property` / `get_proposal` — renaming breaks live CMA/proposal consumers, and tool selection is description-driven.
- **Per-call timeout override.** The client currently takes a single `timeoutMs` (default 120s). Add an optional per-request timeout so `fetch_property` / `proposal_property_data` use 130s and everything else uses 30s (R4), rather than one global value.
- **New client methods mirror existing GET primitives.** `agentListings()` and `vendorReport()` follow the exact shape of `soldSales()` / `onMarketListings()` in `services/everypropertyai/src/client.ts` — thin `this.request("/api/…", { query })` wrappers, zod-validated tool inputs, no business logic.
- **Key generation is CSPRNG at execution time**, appended (not overwritten) to `EVERYPROPERTY_API_KEYS`. The Railway change and the key value are execution-time/ops actions; the value is never committed.

---

## Implementation Units

### U1. Provision the GEA_ST_SG_assistant consumer key

**Goal:** `epai_stsg_<32 hex>` exists in the allowlist and the consumer is recorded.

**Requirements:** R1, R8

**Dependencies:** none

**Files:**
- `.env.local` — append the new key to `EVERYPROPERTY_API_KEYS` (comma-separated).
- `INTEGRATIONS.md` — add GEA_ST_SG_assistant to the Consumer status line; add `epai_stsg_` to the key-convention examples.
- Railway `geaeverypropertyai-production` service variables — append to `EVERYPROPERTY_API_KEYS` (outward-facing; done at execution, confirm before redeploy).

**Approach:** Generate the key with a CSPRNG (≈32 hex chars) following the `epai_<consumer>_<random>` convention documented in `INTEGRATIONS.md` (Key convention section). **Append** to the allowlist in all three locations per the "Provision a consumer" runbook already in `INTEGRATIONS.md` — never overwrite existing keys. Redeploy the Railway service so the new key takes effect. Report the value to the user at the end; do not commit it.

**Patterns to follow:** the existing `epai_cma_` / `epai_crm_` / `epai_wcv_` provisioning steps in `INTEGRATIONS.md`.

**Test scenarios:** `Test expectation: none — key provisioning + env/doc change.` Verification is the curl check below, not a unit test.

**Verification:** `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer epai_stsg_…" <prod-url>/api/search?q=test` returns 200 (not 401) after redeploy — confirms the key is in the live allowlist.

---

### U2. Add `agentListings` + `vendorReport` client methods and types

**Goal:** the client can call the two missing endpoints, 1:1.

**Requirements:** R2, R3, R5

**Dependencies:** none

**Files:**
- `services/everypropertyai/src/client.ts` — add `agentListings()` and `vendorReport()` methods.
- `services/everypropertyai/src/types.ts` — add response/param types for both (mirror the route handlers' shapes).
- `services/everypropertyai/src/__tests__/client.test.ts` — add coverage (see scenarios).

**Approach:** Mirror the existing GET primitives (`soldSales`, `onMarketListings`). Read the two route handlers to get exact params:
- `agent_listings` → `GET /api/agents/listings` with `{ name, agency? }` **or** `{ agentId }` (base64url of `name|agency`). Unknown agent returns 200 `{ agent: null, listings: [] }` — pass through, don't treat as error.
- `vendor_report` → `GET /api/vendor-report` with `{ lat, lng }` **or** `{ address }`; optional `radius` (defaults server-side), `excludeAddress`.
No new endpoints, no DB access — pure `this.request(path, { query })` wrappers. Rely on the existing `request()` error path (`PropertyIQError` with status + body) for R5.

**Patterns to follow:** `soldSales()` / `onMarketListings()` in the same file; `request()` helper's query serialization.

**Test scenarios:**
- Happy path: `agentListings({ name: 'Jane Smith', agency: 'Barry Plant' })` issues `GET /api/agents/listings?name=Jane%20Smith&agency=Barry%20Plant` with the bearer header; returns parsed `{ agent, listings }`.
- Happy path: `vendorReport({ lat: -38.03, lng: 145.3 })` issues the correct query; `vendorReport({ address: '10 Smith St, Berwick' })` issues `?address=…`.
- Edge: unknown agent → 200 `{ agent: null, listings: [] }` resolves (not thrown).
- Error path: 401 → `PropertyIQError` naming the missing/invalid token (mirror existing auth-failure test); 500 with body → error carries the body text (R5).

**Verification:** `npm run typecheck` clean; new client tests pass under vitest.

---

### U3. Register `agent_listings` + `vendor_report` MCP tools

**Goal:** both tools are callable over MCP with LLM-guiding descriptions.

**Requirements:** R2, R3

**Dependencies:** U2

**Files:**
- `services/everypropertyai/src/mcp.ts` — two new `server.tool(...)` registrations wrapping the U2 client methods via `safe()`.

**Approach:** Follow the existing `server.tool(name, description, zodShape, handler)` pattern. zod input shapes:
- `agent_listings`: `{ name: z.string().optional(), agency: z.string().optional(), agentId: z.string().optional() }` — description states "provide `name` (+ optional `agency` to disambiguate) OR `agentId`; returns ≤20 recent listings + sales, newest first; unknown agent returns an empty result, not an error."
- `vendor_report`: `{ address: z.string().optional(), lat: z.number().optional(), lng: z.number().optional(), radius: z.number().optional(), excludeAddress: z.string().optional() }` — description states "provide `address` OR `lat`+`lng`; `radius` in km; returns the 3 closest sold sales + 3 newest listings around the point."

Descriptions must carry units/quirks per spec (weekly rent already noted on `rental_listings`; VIC-biased autocomplete on `search_address`).

**Patterns to follow:** existing `sold_sales` / `on_market_listings` tool blocks in `mcp.ts`.

**Test scenarios:** `Test expectation: covered by U5 MCP-protocol smoke test + U2 client unit tests.` The tool layer is a thin `safe(() => client.x(args))` wrapper with no logic of its own.

**Verification:** MCP `ListTools` now reports 12 tools including `agent_listings` and `vendor_report`; a manual `CallTool` for each returns data.

---

### U4. Align fetch timeouts to spec (130s crawl tools, 30s rest)

**Goal:** long crawl tools get 130s; everything else 30s.

**Requirements:** R4, R5

**Dependencies:** U2

**Files:**
- `services/everypropertyai/src/client.ts` — allow a per-request timeout override on `request()` (and/or per-method), replacing the single global 120s default where needed.
- `services/everypropertyai/src/mcp.ts` — ensure `fetch_property` / `proposal_property_data` invoke with 130s; other tools with 30s.
- `services/everypropertyai/src/__tests__/client.test.ts` — timeout-selection coverage.

**Approach:** Thread an optional `timeoutMs` into `request()` options (the `AbortSignal.timeout(...)` already exists — currently reads the instance default). Crawl-bearing calls pass 130s; all others 30s. Keep it minimal — no retry framework (per spec).

**Test scenarios:**
- `fetch_property` / `proposal_property_data` use a 130s signal; a representative fast tool (e.g. `sold_sales`) uses 30s. Assert the timeout value selected per call (inject/observe, don't wait real time).
- Error path: an aborted request surfaces as a `PropertyIQError` (timeout), not a hang.

**Verification:** unit test asserts the per-call timeout; `npm run typecheck` clean.

---

### U5. Deliverables — MCP-protocol smoke test, README config, INTEGRATIONS.md MCP section

**Goal:** a runnable smoke test and the consumer-facing docs.

**Requirements:** R6, R7

**Dependencies:** U3

**Files:**
- `services/everypropertyai/src/__tests__/mcp-smoke.test.ts` (or a `scripts/` smoke script) — drives the server over MCP.
- `services/everypropertyai/README.md` — build/run + the exact `claude mcp add` / JSON config snippet (command `node`, args `dist/mcp.js`, env `EVERYPROPERTY_API_URL` + `EVERYPROPERTY_API_TOKEN`) + required env vars.
- `INTEGRATIONS.md` — new consumer row in the endpoint/consumer context; an MCP section describing the server, its tools, and how a consumer wires it.

**Approach:** The smoke test spins up the server over an in-process stdio pair (MCP SDK `Client` + `StdioClientTransport`, or the SDK's in-memory transport), lists tools, then calls `search_address` (q ≥3 chars) and `sold_sales` (a real suburb), asserting non-empty, well-formed results. Gate it on a real `EVERYPROPERTY_API_TOKEN` being present (skip with a clear message when absent, so CI without secrets doesn't fail). README config snippet must be copy-pasteable for both the VPS and Stuart's Mac.

**Execution note:** Write the smoke test against the MCP protocol surface (Client → transport → server), not by calling the client class directly — R6 requires proving the protocol path.

**Test scenarios:**
- `Covers R6.` With a real token: MCP `ListTools` includes the expected tools; `search_address('43 glenview')` returns non-empty `suggestions`; `sold_sales({ suburb: 'Berwick' })` returns a non-empty, well-formed sales array.
- No-token: the smoke test skips (or errors) with a message pointing at `EVERYPROPERTY_API_TOKEN`, rather than a confusing assertion failure.

**Verification:** `npm test` runs the smoke test green with a token present and skips cleanly without; README snippet successfully registers the server via `claude mcp add` on a test machine.

---

## Scope Boundaries

**In scope:** the two new tools + client methods, timeout alignment, the consumer key, smoke test, README + INTEGRATIONS.md docs.

**Non-goals:**
- No new HTTP API endpoints, no DB access, no business logic in the MCP layer.
- No auth logic beyond passing the bearer header; no caching (the API caches); no retry framework.
- No rename/removal of existing tools.

### Deferred to Follow-Up Work
- Optional `get_property` / `get_proposal` **aliases** for the spec names — only if the user wants the spec vocabulary surfaced (see Open Questions).
- Publishing the MCP server as an installable package/binary for the VPS (currently run from the repo checkout via `node dist/mcp.js`).

---

## Open Questions

- **Tool naming:** keep `fetch_property` / `proposal_property_data`, or also expose `get_property` / `get_proposal` aliases? Default: keep existing names only (renaming breaks live consumers). Resolve at execution if the user cares about the spec vocabulary.

---

## Risks & Dependencies

- **Security — key handling (R1/R8):** the `epai_stsg_` value must never be committed or pasted into logs/PRs. It lives only in `.env.local` (gitignored) and Railway vars. INTEGRATIONS.md already warns on this — follow it.
- **Railway redeploy (external contract surface):** appending to `EVERYPROPERTY_API_KEYS` on the production service is outward-facing; confirm before redeploy, and append-only so existing consumers are unaffected.
- **Timeout change touches all tools:** U4 alters the shared client timeout path used by the live CMA/proposal consumers — verify the 30s default doesn't truncate any currently-working non-crawl call (all non-crawl endpoints are fast DB queries, so 30s is ample, but confirm `comparable_sales` on a large radius stays under it).
- **Smoke test needs a real token:** gate on env so CI without secrets skips rather than fails.
