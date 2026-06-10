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

## Consumer config (set on each sibling app's Railway service)

Both GEA_HR_recruitAI and GEA_ST_proposals:
```
EVERYPROPERTY_API_URL=https://geaeverypropertyai-production.up.railway.app
EVERYPROPERTY_API_TOKEN=<the epai_… key>     # sent as Authorization: Bearer
```
- recruitAI → `GET /api/agents/listings?name=<agent>`
- proposals → `GET /api/search?q=<partial>` for type-ahead, then `GET /api/proposal?address=<fullAddress>`
- weeklycampaign_vendor (GEA_reports_weeklycampaign_vendor) → `GET /api/vendor-report?lat=<lat>&lng=<lng>` (or `?address=<addr>`) → 3 closest solds + 3 newest listings within 500m

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

### `property_features` (external AVM signals, migrations 008–009)

Slow-changing location features keyed by `address_slug`, for the AVM training matrix.
Populated by the on-demand batch enricher `GET /api/cron/enrich-features`
(`?token=<INGEST_SECRET>`, idempotent, 90-day freshness skip):
- **planning** zone code/name + LGA + overlays — `spatial.planning.vic.gov.au` ArcGIS.
- **nearest train station** + distance — Nominatim.
- **school zones** (`school_zone_primary` / `school_zone_secondary`) — local point-in-polygon
  over bundled Victorian DET catchment data. The reference GeoJSON is generated by
  `scripts/prep-school-zones.md` (needs GDAL + the data.vic.gov.au "Victorian Government
  School Zones" dataset; refresh yearly). **Until generated, the zone columns stay null**
  (fail-soft) — the enricher still populates planning + station. (Source is DET school
  *zones*, not ACARA "My School", which is performance data with no catchment geometry.)

Deferred `property_features` columns (nullable placeholders, not yet populated): `seifa_irsad_decile`,
`parcel_land_area_sqm`.

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
