# Daily property-data sync — setup

> **CURRENT (2026-06-09): Bright Data Web Unlocker + GitHub Actions.**
> The Domain Apify batch actor is permanently blocked by Domain's anti-bot (every run
> SUCCEEDED with 0 items), so the daily sync now runs via **`.github/workflows/daily-domain-scrape.yml`**:
> a cron workflow (21:00 UTC ≈ 7am Melbourne) that runs `scripts/ingest-domain-webunlocker.mjs`
> for `sold` + `on-market`, fetching each Casey/Cardinia suburb's Domain page through Bright Data
> Web Unlocker (managed anti-bot, ~$1.50/1k requests ≈ $5/mo) and upserting directly to Supabase.
> The old Apify schedule `casey-cardinia-daily-7am` (`3nkBuED2E3SoLMbgZ`) is **DISABLED**.
> Required GitHub repo secrets: `BRIGHTDATA_WEB_UNLOCKER_TOKEN`, `BRIGHTDATA_WEB_UNLOCKER_ZONE`,
> `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Run manually: Actions tab → "Daily Domain
> scrape" → Run workflow. The Apify-actor approach below is retained for historical reference only.

> **ADDITIONAL FEED (2026-06-15): REA on-market via Apify.**
> `.github/workflows/daily-rea-apify-scrape.yml` runs `scripts/ingest-rea-apify.mjs on-market` at the
> same 21:00 UTC, scraping realestate.com.au on-market listings for Casey/Cardinia via the Apify actor
> `one-api/realestate-com-au-scraper` and upserting into `property_listings` (source=`rea-apify-one-api`)
> — a second, independent on-market source alongside Domain. Required GitHub repo secrets:
> `APIFY_API_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Optional repo variables:
> `REA_RESULT_COUNT` (default 25), `REA_PAGES` (default 1). Cost ≈ $0.003/result.
> **REA sold is NOT wired** — the actor's Sold channel returns no sold DATE (breaks `property_sales`
> dedup + comp recency); resolving that is a follow-up.

---

Cost-effective, daily-updating Supabase database for sold + on-market (+ weekly rentals),
driven by the **batch** Domain Apify actor (`0EXe0hsmDKWLI3JF9`, ~$1/1000 results) on an Apify
schedule, with a webhook into the app that dedups + links + expires.

## 1. Run the migrations (Supabase SQL editor) — ✅ APPLIED 2026-06-02

In order (both idempotent, `IF NOT EXISTS` — safe to re-run on a fresh instance):
1. `src/lib/db/migrations/001_listings_rentals.sql` — creates `property_listings`, `property_rentals`,
   adds lat/lng to `property_sales`.
2. `src/lib/db/migrations/002_listing_lifecycle.sql` — adds `address_slug`, `last_seen_at`, `active`
   to the listing/rental tables.

One-time suburb-casing backfill (also already run on this instance) — collapses mixed-case suburbs
(e.g. `BEACONSFIELD`) to a single title-cased key:
```sql
UPDATE property_sales SET suburb = initcap(lower(suburb))
WHERE suburb IS NOT NULL AND suburb <> initcap(lower(suburb));
```

## 2. Seed the address universe (one-time, ~quarterly)

Both sources are used: G-NAF as the base, plus any scraped address is auto-added on ingest.
- Download the free **G-NAF Core** CSV from data.gov.au (Geoscape G-NAF).
- `node scripts/import-gnaf.mjs /path/to/gnaf-core.csv`
  - It filters to the Casey/Cardinia postcode set in the script — widen `POSTCODES` there for more LGAs.
- Verify: `addresses` row count > 0.

## 3. Env

Set `INGEST_SECRET` (any random string) in the app env. `APIFY_API_TOKEN` and the Supabase keys are
already present. The webhook authenticates with `INGEST_SECRET` (falls back to `CRON_SECRET`).

## 4. Apify Console — scheduled tasks + webhooks

Create tasks for actor `0EXe0hsmDKWLI3JF9`, each with input:
```json
{ "startUrls": [ { "url": "https://www.domain.com.au/<path>/<suburb>-vic-<postcode>/" }, ... ],
  "maxItems": 1500 }
```
Keep `maxItems` low (recent pages are newest-first; ~25–50/suburb is plenty for a daily delta).

| Task | Path in URL | Schedule | category |
|------|-------------|----------|----------|
| Sold daily | `sold-listings` | daily | `sold` |
| On-market daily | `sale` | daily | `on-market` |
| Rent weekly | `rent` | weekly | `rent` |

(The 57 suburb slugs are listed in `scripts/ingest-domain-apify.mjs` → `SUBURB_SLUGS`.)

On each task add a **webhook**: event `ACTOR.RUN.SUCCEEDED` → POST to
```
https://<your-propertyiq-host>/api/ingest/domain?category=<sold|on-market|rent>&token=<INGEST_SECRET>
```
Apify includes `resource.defaultDatasetId` in the payload; the endpoint reads it, pages the dataset,
dedup-upserts into the right table, links/augments `addresses`, bumps `last_seen_at`, and marks
listings no longer seen as `active=false`.

## 5. What the endpoint does (POST /api/ingest/domain)

- Dedup via each table's UNIQUE key + merge-duplicates → **no duplicate rows** on re-runs. Rows are
  also de-duped **within** each batch by the on-conflict key before upsert (Postgres rejects an upsert
  that touches the same conflict target twice — applies to both the webhook `upsertRows()` and the
  `scripts/ingest-domain-apify.mjs` loader).
- Suburb names are title-cased on write (`titleCaseSuburb`) and reads resolve reversed-name aliases
  (`normaliseSuburbAlias`, e.g. "Upper Beaconsfield" → "Beaconsfield Upper") — both in
  `src/lib/utils/address.ts`.
- `sold` → `property_sales` (append-only). `on-market` → `property_listings`. `rent` → `property_rentals`.
- Links `address_slug`; adds unseen scraped addresses to `addresses`.
- Listings/rentals: `last_seen_at` bumped; rows in the scraped suburbs not seen this run → `active=false`.
- Read paths (`/api/on-market-listings`, `/api/rental-listings`, the CLI) return only `active=true`.

## 6. Manual / backfill

`scripts/ingest-domain-apify.mjs <sold|on-market|rent> <datasetId | --run>` still works for one-off
loads/backfills (e.g. the existing on-market dataset `V56AzVH6c9Bf2XNUN`). The webhook endpoint is the
steady-state path.

## Cost & cadence

- Batch actor only (not the per-property scraper). Low `maxItems`, daily sold+sale, weekly rent →
  roughly a few thousand results/day ≈ ~$3–5/day.
- The old `daily-listings` Firecrawl cron was removed (superseded). Backfill stays paused; per-property
  live crawl is on-demand only.
