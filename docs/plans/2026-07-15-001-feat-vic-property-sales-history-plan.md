---
title: "feat: Automate per-property sales history ingestion (VIC Valuer-General)"
status: active
date: 2026-07-15
type: feat
depth: standard
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Automate per-property sales history ingestion (VIC Valuer-General)

## Summary

Every row in `property_sales` today is a single point-in-time sale scraped from Domain/REA/View — a property that's sold three times over ten years shows up as one row, whichever scrape happened to catch it. There is no multi-sale history for any property, confirmed by querying live data (zero rows from `source = 'vic-vg'`).

The fix already exists in code and is unused: `ingestVicSalesCsvUrl()` / `parseVicSalesCsvRow()` in `src/lib/jobs/ingest-vg-data.ts` (invoked via `GET /api/cron/ingest-vg/route.ts:97-190`) correctly parses Victoria's Valuer-General **individual property sales** CSV into per-address `property_sales` rows. It's only reachable by a human manually finding and pasting each quarter's download URL — nothing auto-discovers the link, and it isn't wired into the weekly cron. Contrast with the sibling `ingestVicSuburbMedians()` (same file, `ingest-vg-data.ts:262-283`), which already self-discovers its download link from a dataset page and *is* wired into `vercel.json`'s Monday 2am cron — but that function only pulls suburb-level medians, not per-property sales.

This plan gives the individual-sales path the same auto-discovery pattern the medians job already has, wires it into the existing weekly cron, and attempts a one-time historical backfill using whatever past-quarter archive links VIC's data portal exposes (scope confirmed with the user; exact archive availability is an execution-time discovery — see Open Questions).

**Not in scope:** the NSW/WA Valuer-General ingesters (`ingestNswValuerGeneral`, `ingestWaLandgate`) — both already auto-discover their download links and are already cron-wired; this plan only touches the VIC individual-sales gap. Also not in scope: adding the `abotapi/realestate-au-scraper` Apify actor (REA per-listing sale history) as a complementary source — flagged as a candidate follow-up, not built here.

---

## Problem Frame

**Who's affected:** any consumer of `property_sales`/`sold_sales` data — the CMA pack, comparable-sales estimator, vendor reports, and the property profile's sale-history display — all currently see at most one historical sale per address instead of the full record.

**Root cause:** the individual-sales CSV parser was built (likely for a manual one-off ingest) but never given the "find this quarter's link" logic the medians job has, and never added to the cron's `runValuerGeneralIngestion()` call. The GET endpoint's own doc comment says as much: "Manually ingest a VIC Valuer-General individual property sales CSV file... Pass the CSV URL as a query parameter so Stuart can trigger ingestion by pasting the download URL."

**Success criteria:**
- The weekly cron ingests VIC's current-quarter individual property sales automatically, no manual URL needed.
- A one-time backfill run ingests as much historical individual-sales data as VIC's portal exposes without a hand-supplied URL per file.
- `property_sales` rows accumulate distinct `(raw_address, sale_date, sale_price)` combinations per address over time — i.e., genuine multi-sale history, not overwrites.
- Existing suburb-medians ingestion and the manual `GET ?csvUrl=` override both keep working unchanged.

---

## Key Technical Decisions

**KTD1 — Reuse the medians job's link-discovery pattern, don't invent a new one.** `ingestVicSuburbMedians()` already fetches a VIC data-portal dataset page and regexes out the first `.xlsx?/csv/zip` download link (`ingest-vg-data.ts:267-283`). The individual-sales dataset lives on a different page (`https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics`, per the GET endpoint's own comment), but the same "fetch page, regex the download link" shape applies. Building a second copy of that logic against a different URL is the smallest correct diff — no new dependency, no new fetch abstraction.

**KTD2 — Wire into the existing cron, don't create a new schedule.** `runValuerGeneralIngestion()` (`ingest-vg-data.ts:484-500`) already fans out NSW/VIC/WA tasks in parallel from the one weekly cron entry in `vercel.json`. Add the new auto-discovering individual-sales call alongside the existing `ingestVicSuburbMedians()` call inside the same `if (options.vic !== false)` block — same cadence, same auth, same failure isolation (each task already logs its own summary independently).

**KTD3 — Backfill as a separate, explicitly-invoked path, not folded into the recurring cron.** Because backfill volume/shape is unknown until the portal is actually probed (see Open Questions), it should not silently run inside the weekly cron and risk timing out or double-processing. Add a backfill entry point (a new `GET`/`POST` action, or a param on the existing manual endpoint) that iterates whatever historical archive links are discoverable and calls the same insert path — run once, manually, then leave the weekly cron to carry it forward.

**KTD4 — Filter to Casey/Cardinia postcodes, matching the existing convention.** `ingestVicSalesCsvUrl()` already filters against `CASEY_CARDINIA_POSTCODES` (`ingest-vg-data.ts` / `route.ts:163-166`) — the auto-discovery and backfill paths reuse the same filter, consistent with the project's existing "Casey/Cardinia only" scope guard (see `docs/plans` history and the ingest allow-list convention already enforced elsewhere in this codebase).

---

## Scope Boundaries

**In scope:**
- Auto-discovery of the current-quarter VIC individual-sales CSV/Excel download link.
- Wiring that discovery + ingest into the existing weekly `vercel.json` cron.
- A one-time historical backfill attempt covering whatever past-quarter archive links the portal exposes.
- Preserving the existing manual `GET ?csvUrl=` override as a fallback (in case the site changes shape and auto-discovery breaks).

**Deferred to Follow-Up Work:**
- Adding `abotapi/realestate-au-scraper` (or any other Apify actor) as a complementary REA-side sale-history source.
- NSW/WA individual-sales — already automated; no work needed.
- Surfacing multi-sale history in the property profile UI beyond what already reads from `property_sales`/`sale_history` (a UI plan, not a data-feed plan).
- Healthchecks.io-style monitoring for this cron path (the project has this pending generally, per prior feed-reliability work; not unique to this feature).

---

## Implementation Units

### U1. Auto-discover the current VIC individual-sales CSV link

**Goal:** Replace the manual-URL requirement with a self-discovering fetch, mirroring `ingestVicSuburbMedians()`'s pattern against the individual-sales statistics page instead of the yearly-summary page.

**Requirements:** Success criterion 1 (weekly cron ingests current-quarter sales automatically).

**Dependencies:** None.

**Files:**
- `src/lib/jobs/ingest-vg-data.ts` — add `ingestVicIndividualSales()` (or similarly named export), following `ingestVicSuburbMedians()`'s shape: fetch `https://www.land.vic.gov.au/valuations/resources-and-reports/property-sales-statistics`, regex the current download link, fetch it, hand rows to the existing `parseVicSalesCsvRow` (currently defined in `src/app/api/cron/ingest-vg/route.ts` — see Deferred Implementation Notes on whether to relocate it), filter via `CASEY_CARDINIA_POSTCODES`, call `insertPropertySales`.
- `src/lib/jobs/__tests__/ingest-vg-data.test.ts` (new) — unit tests for the new function's link-discovery and row-parsing/filtering behavior.

**Approach:** The existing `parseVicSalesCsvRow` + `splitCsvLine` + the Casey/Cardinia filter loop currently live in `route.ts` (used by the manual GET handler). Since `ingest-vg-data.ts` needs the same parsing logic for the auto-discovery path, move `parseVicSalesCsvRow` and `splitCsvLine` into `ingest-vg-data.ts` (alongside the other parse functions) and have `route.ts`'s manual GET handler import them from there — single source of truth for the parser, both the manual and automated paths call it.

**Patterns to follow:** `ingestVicSuburbMedians()` (`ingest-vg-data.ts:262-283`) for the fetch-page → regex-link → fetch-file shape; `ingestVicSalesCsvUrl()` (`route.ts:123-179`) for the parse → filter → insert shape being relocated/reused.

**Test scenarios:**
- Happy path: dataset page HTML containing a valid `.csv`/`.xlsx` link resolves to a full URL and the file's rows are parsed and inserted, non-Casey/Cardinia postcodes excluded.
- Edge case: dataset page returns HTML with no matching download link — function returns a `{ inserted: 0, errors: 1 }`-shaped result without throwing, matching `ingestVicSuburbMedians()`'s existing failure-return convention.
- Edge case: relative `href` (no `https://` prefix) is correctly resolved to an absolute URL, same as the medians job's `downloadUrl` resolution.
- Error path: dataset page fetch times out or returns non-200 — logged and returned as an error count, does not throw (matches sibling function behavior so `Promise.allSettled`-style fan-out in `runValuerGeneralIngestion` isn't affected).
- Integration: a row already present (same `raw_address, sale_date, sale_price, source`) does not duplicate on a second run, verifying the existing `onConflict` dedup in `insertPropertySales` still applies through the new path.

**Verification:** Running the new function against a live fetch returns `inserted > 0` for at least one Casey/Cardinia row when the current quarter's CSV is available, and the manual `GET ?csvUrl=` path still works unchanged (regression check on the relocated parser).

---

### U2. Wire the auto-discovering ingest into the weekly cron

**Goal:** Every Monday 2am run picks up the current quarter's individual sales with no manual step.

**Requirements:** Success criterion 1.

**Dependencies:** U1.

**Files:**
- `src/lib/jobs/ingest-vg-data.ts` — add the U1 function's invocation inside `runValuerGeneralIngestion()`'s `if (options.vic !== false)` block (`ingest-vg-data.ts:496-500`), alongside the existing `ingestVicSuburbMedians()` call, logging its own summary the same way.

**Approach:** No `vercel.json` change needed — the cron already calls `runValuerGeneralIngestion({ nsw: true, vic: true, wa: true })` via the existing POST handler; adding the new task inside the existing `vic` branch is sufficient.

**Test scenarios:**
- Integration: calling `runValuerGeneralIngestion({ vic: true })` triggers both the medians task and the new individual-sales task (verify via a spy/mock on both exported functions, since the real implementation makes live network calls).
- Edge case: `runValuerGeneralIngestion({ vic: false })` skips both VIC tasks, matching current behavior for the medians job.
- Test expectation for the cron route itself: none beyond the above — `route.ts`'s POST handler already delegates entirely to `runValuerGeneralIngestion` and isn't changing.

**Verification:** Triggering `POST /api/cron/ingest-vg` (with `CRON_SECRET` or in dev mode) produces log lines for both the medians and individual-sales VIC tasks, and `property_sales` gains new `vic-vg` rows after a run where the current quarter wasn't already ingested.

---

### U3. One-time historical backfill

**Goal:** Seed as much historical per-property sale data as VIC's portal exposes, not just data from today forward.

**Requirements:** Success criterion 2 (backfill scope confirmed with user).

**Dependencies:** U1 (reuses its parser/insert path).

**Files:**
- `src/lib/jobs/ingest-vg-data.ts` — add a backfill function that, given the individual-sales statistics page (or a documented archive index if one exists — see Open Questions), enumerates all discoverable historical download links (not just the first/current one) and ingests each.
- `src/app/api/cron/ingest-vg/route.ts` — add a way to trigger the backfill explicitly and separately from the recurring cron (e.g., a `?backfill=true` param on the existing GET handler, or a dedicated route) so it's a deliberate one-time action, not something the weekly cron silently re-runs.

**Approach:** Execution-time discovery required — the plan cannot specify exact archive URLs or how many historical files are exposed until the page is actually inspected during implementation (WebFetch against it returned HTTP 403 during planning; the implementer will need a different access path — browser-based check, or the existing Firecrawl/Web Unlocker infra already used elsewhere in this codebase for blocked government/portal sites). If the page only ever exposes the current quarter (no archive), degrade gracefully: log that no historical links were found and confirm with the user that history will simply accumulate from this point forward, matching the fallback already discussed and accepted.

**Deferred implementation note:** Whether the historical archive (if any) is paginated, requires a different base URL per year, or is entirely absent is unknown at planning time — resolve during implementation and update this unit's approach in a follow-up commit note if it diverges meaningfully from a simple "regex all matching links on one page."

**Test scenarios:**
- Happy path: given a page with multiple historical download links, all are enumerated and each file's rows are ingested (deduped via the existing `onConflict`).
- Edge case: no historical links found beyond the current quarter — function completes without error, logs a clear "no historical archive found" message, returns a zero/near-zero backfill count.
- Error path: one historical file fails to fetch/parse — other files in the batch still proceed (isolated per-file try/catch, not an all-or-nothing loop).
- Integration: running the backfill after U1/U2 have already ingested the current quarter does not duplicate that quarter's rows (same dedup key).

**Verification:** After running the backfill trigger once, `property_sales` (filtered to `source = 'vic-vg'`) shows either multiple sale dates for at least some Casey/Cardinia addresses (if history was available) or a logged, explicit statement that only current-quarter data exists (if it wasn't) — either way, the outcome is visible and not silently absent.

---

## Open Questions

- **Does VIC's individual-sales statistics page expose an archive of past quarters, or only the current one?** Could not verify during planning — a direct `WebFetch` against `land.vic.gov.au` returned HTTP 403 (bot-protected, consistent with other AU property/government sites this project already works around via Web Unlocker/stealth). Resolve at U3 implementation time using the project's existing blocked-site access patterns (`src/lib/webunlocker/client.ts`, `src/lib/stealth/client.ts`) rather than a plain `fetch`.
- **Should the relocated `parseVicSalesCsvRow`/`splitCsvLine` move fully into `ingest-vg-data.ts`, or should `ingest-vg-data.ts` import them from `route.ts` instead?** Either direction works; U1 proposes moving them into the jobs file (where the other VG parsers already live) since Next.js route files aren't typically meant to be imported from application code — confirm during implementation if this creates an import-cycle or build issue.

---

## Verification Contract

- Unit tests for U1's link-discovery and parsing/filtering pass.
- Integration test confirms U2's cron wiring invokes both VIC tasks.
- Manual verification: trigger the cron (or call the functions directly in a dev script) and confirm new `vic-vg` rows appear in `property_sales` with the Casey/Cardinia filter correctly applied.
- Regression: existing manual `GET ?csvUrl=` endpoint and `ingestVicSuburbMedians()` continue to work unchanged.

## Definition of Done

- `property_sales` receives current-quarter VIC individual sales automatically via the existing weekly cron, no manual URL required.
- A one-time backfill has been run, and its outcome (rows added, or explicit "no archive available") is confirmed and logged.
- All new code has test coverage per the Test Scenarios above, and the full test suite passes with no regressions.
