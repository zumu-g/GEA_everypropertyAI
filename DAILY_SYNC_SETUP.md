# Daily property-data sync — setup

## Current state (2026-06-19)

**Feeds are live and monitored.** Three daily feeds upsert into Supabase:
- **Domain sold** → `property_sales` (Bright Data Web Unlocker)
- **Domain on-market** → `property_listings` (Bright Data Web Unlocker)
- **REA on-market** → `property_listings`, source `rea-apify-one-api` (Apify actor `one-api/realestate-com-au-scraper`)

**Scheduling — currently GitHub Actions, off-peak (Stage 1, live):**
- `.github/workflows/daily-domain-scrape.yml` — `cron: 23 21 * * *` (both categories via matrix)
- `.github/workflows/daily-rea-apify-scrape.yml` — `cron: 37 21 * * *`
- Verified firing 2026-06-18 and -19 (no silent drops). Caveat: GitHub fires them ~100 min late.

**Monitoring (live):**
- Every run pings a **Healthchecks.io** check (`HEALTHCHECK_UUID` per feed) — start / success(+row count) / fail. A missed run goes red and alerts. `feed_health` table (migration 007, applied) records `ran → items → status (ok|blocked|broken)` per category.
- Backstop `GET /api/cron/feed-freshness` returns 503 when a feed is stale (note: its `vercel.json` cron is **dead config** — the app runs on Railway, not Vercel; re-home or remove during the Stage 2 cutover).

**In progress — Stage 2 (Railway cron re-host)** to fix the ~100-min GitHub lateness:
- Config-as-code merged to `main` (`services/feeds-cron/Dockerfile` + `railway.feeds-*.json`). See runbook below.
- **Pending:** create the 3 Railway cron services in the existing project + verify (U6), then remove the GitHub `schedule:` triggers and dead `vercel.json` crons (U7).

Plan of record: `docs/plans/2026-06-17-001-fix-data-feed-reliability-resequenced-plan.md`.
Pickup instructions for resuming: `docs/PICKUP-data-feed-stage2.md`.

---

> **STAGE 2 RUNBOOK (2026-06-19): Railway cron re-host — config-as-code is in the repo.**
> Stage 1 is live: feeds run on GitHub Actions off-peak (Domain `23 21`, REA `37 21`) with
> Healthchecks.io heartbeats. Observed result: runs fire reliably but ~100 min LATE (GitHub
> best-effort). Stage 2 moves the schedule to Railway cron (~on-time) for tighter timing.
>
> Three config-as-code files define the cron services (build via `services/feeds-cron/Dockerfile`,
> a minimal Node-20 image that copies only `scripts/`):
>
> | Config file | startCommand | cronSchedule (UTC) | ≈ Melbourne |
> |---|---|---|---|
> | `railway.feeds-domain-sold.json` | `node scripts/ingest-domain-webunlocker.mjs sold` | `20 21 * * *` | ~7:20am AEST |
> | `railway.feeds-domain-onmarket.json` | `node scripts/ingest-domain-webunlocker.mjs on-market` | `23 21 * * *` | ~7:23am AEST |
> | `railway.feeds-rea-onmarket.json` | `node scripts/ingest-rea-apify.mjs on-market` | `26 21 * * *` | ~7:26am AEST |
>
> **Deploy steps (Railway dashboard):**
> 1. In the existing Railway project, **New Service → Deploy from GitHub repo** → `zumu-g/GEA_everypropertyAI`. Create one service per feed (3 total). Name them `feeds-domain-sold`, `feeds-domain-onmarket`, `feeds-rea-onmarket`.
> 2. On each service → **Settings → Config-as-code**: set the **Config file path** to the matching `railway.feeds-*.json` (the file's `cronSchedule` + `startCommand` then apply automatically — no need to set the cron in the UI). Leave **Root Directory** at the repo root so the Dockerfile build context can `COPY scripts`.
> 3. On each service → **Variables**, set:
>    - all: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HEALTHCHECK_UUID` (the check for THAT feed — sold/on-market/rea)
>    - Domain services: `BRIGHTDATA_WEB_UNLOCKER_TOKEN`, `BRIGHTDATA_WEB_UNLOCKER_ZONE`
>    - REA service: `APIFY_API_TOKEN` (optional: `REA_RESULT_COUNT`, `REA_PAGES`)
>    - Reuse the SAME Healthchecks UUIDs already in GitHub secrets so the heartbeat follows the job: sold→`9aaaaa50…`, on-market(domain)→`4bc93a71…`, rea→`f6a1207a…`.
> 4. **Verify (U6):** trigger each service once (Deployments → Run) and confirm Supabase rows upsert, `feed_health` updates, and the Healthchecks check greens. Then watch one real scheduled cycle fire near its minute.
> 5. **Cutover (U7):** ONLY after a Railway cycle is verified, remove the `schedule:` trigger from both `.github/workflows/daily-*.yml` (keep `workflow_dispatch`) and delete the dead `crons` array from `vercel.json`. Idempotent upserts make the brief double-run window harmless.
>
> `restartPolicyType: NEVER` — a cron deployment must not auto-restart on exit; a blocked run
> exits non-zero, pings Healthchecks `/fail`, and the heartbeat alerts rather than looping.

> **TARGET (2026-06-16): Re-host onto Railway cron + Healthchecks.io monitoring.**
> The two feeds previously ran on GitHub Actions scheduled workflows (`cron: '0 21 * * *'`).
> GitHub's scheduler is best-effort: top-of-hour runs were delayed 60–110 min and **silently
> dropped** under load (no run fired on 2026-06-16). The feeds are moving to **Railway cron
> services** (fire on time, co-located with Supabase) wrapped with a **Healthchecks.io
> dead-man's-switch** so a dropped or zero-yield run alerts instead of failing silently.
>
> **Railway cron services** (Settings → Cron Schedule on each service; one schedule per service).
> Point each at this repo, Node 20, no build step (scripts use only Node built-ins):
>
> | Service | Start command | Cron (UTC, odd minute) | ≈ Melbourne |
> |---------|---------------|------------------------|-------------|
> | feeds-domain-sold | `node scripts/ingest-domain-webunlocker.mjs sold` | `23 21 * * *` | ~7:23am AEST |
> | feeds-domain-onmarket | `node scripts/ingest-domain-webunlocker.mjs on-market` | `24 21 * * *` | ~7:24am AEST |
> | feeds-rea-onmarket | `node scripts/ingest-rea-apify.mjs on-market` | `26 21 * * *` | ~7:26am AEST |
>
> Railway cron requires the command to **exit** on completion — these scripts do. Each script
> exits non-zero and pings Healthchecks `/fail` when its feed is **blocked** (all pages
> challenge/empty) so the run is marked failed.
>
> **Env per Railway service:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus
> `BRIGHTDATA_WEB_UNLOCKER_TOKEN` + `BRIGHTDATA_WEB_UNLOCKER_ZONE` (Domain services) or
> `APIFY_API_TOKEN` (REA service), and a **per-service** `HEALTHCHECK_UUID` (the check for that
> feed). Optional: `HEALTHCHECK_BASE_URL` (self-hosted Healthchecks), `REA_RESULT_COUNT`,
> `REA_PAGES`.
>
> **Healthchecks.io:** create one check per service (period ~25h to absorb jitter, grace ~2h);
> wire its integrations (email/Slack) for the alert. Each run pings `/start`, then `/<uuid>`
> with a one-line summary on success, or `/<uuid>/fail` on blocked/error. The check's UUID is
> the `HEALTHCHECK_UUID` env for that service.
>
> **`feed_health` table:** each run now upserts `feed_health` (migration `007_feed_health.sql` —
> **verify it is applied** in the live DB before relying on it; the migration counter is at 008).
> `GET /api/cron/feed-freshness` runs on a Vercel cron (`vercel.json`, `17 22,2,9 * * *`) as a
> second backstop alert (503 when any feed is stale beyond its SLA).
>
> **Cutover order (important):** stand up + manually run the Railway services and confirm rows
> upsert + Healthchecks pings land, THEN remove the `schedule:` trigger from the two GitHub
> workflows (keep `workflow_dispatch` as a manual break-glass). Removing the GitHub schedule
> before Railway is verified would leave **no** scheduler. Idempotent upserts make a brief
> double-run window harmless.

---

> **PREVIOUS (2026-06-09): Bright Data Web Unlocker + GitHub Actions.**
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
