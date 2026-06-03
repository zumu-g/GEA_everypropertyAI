# everypropertyAI — external integrations & deploy state

Authenticated HTTP API consumed server-to-server by sibling GEA apps
(GEA_HR_recruitAI, GEA_ST_proposals). This is the pick-up doc: what's built, what each
consumer needs, and the outstanding deploy config.

Public base URL (Railway): `https://geaeverypropertyai-production.up.railway.app`

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

## Consumer config (set on each sibling app's Railway service)

Both GEA_HR_recruitAI and GEA_ST_proposals:
```
EVERYPROPERTY_API_URL=https://geaeverypropertyai-production.up.railway.app
EVERYPROPERTY_API_TOKEN=<the epai_… key>     # sent as Authorization: Bearer
```
- recruitAI → `GET /api/agents/listings?name=<agent>`
- proposals → `GET /api/search?q=<partial>` for type-ahead, then `GET /api/proposal?address=<fullAddress>`

## everypropertyAI Railway service — required env vars

| Var | For | Status |
|---|---|---|
| `EVERYPROPERTY_API_KEYS` | API-key auth (the `epai_…` value; comma-sep for multiple consumers) | ✅ set |
| `NEXT_PUBLIC_SUPABASE_URL` = `https://xulylioakpkvfywskmpk.supabase.co` | DB reads (listings/sales/agents) | ⛔ **set this — current gap** |
| `SUPABASE_SERVICE_ROLE_KEY` | DB reads (server-only secret) | ⛔ **set this — current gap** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | middleware `/my-properties` auth | ⛔ set this |
| `MAPBOX_ACCESS_TOKEN` (or `GOOGLE_PLACES_API_KEY`) | `/api/search` quality (else local-parse fallback) | set if not present |
| `APIFY_API_TOKEN` + LLM key (OpenRouter/Anthropic) | `/api/proposal` uncached live crawl | set if not present |

> **Current blocker:** the Supabase env vars are not set on Railway, so `/api/agents/listings`,
> `/api/proposal`, and the data routes return empty (`count:0` / `agent:null`) even though the
> Supabase DB is fully populated. Copy the keys from this repo's `.env.local` (or Supabase →
> Project Settings → API) into the Railway service Variables. This is the #1 thing to do next.

## Data state (Supabase `xulylioakpkvfywskmpk`, all migrations 001–004 applied)
- `property_sales`: ~44.6k rows; `agency_name`/`agent_name` ~100%, `listing_url`/`image_url` ~100%.
- `property_listings`: ~1.3k rows; agent/agency + url/image ~98–100%.
- `property_rentals`: **empty** — needs a fresh Apify `rent` run (blocked on the Apify monthly
  spend cap). See `PICKUP_listings_rentals.md`.
- Suburb casing normalised; reversed-name aliases resolve (e.g. "Upper Beaconsfield").

## Outstanding (pick up here)
1. **Set the Supabase env vars on the everypropertyAI Railway service** → endpoints return real data.
2. (Optional) Set `MAPBOX_ACCESS_TOKEN` + `APIFY_API_TOKEN`/LLM key on Railway for full `/api/search`
   + `/api/proposal` quality.
3. **Rentals backfill** — raise the Apify monthly cap, then run the rent ingest
   (`PICKUP_listings_rentals.md`).
4. Re-test live once env is set:
   `curl "$BASE/api/agents/listings?name=Sam%20Noorbakhsh" -H "Authorization: Bearer <token>"`
   should return ~20 listings; `/api/proposal?address=…` and `/api/search?q=…` likewise.

> Secrets (the `epai_…` token, Supabase keys) are intentionally NOT stored in this repo — they live
> in `.env.local` (gitignored) and the Railway service Variables.
