# everypropertyAI — external integrations & deploy state

Authenticated HTTP API consumed server-to-server by sibling GEA apps
(GEA_HR_recruitAI, GEA_ST_proposals). This is the pick-up doc: what's built, what each
consumer needs, and the outstanding deploy config.

Public base URL (Railway): `https://geaeverypropertyai-production.up.railway.app`

> **Consumer status (2026-06-16):** Live consumers are GEA_ST_CMA (`epai_cma_`), GEA_ST_Proposals,
> GEA_CRM (`epai_crm_`), GEA_HR_recruitAI, and GEA_Reports_WeeklyCampaignVendor (`epai_wcv_`).
> **MAP_findAI has been merged into GEA_CRM** — its market-appraisal/nurture capability (the CLI
> `sold` / `comps` / `street` commands) is now owned by GEA_CRM and served by the existing `epai_crm_`
> key. MAP_findAI is no longer a separate consumer; it was never separately keyed, so there is nothing
> to revoke. (Its old integration prompt under `services/everypropertyai/` is marked SUPERSEDED.)

## Authenticated endpoints (all built + verified)

All require `Authorization: Bearer <token>` where `<token>` ∈ `EVERYPROPERTY_API_KEYS`
(comma-separated) or `EVERYPROPERTY_API_TOKEN`. These three auth **in-route** (fail-closed,
no same-origin exemption — server-to-server). Implemented per route + `src/middleware.ts`.

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /api/agents/listings?name=&agency=` (or `?agentId=`) | An agent's recent listings + sales (≤20, newest first) | Fast DB query. Unknown agent → 200 `{agent:null,listings:[]}`. `src/app/api/agents/listings/route.ts` |
| `GET /api/proposal?address=` (`&fast=1`) | Presentation-ready property data (estimate, attrs, agency/agent, hero photos) | Uncached = full crawl (~120s); cached instant. `src/app/api/proposal/route.ts` |
| `GET /api/search?q=` | Address autocomplete, VIC-biased, ≤8 flat suggestions | `q<3 → []`, missing `q` → 400; never crawls. `fullAddress` is normalised for passing to `/api/proposal`. `src/app/api/search/route.ts` |

Other data routes (`/api/sold-sales`, `/api/on-market-listings`, `/api/rental-listings`,
`/api/comparable-sales`, `/api/enrich`, `/api/property`, `/api/address-suggest`) are gated by the
**middleware** (same key, but with a same-origin exemption for the PropertyIQ website). See
`README.md` API section.

`/api/rental-listings` supports `minRent` / `maxRent` (weekly rent) and `sinceDays` (listed within
the last N days, by `listed_date`); `/api/on-market-listings` supports `sinceDays`. The CMA CLI
exposes these as `rentals --min-rent/--max-rent/--listed-within 1m|3m|6m|12m|2y` and
`listings --listed-within …`. `listed_date` is the scraped Domain listing date when available, else
the row's first-seen timestamp (migration `006_listed_date.sql`).

### `/api/property` contract (per-property profile)

`POST /api/property { address, fast? }` returns `{ profile, source, addressSlug }`.

- **`fast: false` (default) is a single synchronous call — no polling.** The pipeline
  (crawl → extract → merge → seed) runs to completion within the request (≤110s) and the
  response carries the final profile. Callers (the `proposal`/`property` CMA CLI) read it
  directly; there is no background job to poll.
- **Profiles are seeded from our own feeds.** When the live crawl yields nothing (Domain
  bot-block / unconfigured sources in prod), the profile is gap-filled from
  `property_sales` → `property_listings` → `property_rentals` (best/most-recent row for the
  `address_slug`) as a low-confidence `property-feed` source: property type, beds, baths,
  car spaces, land area, a price band (`priceLow/Mid/High`) and a hero photo. So any address
  present in our feeds returns populated attributes with `overallConfidence > 0`, independent
  of crawl health. A real crawl extraction always wins (the feed only fills gaps).
- An address absent from every feed **and** with a failed crawl returns an address-only
  profile (`source: 'queued'`, confidence 0) and is **not** cached, so it can be retried.
- **`fast: true`** is the only background/partial path: a trimmed crawl answers immediately
  while the full crawl fills the cache. Response shape, auth and CORS are unchanged.
- **Cache-bust:** `POST /api/property { address, refresh: true }` (or `?refresh=1`) skips the cache,
  evicts the stale record (in-memory + Supabase `property_cache`), and re-crawls — use it to correct a
  wrong cached profile. Manual fallback when operating Supabase directly:
  `DELETE FROM property_cache WHERE address_slug = '<slug>';` (e.g. `120-moondarra-drive-berwick-vic-3806`).

## Consumer config (set on each sibling app's Railway service)

Both GEA_HR_recruitAI and GEA_ST_proposals:
```
EVERYPROPERTY_API_URL=https://geaeverypropertyai-production.up.railway.app
EVERYPROPERTY_API_TOKEN=<the epai_… key>     # sent as Authorization: Bearer
```
- recruitAI → `GET /api/agents/listings?name=<agent>`
- proposals → `GET /api/search?q=<partial>` for type-ahead, then `GET /api/proposal?address=<fullAddress>`
- weeklycampaign_vendor (GEA_reports_weeklycampaign_vendor) → `GET /api/vendor-report?lat=<lat>&lng=<lng>` (or `?address=<addr>`) → 3 closest solds + 3 newest listings within 500m

### API keys (per-consumer, append-only)

Each consumer app gets its **own** key so it can be rotated or revoked independently of the others.
Convention: `epai_<consumer>_<random>` (e.g. `epai_cma_…` for GEA_ST_CMA, `epai_wcv_…` for the vendor
report, `epai_crm_…` for the GEA CRM). The random suffix is CSPRNG entropy (≈32 hex chars).

**The allowlist is `EVERYPROPERTY_API_KEYS`** — a comma-separated list on the everypropertyAI service.
The **middleware** (`src/middleware.ts`, gates `/api/address-suggest`, `/api/property`, sold/listing
feeds, …) checks **only `EVERYPROPERTY_API_KEYS`**; the in-route self-auth routes (`/api/search`,
`/api/proposal`, `/api/agents/listings`) check **`EVERYPROPERTY_API_KEYS ∪ EVERYPROPERTY_API_TOKEN`**.
So a consumer key must live in **`EVERYPROPERTY_API_KEYS`** to work on *every* endpoint — putting it
only in the server's `EVERYPROPERTY_API_TOKEN` would 401 on the middleware-gated routes.

**Invariant:** a consumer's `EVERYPROPERTY_API_TOKEN` (set on the consumer app) must exactly equal one
value in the server's `EVERYPROPERTY_API_KEYS`.

Manage keys **append-only** — never overwrite the whole list (that revokes everyone):

- **Provision** a consumer: generate `epai_<consumer>_<32hex>`; **append** it (comma-separated) to
  `EVERYPROPERTY_API_KEYS` in `.env.local` (local) and the `geaeverypropertyai-production` Railway
  service variables, then redeploy; set the same value as the consumer app's `EVERYPROPERTY_API_TOKEN`.
- **Rotate** a consumer: append the new key, switch the consumer's `EVERYPROPERTY_API_TOKEN` to it,
  then remove the old value from `EVERYPROPERTY_API_KEYS` and redeploy.
- **Revoke** a consumer: remove just that one value from `EVERYPROPERTY_API_KEYS` and redeploy — other
  consumers are unaffected.

Never commit a real key value — committed files (incl. this one and `.env.local.example`) use
placeholders only. Don't paste real `epai_…` values into logs or PRs.

### Troubleshooting: enrich gets `401 Unauthorized` from `/api/address-suggest`

`/api/address-suggest` is **middleware-gated** (unlike `/api/search` / `/api/proposal` /
`/api/agents/listings`, which self-authenticate in-route). A server-to-server consumer (e.g. the
CRM enrich action) **must** send `Authorization: Bearer <key>` where `<key>` is one of the server's
`EVERYPROPERTY_API_KEYS`. **Invariant:** the consumer's `EVERYPROPERTY_API_TOKEN` must be a value
present in the everypropertyAI service's `EVERYPROPERTY_API_KEYS`.

A `401 {"error":"Unauthorized — missing or invalid API key"}` has two causes — diagnose which with
this matrix (replace placeholders; never paste real `epai_…` values into shared logs):

```sh
BASE=https://geaeverypropertyai-production.up.railway.app

# 1. No auth header → expect 401 (confirms the gate is on)
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/address-suggest?q=120+Moondarra"

# 2. With the CONSUMER's token → 200 = token is fine (cause was unset/not-threaded env);
#                                401 = the token is wrong/stale (not in the allowlist)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <consumer-token>" \
  "$BASE/api/address-suggest?q=120+Moondarra"

# 3. With a KNOWN-GOOD server key → 200 confirms the server allowlist; the consumer value just
#                                   needs to match what this key is
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <server-key>" \
  "$BASE/api/address-suggest?q=120+Moondarra"
```

**Fix:** set `EVERYPROPERTY_API_TOKEN` in the consumer app (CRM) to a key listed in the server's
`EVERYPROPERTY_API_KEYS` — or add the consumer's key to that allowlist and redeploy the service. The
`services/everypropertyai` client now reports which cause it hit (no token attached vs token rejected)
instead of a bare `returned 401`.

## everypropertyAI Railway service — required env vars

| Var | For | Status |
|---|---|---|
| `EVERYPROPERTY_API_KEYS` | API-key auth (comma-sep allowlist; per-consumer keys `epai_cma_`, `epai_wcv_`, `epai_crm_`, …) | ✅ set |
| `NEXT_PUBLIC_SUPABASE_URL` = `https://xulylioakpkvfywskmpk.supabase.co` | DB reads (listings/sales/agents) | ✅ set |
| `SUPABASE_SERVICE_ROLE_KEY` | DB reads (server-only secret) | ✅ set |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware `/my-properties` auth | ✅ set |
| `MAPBOX_ACCESS_TOKEN` (or `GOOGLE_PLACES_API_KEY`) | `/api/search` quality (else local-parse fallback) | ✅ set |
| `APIFY_API_TOKEN` + LLM key (OpenRouter/Anthropic) | `/api/proposal` uncached live crawl | ✅ set |

> **Status (2026-06-10):** all required env vars are set on Railway; the data routes return real data
> (verified live — `/api/agents/listings`, `/api/search`, `/api/address-suggest` all 200 with a valid
> key). The earlier "Supabase not set" blocker is resolved.

## Data state (Supabase `xulylioakpkvfywskmpk`, all migrations 001–004 applied)
- `property_sales`: ~44.6k rows; `agency_name`/`agent_name` ~100%, `listing_url`/`image_url` ~100%.
- `property_listings`: ~1.3k rows; agent/agency + url/image ~98–100%.
- `property_rentals`: **empty** — needs a fresh Apify `rent` run (blocked on the Apify monthly
  spend cap). See `PICKUP_listings_rentals.md`.
- Suburb casing normalised; reversed-name aliases resolve (e.g. "Upper Beaconsfield").

## Outstanding (pick up here)
Prod env + data routes are live (see status note above). Remaining:
1. **CRM enrich smoke test** — GEA_crmAI now uses its dedicated `epai_crm_…` key (server-verified). After
   its redeploy, run "Enrich from everypropertyAI" on a real address and confirm it returns attributes
   (the 401 is resolved server-side; this confirms the CRM loads/sends the token at call time).
2. **Rentals backfill** — `property_rentals` is empty; raise the Apify monthly cap, then run the rent
   ingest (`PICKUP_listings_rentals.md`).
3. **Merge the AVM data-foundation branch** (`feat/avm-data-foundation-rebased`): plan 002 U1–U4
   (attribute persistence, floor-area capture, external `property_features` + enrichment, market-time
   price index) and plan 005 (school-zone enrichment). Not yet on `main`.
4. **Generate the school-zone reference data** (plan 005 U1) — needs GDAL/`ogr2ogr` +
   `scripts/prep-school-zones.md`; until then `school_zone_*` stay null (fail-soft).

> Secrets (the `epai_…` keys, Supabase keys) are intentionally NOT stored in this repo — they live
> in `.env.local` (gitignored) and the Railway service Variables.
