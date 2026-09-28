# Migration 015 — listing lifecycle, price history, feed runs, suburb stats

Operator note for applying `src/lib/db/migrations/015_listing_lifecycle_price_history_stats.sql` and turning on the lifecycle/stats work (plan units U1–U11). Australian English; dates are Melbourne.

## 1. Apply order

1. Paste 015 into the Supabase SQL editor and run it. Run it a **second time**: it must complete with no errors (every CREATE / ADD COLUMN is `IF NOT EXISTS`, policies use the `duplicate_object` guard). A second run that fails is a stop condition.
2. `node scripts/verify-rls.mjs` — expect **9 locked tables** (the six from migration 011 plus `listing_price_history`, `feed_runs`, `suburb_stats_history`).
3. Set the env in section 6, then redeploy Railway so the app picks up the new columns.
4. One-off retirement (section 2), then let the feeds run.

## 2. One-off retirement of unswept sources

`domain-apify` (dormant webhook path) and `gea-legacy-db` are never crawled again, so their rows would stay `active=true` forever and inflate every "on the market now" count. About **26% of `property_listings` rows** sit on these two sources.

```
node scripts/retire-unswept-sources.mjs          # dry run: prints the count
node scripts/retire-unswept-sources.mjs --apply  # sets active=false, removed_at=now, lifecycle_status='withdrawn'
```

It writes one `feed_runs` row (`mode='retire'`). Idempotent: a re-run finds nothing active. Rows are not deleted; sold-sales history, comps and price estimates are untouched.

## 3. Expected row-count effects over the first two sweeps per source

Each crawl now sweeps its own source: rows not seen get `miss_count=1`; rows missed twice get `active=false`, `removed_at`, and `lifecycle_status='withdrawn'` (or keep `sold`). Expect a large drop in active counts after the second full sweep and a plateau after that.

| Source | Sweep cadence | Second full sweep |
| --- | --- | --- |
| Domain (Web Unlocker) | daily | day 2 |
| Homely | daily | day 2 |
| REA (`rea-apify-one-api`) | full mode Monday only (`REA_MODE=full`); Tue–Fri new-only, no sweep | a fortnight |

Do not trust `suburb_stats` counts until both sweeps have completed for every source — a fortnight from go-live. Closures inside the 14 days after go-live are treated as crawl noise, not withdrawals (`SWEEP_EXCLUSION_DAYS`).

## 4. Reading `feed_runs`

One row per crawl run: `category` (on-market / sold / rental / lifecycle-reconcile / listed-date-backfill), `source`, `mode`, `run_start`, `run_end`, `status`, counts `seen`, `new_rows`, `priced`, `fetched`, `failed`, `miss1`, `closed`, `skipped_suburbs`, `est_cost_usd`, and a `notes` JSON blob.

- `miss1` — rows newly marked as missed once this run. `closed` — rows closed (second miss) this run.
- `skipped_suburbs` — suburbs the **coverage guard** excluded from the sweep: pagination was truncated, or the crawl saw fewer than 50% of that suburb's active rows. Skipped suburbs are not swept (nothing is closed there). If most suburbs are skipped on two consecutive runs, the crawl is not seeing the market — stop and investigate before trusting any stats.

## 5. `suburb_stats_history` flags and the 60-day settle

- `provisional=true` — period is open, or closed less than 60 days; recomputed on every call and upserted. `provisional=false` — frozen; served from the table and never recomputed.
- `reconstructed=true` — period ends inside go-live + 14 days, so it was built from pre-lifecycle data; treat with caution.
- The nightly freeze (`.github/workflows/nightly-suburb-stats.yml` → `GET /api/cron/suburb-stats`, 15:41 UTC) freezes periods whose settle date passed in the last two days for every service-area suburb (both week and month). `sentimentIndex` stays null for about six months while frozen history accrues.

## 6. Environment

| Where | Variable | Value |
| --- | --- | --- |
| Railway + GitHub | `STATS_LIFECYCLE_GO_LIVE` | the real go-live date (`YYYY-MM-DD`); code default is 2026-10-01 |
| GitHub | `REA_MODE` | already in place (workflow sets `full` on the Monday run) |
| GitHub (optional) | `HEALTHCHECK_LIFECYCLE_RECONCILE_UUID` | Healthchecks ping for the nightly reconcile; the script no-ops when unset |
| Local / GitHub (optional) | `BACKFILL_MAX_ITEMS` | cap for the REA listed-date backfill (default 1,500) |
| Railway + GitHub | `CRON_SECRET`, `EVERYPROPERTY_BASE_URL` | already set; the new workflow reuses them |

## 7. REA listed-date probe (paid)

`node scripts/backfill-listed-dates.mjs --dry-run` then without the flag. Phase 1 probes 20 rows (US$0.06); if no date field comes back it records `status='probe-negative'` and stops. Phase 2 continues to `BACKFILL_MAX_ITEMS` (1,500 items ≈ **US$4.50**, capped). On 28 Sep 2026 there were **2,272 candidates**; one capped run leaves **772** for a second run. Run it only after two full REA sweeps so the selection is the live market.

## 8. Railway cron duplicates

Railway still carries cron entries for routes that GitHub Actions now schedule. Confirm each one is either the single scheduler for its route or delete it; two schedulers on one route double the paid fetches.

## 9. Known data gap

`property_sales` holds **no `vic-vg` rows** yet, so settlement-date coverage is 0% and the nightly reconcile (`scripts/reconcile-lifecycle.mjs`) can only match against Domain/REA sold feeds until the Valuer-General feed produces rows.

## 10. Rollback

All columns are additive and can stay. To roll back fully: `DROP TABLE listing_price_history; DROP TABLE feed_runs; DROP TABLE suburb_stats_history;` and delete the nightly-suburb-stats workflow. `feed_health` is untouched, so freshness and digest jobs keep working.
