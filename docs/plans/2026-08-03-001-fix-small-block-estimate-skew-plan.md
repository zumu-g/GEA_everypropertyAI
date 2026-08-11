---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
date: 2026-08-03
---

# fix: Correct comparables estimate skew for below-typical land size

## Summary

28 Serene Way, Clyde North (299m² block) estimated at $983k while its own street and same-size comps sold $740k–$850k. Root cause investigation (live data, not hypothesis) found two independent, additive problems: (1) sold-sale rows are missing bedroom counts on 91% of the local pool because the Domain Apify sold feed never returns beds, and (2) even where land size *is* known (as it was here), the radius/time comp-gathering ladder has no land-size-awareness — it stops widening once enough *recent* comps are found, regardless of whether any are actually land-similar to the subject. For 28 Serene Way this meant 135 comps gathered, only 9 of them ≤400m², diluting the weighted median toward the pocket's typical 450–650m² stock.

Verified with live DB queries against the real subject (landArea=299m², vicmap-parcel, confidence 55): steepening the existing land-weight decay curve alone only moves the estimate $988k→$972k (the pool is too large-block-skewed for reweighting to fix it), but explicitly guaranteeing land-similar comps are present in the pool drops the unweighted median to $847k — matching the small-block reality. This plan fixes the actual lever (comp-gathering) and layers a smaller, correct-direction land-weight tweak on top, plus a modest (~5%) bedroom-data backfill for the unrelated but real bedroom-null problem.

## Problem Frame

`estimateFromComparables` (`src/lib/estimation/comparables-estimator.ts`) and its comp-gathering caller `getEstimate` (`src/lib/estimation/estimate-service.ts`) produce accurate weighted-median estimates *given the comp pool they're handed* — the math isn't wrong. Two upstream problems skew that pool for below-typical-size subjects:

1. **Comp-gathering has no land-size awareness.** `RADIUS_LADDER_KM` widening (`estimate-service.ts:153-167`) stops once `recentEnough >= IDEAL_COMPS` (8), a pure count+recency check. A subject whose land size sits at the tail of the local distribution (like 299m² here) gets a pool dominated by the area's typical (larger) stock, and `similarityWeight`'s land decay (steepness 0.7 for houses) isn't steep enough to correct for a pool that's structurally short on land-similar comps in the first place — reweighting a skewed pool can't fully undo the skew.
2. **91% of sold rows in the affected pool have null bedrooms**, because `scripts/ingest-domain-apify.mjs`'s sold mapper reads `prop.bedrooms` (`ingest-domain-apify.mjs:200`) but the Domain Apify sold-listings actor genuinely never populates that field for sold items (confirmed: `raw_data` is null on every affected row, so there's nothing to backfill from re-parsing). This is a separate, smaller issue from (1) — it affects confidence scoring and bed-based weighting, not this specific case's skew (the subject's land size, not beds, was the working signal), but it's real and worth a modest fix.

## Requirements

- R1: When the subject's `landAreaSqm` is known, comp-gathering (`getEstimate`) must ensure at least a minimum number of land-similar comps are present in the final pool before stopping the radius ladder — not just any recent comps.
- R2: The land-similarity weighting decay in `similarityWeight` should be steeper for house subjects when bedrooms are unknown on the subject (land is the only available size-discriminating signal in that case).
- R3: A one-off backfill fills `bedrooms`/`bathrooms`/`car_spaces` on `property_sales` rows from matching `property_listings`/`property_rentals` rows by normalised address, for rows currently null (existing non-null values are never overwritten).
- R4: Going forward, new sold-row ingestion looks up a bed/bath match from `property_listings`/`property_rentals` at ingest time when the sold feed itself didn't supply beds/baths, so the gap doesn't silently regrow.
- R5: The estimate's methodology note should say when land-similar comps were sparse even after widening, so a low-confidence estimate is visibly flagged rather than presented at face value.

## Key Technical Decisions

- **Fix comp-gathering, not just weighting (KTD1).** Verified via live-data reproduction: steepening land-weight decay alone only moved the estimate ~1.6% ($988k→$972k) because the pool itself has too few land-similar comps for reweighting to compensate — 9 of 135 comps were ≤400m². Explicitly widening the ladder until enough land-similar comps are found (200 exist within 5km; 12 already within 1km, above `MIN_COMPS`) moved the unweighted median to $847k, matching the small-block reality. Reweighting is still worth doing (KTD2) but is the smaller lever.
- **Land-similar band definition.** Define "land-similar" as `landAreaSqm` within `[0.6x, 1.6x]` of the subject's — matches the `similarityWeight` land decay's own inflection zone (at steepness 0.7, ratio 1.6 gives weight ≈0.71; at the proposed steepened 1.5 for beds-unknown subjects, ratio 1.6 gives weight ≈0.44), so "similar enough to matter" is defined consistently with what the weighting function will actually treat as similar.
- **Minimum land-similar comp count: `MIN_LAND_SIMILAR_COMPS = 3`**, mirroring `MIN_COMPS`. Chosen because the pool already clears this easily once the ladder is allowed to widen (12 within 1km here) — this isn't a scarce resource requiring a larger threshold, and setting it low avoids over-widening (and re-including comps from adjacent, possibly-pricier suburbs) when it isn't needed.
- **Ladder change is additive, not a rewrite.** `estimate-service.ts`'s existing `for (const radius of RADIUS_LADDER_KM)` loop and its `recentEnough >= IDEAL_COMPS` break condition stay; the break condition gains a second clause (land-similar count check, only when `subject.landAreaSqm` is known) so both non-land-constrained callers (subject land unknown) and this fix share the same loop.
- **Land-weight steepness is conditional on bedrooms being unknown, not a blanket increase (KTD2).** When `subject.bedrooms != null`, the existing bed-diff weighting already discriminates size reasonably; steepening land decay there too would double-penalise. When `subject.bedrooms == null` (still common even after R3/R4), land is the only size signal available and deserves more weight. Value: 1.5 (chosen from the tested range 0.7→3.0, where returns diminished sharply past ~2.0; 1.5 is a meaningful step without over-fitting to one address).
- **Backfill scope is intentionally small (KTD3).** Live-tested address-overlap between null-bed `property_sales` rows and `property_listings`/`property_rentals`: ~5% match rate even restricted to the last 24 months (property_listings holds ~8,700 rows of *current* on-market stock only, not a historical archive, so most past sales were never on our feed while active). This is a real, low-risk, low-effort win — not a fix for the 91%-null problem, which has no cheap solution from data we already hold (see Scope Boundaries).

## High-Level Technical Design

```
getEstimate() radius/time ladder (estimate-service.ts), per radius in [1, 2, 5]:
  fetch box → filter distance/price/date/prefilter → addComp()
  recentEnough = count(comps, <=24mo)
  landSimilarEnough = subject.landAreaSqm == null
                        ? true   // no land signal to guarantee against
                        : count(comps, landAreaSqm in [0.6x, 1.6x] of subject) >= MIN_LAND_SIMILAR_COMPS
  if (recentEnough >= IDEAL_COMPS AND landSimilarEnough) break  // ← new second clause
```

## Implementation Units

### U1. Land-similar comp guarantee in the radius ladder

**Goal:** Comp-gathering keeps widening the radius ladder until enough land-similar comps are present, not just enough recent ones.
**Requirements:** R1, R5
**Dependencies:** none
**Files:**
- `src/lib/estimation/estimate-service.ts` (radius-ladder loop, `MIN_LAND_SIMILAR_COMPS` constant)
- `src/lib/estimation/comparables-estimator.ts` (export a small `isLandSimilar(subjectLand, compLand): boolean` helper so the ladder and the weighting function share one definition of "similar")
- `src/lib/estimation/__tests__/estimate-service.test.ts` (new scenarios)

**Approach:** Add `MIN_LAND_SIMILAR_COMPS = 3` alongside the existing `MIN_COMPS`/`IDEAL_COMPS` constants. Export `isLandSimilar(subjectLand: number, compLand: number | null | undefined): boolean` from `comparables-estimator.ts` (ratio in `[0.6, 1.6]`), used both by the new ladder check and optionally referenced in comments near `similarityWeight`'s land decay so the two stay conceptually aligned. In the `for (const radius of RADIUS_LADDER_KM)` loop, after the existing `recentEnough` count, add a `landSimilarEnough` check (true immediately when `subject.landAreaSqm == null`, since there's nothing to guarantee) and require both before breaking. If the ladder exhausts all radii (5km) still short on land-similar comps, proceed with whatever pool exists (no behavior change to the "insufficient comps" fallback path) but pass a flag through to `estimateFromComparables` so R5's methodology note can fire.
**Patterns to follow:** the existing `recentEnough` computation immediately above the break condition (`estimate-service.ts:165-166`).

**Test scenarios:**
- Happy path: subject with `landAreaSqm=300`, radius-1km pool has 8 recent comps but only 1 land-similar (180-480m²) one → ladder widens to 2km/5km until 3 land-similar comps found, even though `recentEnough` was already satisfied at 1km.
- Subject `landAreaSqm` unknown → ladder behavior unchanged from today (stops purely on `recentEnough`, matching current tests).
- Edge case: land-similar comps genuinely don't exist within 5km → ladder exhausts without error, existing `MIN_COMPS` fallback logic still applies unchanged.
- Edge case: land-similar comps present from the start (radius=1km already has 5) → no extra widening occurs (no behavior change from today for well-served pools).

**Verification:** unit tests pass; manual re-check against 28 Serene Way's live data shows the pool now includes the small-block comps found in this investigation.

---

### U2. Steeper land-weight decay when subject bedrooms unknown

**Goal:** `similarityWeight`'s land decay uses a steeper curve for house subjects when bedrooms aren't known, since land becomes the only available size-discriminator.
**Requirements:** R2
**Dependencies:** none (independent of U1; both apply to the same estimate, compounding correctly since one changes pool composition and the other changes weighting within it)
**Files:**
- `src/lib/estimation/comparables-estimator.ts` (`similarityWeight`)
- `src/lib/estimation/__tests__/comparables-estimator.test.ts` (new scenarios)

**Approach:** In the existing `wLand` block, change the house-bucket steepness from a fixed `0.7` to `subject.bedrooms == null ? 1.5 : 0.7`. Land-bucket (vacant land) subjects keep their existing `2.0` unchanged — this only affects the house branch.
**Patterns to follow:** the existing `steepness = subjBucket === 'land' ? 2.0 : 0.7` conditional immediately above.

**Test scenarios:**
- House subject with `bedrooms` set, comp land ratio 2x → weight matches today's 0.7-steepness value (no regression for the common case).
- House subject with `bedrooms: undefined`, comp land ratio 2x → weight is measurably lower than the 0.7-steepness value (steeper decay applied).
- Land-bucket subject, `bedrooms` unset → steepness stays 2.0 (unaffected by this change).

**Verification:** unit tests pass; existing `comparables-estimator.test.ts` suite has no regressions.

---

### U3. Bedroom/bathroom backfill from listings & rentals

**Goal:** One-off script fills null `bedrooms`/`bathrooms`/`car_spaces` on `property_sales` from address-matched `property_listings`/`property_rentals` rows.
**Requirements:** R3
**Dependencies:** none
**Files:**
- `scripts/backfill-sale-beds-from-listings.mjs` (new)

**Approach:** Mirror `scripts/backfill-sold-areas-dates.mjs`'s structure (`.env.local` loader, `--dry` flag, `ws` transport for Supabase realtime on Node 20, PAGE_SIZE pagination). Page through `property_sales` rows where `bedrooms IS NULL` (or `bathrooms`/`car_spaces` individually null), normalise `raw_address` (`.trim().toLowerCase()`), look up a match in `property_listings` first, then `property_rentals` if no listings match, by the same normalised key. Where a match exists, `UPDATE` only the specific null column(s) — never overwrite a non-null value, so re-runs are idempotent (same rule as the 008 backfill). When more than one row shares the normalised address in the lookup table (e.g. a relisted property), take the most-recently-seen row (`last_seen_at` desc) rather than an arbitrary match. Log a summary count (rows scanned, matches found, rows updated) at the end; `--dry` reports without writing.
**Patterns to follow:** `scripts/backfill-sold-areas-dates.mjs` (script shape, idempotency rule, `--dry` flag, env loader).

**Test scenarios:**
Test expectation: none -- one-off operational script with no importable logic beyond simple string normalisation (already covered by existing `addComp`-style lowercased-trim matching used elsewhere in the codebase); verified via `--dry` run output and a spot-check of updated rows post-run, not unit tests.

**Verification:** `node scripts/backfill-sale-beds-from-listings.mjs --dry` reports a plausible match count (roughly in line with the ~5% address-overlap measured during investigation); a live run followed by a DB spot-check on a handful of updated addresses confirms correct values landed and no non-null value was overwritten.

---

### U4. Ingest-time bed/bath lookup for new sold rows

**Goal:** New sold-row ingestion fills bedrooms/bathrooms/car_spaces from a matching listings/rentals row when the sold feed itself has no value, so the gap doesn't regrow after U3's one-off fix.
**Requirements:** R4
**Dependencies:** U3 (shares the same address-matching approach; implement after U3 so the lookup logic is proven against real data first)
**Files:**
- `scripts/ingest-domain-apify.mjs` (sold category `map()`, manual CLI ingest path)
- `src/lib/ingest/domain-mapper.ts` (`bedrooms`/`bathrooms` mapping around line 205 — feeds the live scheduled ingest route below)
- `src/app/api/ingest/domain/route.ts` (the production Apify-webhook/Web-Unlocker ingest endpoint; both this route and the CLI script must apply the lookup or R4 is only satisfied for manual runs, not the live daily ingestion path)

**Approach:** Both sold-ingest call sites — the CLI script's `map()` and `domain-mapper.ts`'s mapping (used by the live `route.ts` endpoint) — independently produce rows with null beds/baths when the feed omits them. Extract the address-normalisation + listings-then-rentals lookup (from U3) into one shared helper and call it from both places, after mapping and before upsert, filling `bedrooms`/`bathrooms`/`car_spaces` only when the feed-derived value is null. A lookup miss must not block or fail the sold-row ingest. Because the CLI script is plain `.mjs` (no `@/` TS path-alias access) while `route.ts`/`domain-mapper.ts` are TS modules, place the shared helper somewhere both can reach it without an alias (e.g. a relative-importable module under `scripts/lib/` mirrored or referenced by both, or a plain-JS helper each side imports directly) — confirm the concrete module boundary during implementation.
**Patterns to follow:** U3's address-normalisation and listings-then-rentals fallback order; the existing sold `map()` function structure in `ingest-domain-apify.mjs:185-212`; `domain-mapper.ts`'s existing `bedrooms`/`bathrooms` mapping (~line 205).

**Test scenarios:**
- Sold row with no beds/baths ingested, matching `property_listings` row exists → sold row gets beds/baths filled at ingest time.
- Sold row with no beds/baths ingested, no match in either table → row ingests successfully with nulls (unchanged from today).
- Sold row already carries beds/baths from the feed → lookup is skipped entirely (feed data always wins over inferred data).

**Verification:** manual run of the ingest script against a small known dataset confirms filled rows match expectations; existing ingest tests (if any) still pass.

---

## Scope Boundaries

### Deferred to Follow-Up Work
- Closing the remaining ~86% bedroom-null gap (rows with no address match anywhere in our data) — no cheap fix exists from data already held; would require either a paid enrichment source or accepting the gap and leaning on land-based weighting (this plan's U1/U2) as the durable mitigation.
- Backfilling `property_type` nulls or other attribute gaps beyond bedrooms/bathrooms/car_spaces — out of scope, not implicated in this investigation.
- The three-tier "corroborates / broadly consistent / diverges" wording improvement for cross-check methodology text, raised during the original investigation — cosmetic, unrelated to the skew root cause.
- Applying the same suburb-mixing consideration (Berwick comps pulling border Clyde North estimates up) raised during investigation — no evidence gathered here that it's a material factor once U1 is in place; would need its own investigation.

## Definition of Done

- U1-U4 implemented, tests passing.
- Re-running the estimate for 28 Serene Way (or an equivalent small-block address) shows a materially lower, better-grounded estimate than $983k, with methodology text reflecting the actual comp composition.
- `node scripts/backfill-sale-beds-from-listings.mjs --dry` run confirms scope before the live run.

### Verified result (2026-08-03)

Re-ran `getEstimate` against live data for 28 Serene Way (landArea=299m², via the profile's own Vicmap-parcel figure): **$983,085 → $949,500** (-3.4%), band unchanged (±10%). Top-weighted comps shifted from a mix dominated by undiscounted unknown-land sales to genuinely small-block (350-400m²) sales at $740k-$810k, confirming U1/U2 are working as designed.

**One addendum beyond the plan's original text, implemented during verification:** comps with unknown `landAreaSqm` were found to receive a full 1.0 weight (no penalty) even when the subject's land size is known and land is the operative signal — inconsistent with the codebase's own existing convention (`wDistance` already penalises an unknown comp distance to 0.6 rather than 1.0). Without this, unknown-land comps dominated the weighted median regardless of U1/U2. Fixed in `similarityWeight` (`comparables-estimator.ts`) by applying the same 0.6 uncertainty penalty to unknown comp land size, mirroring the distance treatment; covered by two new test scenarios.

**Known residual gap (not closed by this plan):** the improved estimate ($949,500) is still above the ~$840-850k a small-block-only comp set implies. Weighting (this plan's approach) is inherently more conservative than a hard filter, since it preserves signal from the full 126-comp pool rather than discarding the ~92 non-land-similar comps outright — a deliberate tradeoff, not a bug. Closing the remaining gap would mean a harder filter or floor on land-dissimilar comps, which is a larger, higher-risk change (could misbehave in suburbs with less size variance) and is deferred as follow-up work, not part of this plan's DoD.
