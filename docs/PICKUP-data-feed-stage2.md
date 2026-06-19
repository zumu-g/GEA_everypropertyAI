# Pickup prompt — Data-feed reliability, Stage 2 (Railway cron re-host)

Paste the section below to resume. Context is in `DAILY_SYNC_SETUP.md` (current-state
summary at top) and the plan `docs/plans/2026-06-17-001-fix-data-feed-reliability-resequenced-plan.md`.

---

## Resume prompt

We're finishing **Stage 2** of the data-feed reliability work: re-hosting the daily scrapes
from GitHub Actions cron onto **Railway cron** for tighter timing. Stage 1 (off-peak GitHub
cron + Healthchecks.io dead-man's-switch + `feed_health`) is live and working — feeds fire
daily but ~100 min late, which Stage 2 fixes.

**Already done (on `main`):**
- Migration 007 (`feed_health`) applied; instrumentation verified end-to-end.
- GitHub cron moved off-peak (Domain `23 21`, REA `37 21` UTC); `HEALTHCHECK_UUID` wired (PR #13).
- 3 Healthchecks.io checks created + GitHub secrets set (`HEALTHCHECK_DOMAIN_SOLD_UUID`,
  `HEALTHCHECK_DOMAIN_ONMARKET_UUID`, `HEALTHCHECK_REA_UUID`).
- Stage 2 scaffolding merged (PR #14): `services/feeds-cron/Dockerfile` (minimal node:20-slim,
  copies only `scripts/`) + `railway.feeds-{domain-sold,domain-onmarket,rea-onmarket}.json`
  (cron 20/23/26 21 UTC, `restartPolicyType: NEVER`) + runbook in `DAILY_SYNC_SETUP.md`.

**What's left:**

1. **U5 deploy + U6 verify (Railway dashboard — user).** In the EXISTING `GEA_everypropertyAI`
   Railway project (production env, alongside the one API service that has public + private
   networking), create 3 services from the GitHub repo: `feeds-domain-sold`,
   `feeds-domain-onmarket`, `feeds-rea-onmarket`. For each:
   - Settings → Config-as-code → point at its `railway.feeds-*.json` (becomes a **cron service**;
     NO domain/port/healthcheck needed).
   - Variables → reuse shared `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
     `BRIGHTDATA_WEB_UNLOCKER_TOKEN/ZONE` (Domain) / `APIFY_API_TOKEN` (REA), plus the
     per-service `HEALTHCHECK_UUID`: sold→`9aaaaa50-b470-4567-85c2-87392fdaacf5`,
     domain on-market→`4bc93a71-9301-47ad-95ac-33f5b2fe5b83`, rea→`f6a1207a-2736-4127-bda0-adb958e8c3ce`.
   - Run each once (Deployments → Run) → confirm Supabase rows upsert, `feed_health` updates,
     Healthchecks check greens. Then watch one real scheduled cycle fire near its minute.

2. **U7 cutover (me, after U6 confirmed).** Open a PR that:
   - removes the `schedule:` trigger from `.github/workflows/daily-domain-scrape.yml` and
     `daily-rea-apify-scrape.yml` (keep `workflow_dispatch` as break-glass);
   - deletes the dead `crons` array from `vercel.json` (or re-homes `feed-freshness` to a host
     that can run it — Railway cron or a Supabase pg_cron HTTP ping).

**Verification commands (read-only, run from `propertyiq/`):**
```bash
# Did the scheduled runs fire this morning?
gh run list --event schedule --created '>YYYY-MM-DDT12:00' --limit 10
# Data freshness + per-feed health (sources env from .env.local):
set -a && . ./.env.local && set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/feed_health?select=category,source_used,items,status,last_run_at&order=category" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

**Known follow-ups (not blocking):**
- `feed_health.category` is the PK but `on-market` is fed by BOTH Domain and REA — they
  overwrite each other's health row. Consider keying by `(category, source)`.
- GitHub workflows use deprecated `actions/checkout@v4` + `setup-node@v4` (Node 20) — bump to `@v5`.
- After cutover, capture the redesign via `/ce-compound` into `docs/solutions/`.
