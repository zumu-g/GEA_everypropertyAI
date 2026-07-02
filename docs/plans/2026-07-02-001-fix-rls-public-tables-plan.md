---
title: "fix: Enable RLS on public Supabase tables (addresses + public-read hardening)"
type: fix
status: active
date: 2026-07-02
---

# fix: Enable RLS on public Supabase tables

## Summary

Supabase's security advisor flagged `rls_disabled_in_public` — a table in the
everypropertyAI project (`xulylioakpkvfywskmpk`) with Row-Level Security disabled, meaning
anyone holding the project's anon key can read, insert, update, and delete every row. Live
probing identified the table as **`addresses`** and confirmed the exposure is full
read/write (anon INSERT passes the RLS gate; only a NOT-NULL constraint stops it). A
secondary finding — not flagged by the advisor but surfaced during investigation — is that
`crawl_queue`, `property_sales`, and `property_cache` have RLS enabled but carry a
**public-read** policy, exposing the internal job queue, all sold-sales data, and raw
scraped payloads to the anon key.

This plan closes the critical `addresses` gap and hardens the public-read tables to
service-role-only, since every data read in the app goes through the service-role server
client (the anon/browser client is used solely for auth sessions).

**Scope note (user-confirmed):** everypropertyAI only. The sibling `GEA_crmAI` project
(`anynmamtmklygngcxzus`) was also flagged by the advisor but is a separate codebase/creds
and is deferred to its own effort (see Scope Boundaries).

---

## Problem Frame

The anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is, by design, shipped to the browser. RLS
is the only thing standing between that key and the data. Evidence gathered 2026-07-02 via
non-destructive probes against production:

- **`addresses` — RLS OFF (critical).** Anon `INSERT` returns `400 / 23502` (NOT-NULL
  violation) rather than `401 / 42501` (RLS denial) — proving the RLS check *passed* and
  only column validation blocked the write. Anon `SELECT` returns `200`. The table is
  currently empty (0 rows), so present data exposure is nil, but it is writable/deletable
  by anyone and is populated by the G-NAF address ingest (`insertAddresses`), so it will
  hold data. Root cause: `addresses` was created outside the tracked migration set
  (`src/lib/db/migrations/`), so it never received the `ENABLE ROW LEVEL SECURITY` block
  that migrations `001` and `007` apply to their tables.
- **`crawl_queue`, `property_sales`, `property_cache` — RLS ON, public-read (secondary).**
  Anon `SELECT` returns real rows; anon writes are correctly denied (`42501`). Exposes
  internal/operational data to any anon-key holder.
- **Confirmed correctly locked:** `agencies`, `suburb_crawl_progress`, `user_properties`,
  `property_overrides`, `properties`, `feed_health`, `crawl_jobs`, `sale_history`,
  `allowed_users` all deny anon writes with `42501`. `property_listings` /
  `property_rentals` are intentionally public-read (agent-facing listing data) but see the
  KTD on whether that intent still holds.

**Why it's safe to lock reads:** `getSupabaseServerClient()` (service role, bypasses RLS)
backs every query in `src/lib/db/queries.ts`. `getSupabaseBrowserClient()` (anon) is used
only for auth session handling (`createBrowserClient`, see `src/lib/db/supabase.ts:36`). No
`"use client"` component queries any data table directly. The public agents/listings
endpoint reads server-side via an API route + service role, not the anon key.

---

## Requirements

- **R1.** `addresses` has RLS enabled with a service-role-only access policy; anon can no
  longer read or write it.
- **R2.** `crawl_queue`, `property_sales`, `property_cache` no longer expose rows to the
  anon key; access is service-role-only.
- **R3.** The fix is captured as a tracked, idempotent migration in
  `src/lib/db/migrations/` (matching the existing pattern) so it is reproducible and no
  future `db reset` reintroduces the gap.
- **R4.** Supabase advisor `rls_disabled_in_public` clears for everypropertyAI after apply.
- **R5.** No functional regression: property search, report load, sold-sales, agents/listings
  endpoint, and address ingest continue to work (all service-role paths).

---

## Key Technical Decisions

- **KTD1 — Fix via a tracked migration, not a one-off dashboard SQL edit.** The repo's
  convention is versioned SQL in `src/lib/db/migrations/`. A dashboard-only fix would clear
  the advisor but drift from source and could be undone by a reset. Author
  `011_enable_rls_public_tables.sql` mirroring the `001`/`007` idiom
  (`ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY … USING (auth.role() =
  'service_role')`, wrapped in `DO $$ … EXCEPTION WHEN duplicate_object`). Apply it to prod
  after review. *(see `src/lib/db/migrations/001_listings_rentals.sql`,
  `007_feed_health.sql`)*
- **KTD2 — `addresses`: service-role-only, no public-read.** Nothing reads `addresses` with
  the anon key, so it gets RLS + a single service-role `FOR ALL` policy — the most
  restrictive posture that keeps the app working.
- **KTD3 — Public-read tables: drop the SELECT-to-anon policy, keep/confirm service-role
  full access.** For `crawl_queue`, `property_sales`, `property_cache`, remove the
  `"Public read access"` policy and ensure a service-role `FOR ALL` policy exists.
  Verified safe by the anon-client audit above (R5).
- **KTD4 — `property_listings` / `property_rentals`: lock to service-role too (user
  decision: "lock to service-role only").** These were the one intentional public-read
  case, but the audit shows their only consumer (the agents/listings API) reads server-side
  via service role. Removing anon read aligns them with the confirmed access pattern. If a
  future direct-from-browser consumer is introduced, a scoped read policy can be re-added
  deliberately. Treated as its own unit so it can be dropped if review surfaces an anon
  reader.
- **KTD5 — Verify by re-probing, not by trusting the migration.** Re-run the anon
  INSERT/SELECT probes post-apply; the pass condition is `42501` (or `401`) on every
  table's anon write and `0 rows`/`401` on anon reads of the newly-locked tables.

---

## Implementation Units

### U1. Author the RLS migration

**Goal:** A single idempotent migration that enables RLS and installs service-role policies
on the exposed tables.
**Requirements:** R1, R2, R3.
**Dependencies:** none.
**Files:**
- `src/lib/db/migrations/011_enable_rls_public_tables.sql` (create)

**Approach:** Follow the exact idiom in `001_listings_rentals.sql` / `007_feed_health.sql`:
for `addresses` — `ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;` then a
service-role `FOR ALL` policy. For `crawl_queue`, `property_sales`, `property_cache` —
`DROP POLICY IF EXISTS "Public read access"` (name confirmed from `001`), ensure RLS
enabled, ensure a service-role `FOR ALL` policy. Wrap each `CREATE POLICY` in the repo's
`DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$;` guard so re-running is safe.
Add a header comment documenting the advisor finding and the probe evidence.

**Patterns to follow:** `src/lib/db/migrations/001_listings_rentals.sql` (RLS + policy +
duplicate-object guard), `007_feed_health.sql` (service-role-only shape).

**Test scenarios:**
- Test expectation: none (SQL migration; behaviour verified by the probe script in U3, not a
  unit test). The repo has no migration-runner test harness; verification is the probe.

**Verification:** Migration file parses and each statement is idempotent (re-runnable
without error). Peer-reviewable against the `001`/`007` pattern.

### U2. Extend the public-read lockdown to listings/rentals (conditional on KTD4)

**Goal:** Bring `property_listings` and `property_rentals` to service-role-only unless
review finds a live anon reader.
**Requirements:** R2, R5.
**Dependencies:** U1 (same migration file — add these statements to `011`).
**Files:**
- `src/lib/db/migrations/011_enable_rls_public_tables.sql` (extend)

**Approach:** Add `DROP POLICY IF EXISTS "Public read access" ON property_listings;` (and
`property_rentals`), keeping their existing service-role policy from `001`. Before landing,
re-confirm no anon/browser reader (grep done in planning; re-verify at execution against
current `main`). If an anon reader is found, drop this unit and leave the two tables
public-read — note the exception in the migration comment.

**Patterns to follow:** same as U1.

**Test scenarios:**
- Test expectation: none (SQL; covered by U3 probe). Covers R5 via the regression checks in
  U3.

**Verification:** agents/listings endpoint still returns data post-apply (service-role
path); anon SELECT on both tables returns `401`/0 rows.

### U3. Apply to production and verify with re-probe

**Goal:** Apply migration `011` to the everypropertyAI Supabase project and prove the gap
is closed with no regression.
**Requirements:** R4, R5.
**Dependencies:** U1, U2.
**Files:**
- `scripts/verify-rls.mjs` (create — a committed, reusable version of the ad-hoc probe used
  in planning: anon INSERT `{}` per table expecting `42501`; anon SELECT expecting 0 rows /
  `401` on locked tables)

**Approach:** Apply `011` via the project's normal migration path (Supabase SQL editor or
`supabase db push` — match how `001`–`010` were applied; confirm at execution). Then run
`scripts/verify-rls.mjs` against prod using `.env.local` creds. Finally, re-open the
Supabase advisor and confirm `rls_disabled_in_public` no longer lists everypropertyAI.
Smoke-test the app: run a property lookup, the agents/listings endpoint, and confirm the
address ingest path is unaffected (service role).

**Patterns to follow:** the planning probe script (anon INSERT → expect `42501`; anon SELECT
→ expect empty/`401`); env loading via `node --env-file=.env.local`.

**Test scenarios:**
- Happy path: `verify-rls.mjs` reports every target table denies anon write (`42501`) and
  denies anon read (`401`/0 rows). Covers R1, R2.
- Regression: property report renders; agents/listings returns rows; a manual
  `insertAddresses` (or existing ingest cron) still writes via service role. Covers R5.
- Advisor: `rls_disabled_in_public` cleared for `xulylioakpkvfywskmpk`. Covers R4.

**Verification:** all probe assertions pass, advisor clear, smoke tests green.

---

## Scope Boundaries

**In scope:** everypropertyAI (`xulylioakpkvfywskmpk`) RLS fix for `addresses` and
public-read hardening for `crawl_queue`, `property_sales`, `property_cache`,
`property_listings`, `property_rentals`; a tracked migration; a reusable verification script.

**Deferred to Follow-Up Work:**
- **GEA_crmAI (`anynmamtmklygngcxzus`) flagged table** — same `rls_disabled_in_public`
  class, separate project/codebase. Needs its own plan run in that repo with its creds. The
  advisor also mentions "1 other table across 1 more project" — enumerate and fix there too.
- **Broader RLS audit** — a periodic `verify-rls.mjs` run (or CI check) across all tables to
  catch future untracked-table drift. Worth doing once crmAI is closed.

**Out of scope:** rotating the anon key (not required — RLS is the correct control);
changing the auth/allowlist model; any data migration.

---

## Risks & Dependencies

- **R-low: locking a table that a forgotten anon path reads.** Mitigated by the planning
  audit (no anon data reads found) and the U3 regression smoke tests. `property_listings`/
  `property_rentals` isolated in U2 so they can be reverted independently.
- **Apply-path uncertainty:** how `001`–`010` were applied to prod isn't captured in-repo;
  confirm the mechanism (SQL editor vs `db push`) before U3. Deferred-to-execution detail.
- **Rollback:** re-adding a `"Public read access"` policy restores prior behaviour instantly
  if a regression appears; keep the DROP statements individually revertible.

---

## Sources & Research

- Live probe evidence (2026-07-02): anon INSERT/SELECT matrix across 15 tables against
  `xulylioakpkvfywskmpk`; `addresses` = `23502` (RLS off), all others `42501` (RLS on).
- `src/lib/db/migrations/001_listings_rentals.sql`, `007_feed_health.sql` — the RLS + policy
  pattern this plan mirrors.
- `src/lib/db/supabase.ts` — confirms anon client is auth-only; service role backs all data
  queries.
- `src/lib/db/queries.ts:778-829` — `addresses` usage (all service-role).
- Supabase security advisor: `rls_disabled_in_public`, flagged 2026-06-28.
