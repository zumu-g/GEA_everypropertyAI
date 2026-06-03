# Claude Code prompt — build Domain (Apify) ingestion into everypropertyAI

Paste everything in the box below into Claude Code, **run inside the everypropertyAI/propertyiq repo**.
It builds a first-class ingestion of Domain.com.au property data (both **sold** and **on-market**) into
everypropertyAI's database, so everypropertyAI becomes the single source of truth that the CMA tool can
fetch from. Companion data + exact dataset IDs are in `DATA_HANDOVER.md` (same folder).

---

You are adding a **Domain.com.au property-data ingestion** to THIS project (everypropertyAI / PropertyIQ),
so it owns both sold sales and on-market (for-sale) listings. Today this project only has sold sales
(`property_sales`) + subject-property profiles; it has no on-market listings. A sibling CMA tool will be
refactored to fetch all of its data from this project, so the data must live here with coordinates and be
queryable by suburb AND by lat/lng radius.

## Context (carry forward — do not re-derive)
- Data source = the **Apify Domain.com.au scraper**, actor `0EXe0hsmDKWLI3JF9`.
  - Run: `POST https://api.apify.com/v2/acts/0EXe0hsmDKWLI3JF9/runs?token=$APIFY_API_TOKEN`
  - Input: `{ "startUrls": [ ...one per suburb... ], "maxItems": 5000 }`
  - Start URLs per suburb slug `{suburb}-vic-{postcode}`:
    - Sold: `https://www.domain.com.au/sold-listings/{suburb}-vic-{postcode}/`
    - On-market: `https://www.domain.com.au/sale/{suburb}-vic-{postcode}/`
  - Poll `GET /v2/actor-runs/{runId}` until `status=SUCCEEDED`, then read items from
    `GET /v2/datasets/{defaultDatasetId}/items?clean=true&offset=&limit=` (paginate).
- `APIFY_API_TOKEN` is already in this repo's `.env.local`. Supabase creds are
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (also in `.env.local`).
- Suburb list (Casey/Cardinia/Bass Coast/West Gippsland) and the full field-mapping tables are in
  `DATA_HANDOVER.md` at the repo root — READ IT FIRST; treat it as the spec.
- A **proven sold loader already exists** at `scripts/ingest-domain-apify.mjs` (it maps the Domain item
  schema → `property_sales` and upserts to Supabase). Use it as the reference implementation and extend
  the approach to on-market — do not start from scratch.
- Existing read endpoint: `src/app/api/sold-sales/route.ts` (suburb-only today). Existing insert helper:
  `insertPropertySales()` + `PropertySaleRecord` in `src/lib/db/queries.ts`. Schema: `src/lib/db/schema.sql`.

## Domain Apify item schema (both categories)
```
location.display_address / suburb / state / postcode / latitude / longitude   // coords on every record
pricing.display_price     // SOLD: "$245,000"   ·   ON-MARKET: "$930,000 - $970,000" (range / marketing text)
listing.tags.tag_text     // SOLD: "Sold by private treaty 07 Oct 2020"  ·  ON-MARKET: "Under offer" (no date)
property.property_type / land_size / bedrooms / bathrooms / parking          // beds/baths often null on sale
record_type: "listing"
```

## Target state (done when ALL true)
1. `property_sales` has `latitude` + `longitude` columns, populated for Domain rows.
2. A new `property_listings` table holds on-market (for-sale) listings with coords + price range + status.
3. One ingestion entry point ingests BOTH categories from Apify (run-or-reuse-dataset) into those tables.
4. Read endpoints expose both, by **suburb AND lat/lng+radius**, returning typed JSON:
   - `GET /api/sold-sales` (extend existing) and `GET /api/on-market-listings` (new).
5. Schema changes are additive; existing sold/profile behaviour is unchanged.

## Steps (do in order; output "✅ <step>" after each)
1. READ `DATA_HANDOVER.md` and `scripts/ingest-domain-apify.mjs`. Confirm the actor, datasets, suburb
   list, and the two field-mapping tables. STOP AND ASK if anything conflicts with the live schema.
2. MIGRATIONS (additive only — write SQL, and since DDL can't go through PostgREST, output the exact SQL
   for the user to run in the Supabase SQL editor, then continue once confirmed):
   - `ALTER TABLE property_sales ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;`
   - `CREATE TABLE IF NOT EXISTS property_listings ( id uuid primary key default gen_random_uuid(),
     raw_address text not null, suburb text, state text not null default 'VIC', postcode text,
     display_price text, price_low numeric(14,2), price_high numeric(14,2), status text,
     land_area_sqm numeric(10,2), property_type text, latitude double precision, longitude double precision,
     source text not null, created_at timestamptz not null default now(),
     unique (raw_address, source) );` plus an index on `(suburb, state)`.
   - Mirror both in `src/lib/db/schema.sql` so the file stays the source of truth.
3. INGEST MODULE: generalise `scripts/ingest-domain-apify.mjs` (or add a sibling) so it can ingest BOTH
   categories. For each category, accept either a dataset ID (reuse) or trigger a fresh actor run over the
   suburb list, poll, then page items. Mappings per `DATA_HANDOVER.md`:
   - **Sold → `property_sales`**: `$`-price → number; sale date via regex
     `(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})` on `tag_text`; `land_size`→`land_area_sqm`; coords;
     `source='domain-apify'`; dedup `(raw_address, sale_date, sale_price, source)`; upsert
     **merge-duplicates** so re-runs backfill coords onto existing rows.
   - **On-market → `property_listings`**: parse `display_price` into `price_low`/`price_high` (two `$`
     amounts → low/high; single → low=high; none → null) and keep raw `display_price`; `status` from
     `tag_text`; coords; `source='domain-apify'`; dedup `(raw_address, source)`.
   - Skip rows with no `display_address`. Page size 1000; upsert sub-chunks of 500.
4. READ ENDPOINTS:
   - Extend `GET /api/sold-sales` to also accept `lat`,`lng`,`radius` (km). When present, filter by a
     bounding box in the query and refine with a haversine distance in code; keep the existing suburb path.
     Include `latitude`/`longitude` in each result (route + `SoldSaleResult` type).
   - Add `GET /api/on-market-listings` mirroring it (suburb AND lat/lng+radius), returning
     `rawAddress, suburb, postcode, displayPrice, priceLow, priceHigh, status, landAreaSqm, propertyType,
     latitude, longitude, source`. CORS headers like the sold route.
5. RUN IT: ingest the two existing datasets from `DATA_HANDOVER.md` (sold `HVziEJ6qGYiszKsTl`, on-market
   `V56AzVH6c9Bf2XNUN`). Report rows upserted per table.

## Hard constraints
- Only the changes above: 2 migrations + 1 ingest module + 2 read endpoints. No new heavy deps — use
  stdlib `fetch`; reuse the existing Supabase client / `insertPropertySales` patterns. STOP AND ASK
  before adding any dependency.
- Schema changes must be ADDITIVE (new columns/table). Do NOT alter or drop existing columns, and do NOT
  change existing sold/profile behaviour.
- Never hardcode secrets — read `APIFY_API_TOKEN` / Supabase creds from env.
- STOP AND ASK before anything destructive (dropping/renaming, deleting rows, bulk overwrites).

## Verify before declaring done
- `property_sales` rows have non-null `latitude/longitude` for `source='domain-apify'`; `property_listings`
  is populated (~1,391 rows from the on-market dataset).
- `GET /api/sold-sales?suburb=Pakenham&state=VIC` and `GET /api/sold-sales?lat=-38.06&lng=145.48&radius=2`
  both return rows **with coordinates**.
- `GET /api/on-market-listings?suburb=Cranbourne` and the `lat/lng/radius` variant return rows with
  `priceLow/priceHigh` parsed and coordinates present.
- Existing sold-by-suburb + subject-profile behaviour still works (no regression).
- Final summary: tables/columns added, endpoints added, rows ingested per table, and any STOP-AND-ASK
  items still open.
