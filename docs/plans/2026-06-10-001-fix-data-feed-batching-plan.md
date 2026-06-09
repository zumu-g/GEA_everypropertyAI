---
title: "fix: Batch the daily Domain data feed via matrix sharding + incremental upsert"
status: active
date: 2026-06-10
type: fix
---

# fix: Batch the daily Domain data feed via matrix sharding + incremental upsert

## Summary

The daily Domain scrape (`daily-domain-scrape.yml` → `scripts/ingest-domain-webunlocker.mjs`) sweeps 29 Casey/Cardinia suburbs across two categories (sold + on-market) = 58 Web Unlocker fetches at ~1.3 min each ≈ 75 min of work, against a 30-minute job timeout. It cannot finish. Worse, the script collects every row in memory and upserts **once at the very end**, so when the job is killed at the timeout, **all scraped data is discarded** — the manual run on 2026-06-09 reached 23/29 sold suburbs and wrote zero rows.

This plan makes the feed finish reliably and never lose partial progress, by two changes that compose:

1. **Matrix sharding** — split the 29 suburbs into ~4 parallel GitHub Actions jobs (~7–8 suburbs each, sold + on-market per shard). Wall-clock drops to ~15–20 min and a failing shard no longer takes the whole run down.
2. **Incremental upsert** — move the Supabase upsert *inside* the per-suburb loop so every suburb's rows persist as soon as they're parsed, independent of whether later suburbs or the job as a whole complete.

No change to the Web Unlocker client, the `__NEXT_DATA__` parser, the row mapper, or the Supabase schema — those work today.

---

## Problem Frame

**Observed:** The scheduled run silently skips (GitHub's known first-occurrence-of-new-cron behaviour), and the manual verification run was `cancelled` at `timeout-minutes: 30` — "Scrape sold" killed at suburb 23/29, "Scrape on-market" skipped entirely, zero rows upserted.

**Two root causes:**
- **Timeout vs workload mismatch.** One sequential job runs 58 fetches (~75 min) under a 30-min cap. The cap can't simply be raised to "fix" it without addressing fragility — a single slow shard or Web Unlocker retry storm still risks the whole run.
- **All-or-nothing persistence.** `scripts/ingest-domain-webunlocker.mjs` `main()` accumulates `rows` across the full suburb loop and calls `upsert()` exactly once after the loop (around line 197). Any interruption before that line = total data loss for the run.

**Why now:** The feed is the sole fresh-data path into Supabase for CMA/comparables/vendor-report consumers since the proxy-less Apify schedule was retired (Domain blocking). A feed that never lands data is a silent outage.

---

## Requirements

- **R1** — A scheduled run completes within its job timeout under normal Web Unlocker latency, for both sold and on-market categories across all 29 suburbs.
- **R2** — Scraped rows persist per-suburb; an interrupted or failed run retains every suburb successfully fetched before the interruption.
- **R3** — A single suburb or shard failure does not prevent other suburbs/shards from landing their data.
- **R4** — No change to API logic, response shape, parsing, mapping, the Web Unlocker client, or the Supabase schema/upsert-conflict keys.
- **R5** — The suburb-to-shard assignment covers all 29 suburbs exactly once (no suburb dropped, none double-fetched within a category).
- **R6** — Manual `workflow_dispatch` continues to work and exercises the same sharded path.

---

## Key Technical Decisions

- **Matrix sharding over sequential-chunks-with-bigger-timeout.** The runner already accepts a `SLUGS=a,b,c` env override to scope its suburb set (script line ~176) — sharding was anticipated in the original design. A `strategy.matrix` over shard indices reuses that override directly: each job runs `SLUGS=<shard slice>` for both categories. Parallelism cuts wall-clock to the slowest single shard (~15–20 min) and isolates failures (R1, R3). Sequential-chunks was considered (simpler yaml) but keeps a single long job and a single failure domain — rejected. See Alternatives.

- **Shard by static slicing of `SUBURB_SLUGS`, computed in the workflow, not the script.** Keep the script's contract unchanged: it already takes `SLUGS`. The workflow owns "which suburbs are in shard N" so sharding is a CI concern, not a code concern (R4). Default to **4 shards** (29 / 4 ≈ 7–8 suburbs → ~18–21 fetches per shard per the 2-category pass ≈ well under a 30-min cap with headroom). Shard count is a single matrix-list edit if Web Unlocker latency shifts.

- **Incremental upsert per-suburb, reusing the existing `upsert()` chunking.** Move the existing `upsert(cfg.table, cfg.conflict, rows)` call inside the per-suburb loop, upserting that suburb's mapped rows immediately, instead of accumulating into one array (R2). The existing `on_conflict` dedup key makes per-suburb upserts idempotent and safe to re-run, so shard retries and the cron's eventual same-day overlap can't create duplicates.

- **Keep both categories within each shard job** (sold then on-market), rather than making category a second matrix axis. Categories share the suburb slice and the cost is dominated by fetch latency; folding them into one job per shard halves total job count and keeps the matrix legible. A `sold`/`on-market` matrix axis was considered but adds job-scheduling overhead for no wall-clock gain since shards already run in parallel.

- **Per-suburb failure stays non-fatal.** The script already catches per-suburb fetch errors and pushes to `zeroYield` instead of throwing. Preserve that; incremental upsert must likewise not abort the loop on a single suburb's upsert error — log and continue (R3).

---

## High-Level Technical Design

Current (broken) vs target shape:

```
BEFORE (one job, end-of-run upsert):
  job ──► sold:  s1 s2 ... s29  ─┐
                                 ├─► [accumulate rows] ─► upsert ONCE ─► (never reached, killed at 30m)
          on-market: (skipped) ─┘

AFTER (4 parallel shards, per-suburb upsert):
  shard0 ─► sold s1..s8  (upsert each) ─► on-market s1..s8  (upsert each)
  shard1 ─► sold s9..s15 (upsert each) ─► on-market s9..s15 (upsert each)
  shard2 ─► sold s16..s22(upsert each) ─► on-market s16..s22(upsert each)
  shard3 ─► sold s23..s29(upsert each) ─► on-market s23..s29(upsert each)
        (all run concurrently; wall-clock ≈ slowest shard ≈ 15–20 min)
```

*Shard slices above are illustrative; exact assignment is finalized in U1.*

Per-suburb loop shape (directional, not implementation spec):

```
for slug in shard_slugs:
    html   = fetchPage(url(slug))        # unchanged
    rows   = map+filter(extract(html))   # unchanged
    upsert(table, conflict, rows)        # MOVED here from after the loop
    log per-suburb count
# no trailing batch upsert
```

---

## Implementation Units

### U1. Shard the suburb set across a workflow matrix

**Goal:** Run the feed as ~4 parallel jobs, each scraping a disjoint slice of the 29 suburbs for both categories, each comfortably under the job timeout.

**Requirements:** R1, R3, R5, R6

**Dependencies:** none

**Files:**
- `.github/workflows/daily-domain-scrape.yml` (modify)

**Approach:**
- Add `strategy.matrix` with a `shard` axis. Two viable encodings — decide at implementation:
  - **(a) Index + script-side slicing:** matrix `shard: [0,1,2,3]` and a `SHARD_COUNT` env; the runner derives its slice from `SUBURB_SLUGS` by index. Cleaner yaml but pushes shard math into the script (mild tension with "sharding is a CI concern").
  - **(b) Explicit slug lists in the matrix (recommended):** each matrix entry carries an explicit `slugs:` string; the job passes it through as `SLUGS=`. Keeps the script untouched (honours R4), makes the suburb→shard mapping reviewable in one place, and trivially supports rebalancing.
- Run both categories in the job's steps using the shard's `SLUGS` (sold step, then on-market step).
- Set per-job `timeout-minutes` to a value sized for one shard (~25–30 min keeps generous headroom for ~7–8 suburbs × 2 categories with retries).
- Keep `concurrency.group` but confirm matrix jobs aren't serialized by it (the group applies to the workflow run, not individual matrix legs — verify the group key doesn't collapse shards). If it does, scope the concurrency group to include the shard.
- Preserve `workflow_dispatch` and the `schedule` trigger unchanged (R6).
- Confirm all 29 slugs appear exactly once across shards (R5).

**Patterns to follow:** existing `env:` secret wiring and step structure in the current `daily-domain-scrape.yml`; the script's existing `SLUGS` override contract (`scripts/ingest-domain-webunlocker.mjs` ~line 176).

**Test scenarios:**
- Manual `workflow_dispatch` launches N shard jobs in parallel; each logs only its assigned suburbs; union of all shards' logged suburbs == the full 29-slug set, no duplicates within a category (Covers R5).
- A shard whose suburbs all succeed completes well under its `timeout-minutes` (Covers R1).
- Forcing one shard to fail (e.g. bad slug) leaves the other shards green and their data landed (Covers R3).
- `Test expectation:` workflow yaml has no unit-test harness — verification is via an actual dispatched run and the Actions UI, plus a yaml lint/parse check.

**Verification:** A dispatched run shows ~4 parallel green jobs; the Actions log across shards lists all 29 suburbs once per category; total wall-clock is materially below the old single-job runtime.

---

### U2. Upsert each suburb's rows incrementally inside the scrape loop

**Goal:** Persist rows per-suburb so an interrupted shard retains every suburb fetched before the interruption, and a single suburb's upsert error doesn't abort the shard.

**Requirements:** R2, R3, R4

**Dependencies:** none (independent of U1; together they satisfy the full reliability goal)

**Files:**
- `scripts/ingest-domain-webunlocker.mjs` (modify `main()` and the per-suburb loop)

**Approach:**
- Move the single post-loop `upsert(cfg.table, cfg.conflict, rows)` to fire per-suburb on that suburb's mapped rows, immediately after `inArea` filtering.
- Wrap the per-suburb upsert so an upsert failure logs and continues to the next suburb rather than throwing (mirror the existing per-suburb fetch `try/catch` that feeds `zeroYield`).
- Maintain a running total of upserted rows for the final summary log (keep the existing end-of-run summary line, now reporting the accumulated count + `zeroYield`).
- Do not change the `upsert()` function itself, its chunking, or the `on_conflict` conflict key — idempotency under per-suburb and cross-shard/cron overlap depends on the existing dedup key (R4).
- Confirm behaviour when a suburb yields zero in-area rows: skip the upsert call (no empty POST) and record in `zeroYield` as today.

**Patterns to follow:** the existing per-suburb `try/catch` and `zeroYield` accumulation in `main()`; the existing `upsert()` chunked POST with `on_conflict` (`scripts/ingest-domain-webunlocker.mjs` ~lines 151–198).

**Test scenarios:**
- **Happy path:** running a small `SLUGS=` subset upserts each suburb's rows as the loop advances; the row count in Supabase increases per-suburb, not only at the end (Covers R2).
- **Interruption:** killing the process partway (e.g. SIGTERM after suburb 3 of 6) leaves suburbs 1–3's rows persisted in Supabase (Covers R2).
- **Per-suburb upsert error:** simulating an upsert failure for one suburb (e.g. transient non-2xx) logs the error and the loop still processes and persists subsequent suburbs (Covers R3).
- **Idempotency:** running the same `SLUGS=` subset twice produces no duplicate rows (relies on `on_conflict`) (Covers R4).
- **Zero-yield suburb:** a suburb with no in-area listings performs no upsert POST and is recorded in `zeroYield`.

**Verification:** A subset run shows per-suburb "Upserted N rows" progression in logs; a deliberately interrupted run leaves the already-processed suburbs' rows queryable in Supabase; re-running the subset does not grow row counts.

---

## Scope Boundaries

**In scope:** matrix sharding of the workflow (U1); per-suburb incremental upsert in the runner (U2); per-job timeout sizing.

**Out of scope (true non-goals):**
- Web Unlocker client, `__NEXT_DATA__` parser, row mapper, Supabase schema, and `on_conflict` keys — unchanged.
- API logic and response shape — untouched.

### Deferred to Follow-Up Work
- **Cron first-run skip:** GitHub skipping the first occurrence of a newly merged cron is self-correcting from the next day; no fix needed unless it recurs. A `workflow_dispatch` after each schedule change is the manual mitigation.
- **Feed-freshness alerting:** a check that fails loudly if no rows landed in the last ~24h would have surfaced this outage automatically. There's already a `feeds/freshness.ts` + `/api/cron/feed-freshness` surface from the resilient-feeds work — wiring an alert to it is a separate task.
- **Node 20 → 24 deprecation:** the run warned that `actions/checkout@v4`/`setup-node@v4` on Node 20 are deprecated (forced to Node 24 from 2026-06-16). Bump action versions in a separate maintenance PR.

---

## Risks & Dependencies

- **Web Unlocker latency variance.** Shard timeout sizing assumes ~1.3 min/suburb. If latency spikes, a shard could still approach its cap — but incremental upsert (U2) means even a capped shard lands everything it fetched, so the failure is now partial, not total. Mitigation: start at 4 shards; reduce suburbs-per-shard if a shard trends near its timeout.
- **Cross-shard / cron overlap writes.** Parallel shards and a later same-day scheduled run both upsert; safety rests entirely on the existing `on_conflict` dedup key. If that key were ever wrong, per-suburb upserts would amplify duplicates. Verify idempotency explicitly (U2 test).
- **Concurrency group serialization.** If `concurrency.group: daily-domain-scrape` collapses matrix legs into a queue, parallelism is lost. Verify during U1; scope the group per-shard if needed.
- **Web Unlocker cost.** Sharding doesn't change total fetch count (still 58), so per-run Web Unlocker spend is unchanged; only wall-clock and reliability improve.

---

## Sources & Research

Grounded in this session's investigation — no external research required (strong local patterns):
- Run `27239449704` conclusion `cancelled` at `timeout-minutes: 30`; "Scrape sold" killed at suburb 23/29, "Scrape on-market" skipped.
- `scripts/ingest-domain-webunlocker.mjs`: `main()` end-of-loop single `upsert()` (~line 197); existing `SLUGS=` override (~line 176); per-suburb `try/catch`/`zeroYield`; chunked `upsert()` with `on_conflict` (~lines 151–161).
- `.github/workflows/daily-domain-scrape.yml`: single job, two sequential category steps, `timeout-minutes: 30`, `cron: '0 21 * * *'`.
