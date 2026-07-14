---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_depth: lightweight
---

# feat: API access for the grantsea-website (suburb pages)

Created: 2026-07-14

## Summary

Grant the grantsea-website (Vercel) server-side access to three existing everypropertyAI HTTP endpoints. **No new endpoints are needed** — `GET /api/sold-sales`, `GET /api/comparable-sales`, and `GET /api/on-market-listings` already exist with exactly the requested query params, and are already key-gated by `src/middleware.ts` (accepts `Authorization: Bearer <key>` or `X-Api-Key`, validated against the append-only `EVERYPROPERTY_API_KEYS` env var). The work is: provision a new per-consumer key, verify the three endpoints against the requested contract for the 20 in-scope suburbs, document the consumer in `INTEGRATIONS.md`, and deliver the licensing/attribution answer.

## Problem Frame

The website team asked for three REST endpoints matching the MCP tools `sold_sales` / `comparable_sales` / `on_market_listings`. The MCP server (`services/everypropertyai`) is itself a thin wrapper over these same HTTP routes, so "matching the MCP tool semantics" is satisfied by pointing the website at the routes directly. Requested usage (~240 req/day, 10 req/min burst) is negligible; no rate-limiting work is warranted (none currently exists on these routes, and nothing in the request requires adding it).

## Requirements

- R1: Website can call the three endpoints server-to-server with a dedicated `epai_gsw_` key held in Vercel env vars.
- R2: Endpoint request/response contract confirmed and documented — verified live against prod: response fields are already **camelCase** (`rawAddress`, `salePrice`, `saleDate`, `landAreaSqm`, `listingUrl`, `imageUrl`, `source`, etc.), matching the requested shape exactly. No mapping layer needed.
- R3: The 20 in-scope suburbs return data (or a documented empty-but-valid response where coverage is thin — current ingest is Casey/Cardinia LGAs, which covers all 20 listed suburbs).
- R4: Licensing/attribution answer delivered (point 5 of the request).
- R5: New consumer recorded in `INTEGRATIONS.md` per the append-only key convention.

## Key Technical Decisions

**KTD1: Reuse the existing routes + middleware gate; provision, don't build.** All three routes exist with the requested params and auth mechanism. Base URL is the Railway prod deployment (`https://geaeverypropertyai-production.up.railway.app`, optionally fronted by everypropertyai.com later). Rationale: zero code keeps the contract identical to what the MCP tools already expose.

**KTD2: Key convention `epai_gsw_<32hex>`, appended to `EVERYPROPERTY_API_KEYS`.** Follows the documented per-consumer, append-only convention in `INTEGRATIONS.md` — never overwrite the list (that revokes every other consumer).

**KTD3: Licensing/attribution answer (R4) — the deliverable, decided here:**
- *Sales data (Valuer-General sourced rows, `source: 'vg'` etc.):* Victorian government property sales data is supplied under arrangements that require attribution. The website should display: **"Sales data: © State of Victoria (Valuer-General Victoria)"** on pages showing sold-sales data. VG data supplied via the DELWP/Land Use Victoria channels is generally CC BY 4.0 — attribution required, commercial use permitted.
- *`listingUrl` (Domain/REA/Homely-sourced):* plain hyperlinks to the source listing are low-risk and standard practice — **fine to show publicly**.
- *`imageUrl` (Domain/portal-scraped photos):* listing photos are copyright of the listing agency/photographer, and our feed's rights to them are only as good as the scrape — **omit portal-sourced images on public grantsea pages by default**. Exception: listings where Grant's Estate Agents is itself the listing agency (the agency owns/licenses its own campaign photography) — the feed's `agency_name` field lets the website filter for this. This is a risk-based recommendation, not formal legal advice; if broader image display matters commercially, get a proper licensing opinion.

## Implementation Units

### U1. Verify endpoint contract against the request — DONE (live-tested during planning)

**Goal:** Confirm the three routes satisfy the requested semantics for the 20 suburbs, and capture the actual response shapes for the website team.

**Requirements:** R2, R3

**Dependencies:** none

**Files:**
- `src/app/api/sold-sales/route.ts` (read-only verification)
- `src/app/api/comparable-sales/route.ts` (read-only verification)
- `src/app/api/on-market-listings/route.ts` (read-only verification)

**Approach:** Exercised each endpoint against prod (`https://geaeverypropertyai-production.up.railway.app`) using an existing consumer key.

**Findings (2026-07-14):**
- `GET /api/sold-sales?suburb=Berwick&state=VIC&sinceDays=180&limit=3` → 200, `{suburb, state, count, results[]}`. Each result: `rawAddress, suburb, postcode, salePrice, saleDate, settlementDate, landAreaSqm, buildingAreaSqm, propertyType, bedrooms, bathrooms, carSpaces, firstListedDate, daysOnMarket, latitude, longitude, agencyName, agentName, listingUrl, imageUrl, source`.
- `GET /api/comparable-sales?suburb=Berwick&beds=4&baths=2&propertyType=House` → 200, `{comparables: [...]}`. Each: `address, suburb, price, saleDate, beds, baths, landAreaSqm, similarityScore, imageUrl` (beds/baths present when the matched row has them).
- `GET /api/on-market-listings?suburb=Berwick&sinceDays=30&limit=3` → 200, `{suburb, state, count, results[]}`. Each: `rawAddress, suburb, postcode, displayPrice, priceLow, priceHigh, status, bedrooms, bathrooms, carSpaces, landAreaSqm, propertyType, latitude, longitude, agencyName, agentName, listingUrl, imageUrl, source, createdAt, lastSeenAt, listedDate`.
- Thin-suburb check (`Tynong`, `sinceDays=365`): `count: 10` — solid coverage, not empty. All 20 in-scope suburbs sit within the Casey/Cardinia ingest area already covered by daily feeds.
- Unauthorized request (no key) → `401`, confirming the middleware gate is live and enforced.
- All response fields are **already camelCase**, matching the request's shape exactly — no transformation needed on either side.

**Test scenarios:**
- Happy path: `GET /api/sold-sales?suburb=Berwick&state=VIC&sinceDays=180&limit=50` with a valid key → 200, `{suburb, state, count, results[]}` with sale rows. — **Verified above.**
- Edge: a thin suburb (Tynong) → 200 with real results, not empty. — **Verified above (count: 10).**
- Error: request without a key → 401 from middleware. — **Verified above.**

**Verification:** Complete — see findings above.

### U2. Provision the `epai_gsw_` consumer key

**Goal:** Website has its own revocable key.

**Requirements:** R1

**Dependencies:** U1

**Files:** none in-repo (Railway env var change + secure key handover)

**Approach:** Generate `epai_gsw_<32hex>`; **append** to `EVERYPROPERTY_API_KEYS` on the Railway prod service (never overwrite). Hand the key to the website team via a secure channel (not chat/email plaintext if avoidable). This is a production env change — confirm with Stuart before applying.

**Test expectation: none — env provisioning; replacement verification is U1's auth scenarios re-run with the new key.**

**Verification:** A request with the new key returns 200; the old consumers' keys still work.

### U3. Document the consumer + deliverables

**Goal:** `INTEGRATIONS.md` records the new consumer; the website team receives base URL, key, and the licensing answer.

**Requirements:** R4, R5

**Dependencies:** U2

**Files:**
- `INTEGRATIONS.md` (modify — add GEA_Website/`epai_gsw_` to the consumer list and document the three endpoints + attribution requirements)

**Approach:** Follow the existing consumer-entry format. Include the KTD3 licensing answer verbatim so it's on record. Deliverable message to the website team: base URL, key (secure channel), the three endpoint contracts from U1, and the attribution/image guidance.

**Test expectation: none — documentation.**

**Verification:** `INTEGRATIONS.md` lists the new consumer; website team confirms receipt of all three deliverables.

## Scope Boundaries

### Deferred to Follow-Up Work
- Rate limiting on the data routes (usage is trivially low; add only if abuse appears).
- Fronting the API with everypropertyai.com instead of the Railway URL.
- A camelCase response-mapping layer (website consumes the existing snake_case shape, same as every other consumer).
- Formal legal opinion on portal image licensing if the website later wants portal photos displayed broadly.

## Definition of Done
- New `epai_gsw_` key live in prod `EVERYPROPERTY_API_KEYS`, verified working, existing consumers unaffected.
- Endpoint contract + coverage notes for the 20 suburbs delivered to the website team.
- Licensing answer (KTD3) delivered and recorded in `INTEGRATIONS.md`.
