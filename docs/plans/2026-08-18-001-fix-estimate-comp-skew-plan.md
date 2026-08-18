---
title: "fix: Comparables estimate skews high for small/below-typical properties"
type: fix
date: 2026-08-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: Comparables estimate skews high for small/below-typical properties

## Summary

The comparables price estimate for 66A Duncan Dr, Pakenham (3 bed / 2 bath / 370m², off-market) shows **$930,917** against an expected **$650,000–$700,000** — corroborated by two independent AVMs we now scrape (Allhomes $630k high-confidence, OnTheHouse $655k, range $650–700k). The subject's attributes reach the estimator correctly; the skew comes from comp-pool calibration: null-attribute comps enter at (nearly) full weight, land/bed similarity decay is too shallow when the subject's bedrooms are known, and the suburb-median cross-check threshold (25%) is too loose to flag a 22.7% divergence. This plan recalibrates the price estimator, tightens cross-checks, adds the newly-available external AVM estimates as cross-checks (price and rent), and verifies the rent estimator's yield-divergence flag resolves once the price estimate is fixed.

---

## Problem Frame

**Observed:** `/api/estimate` for 66A Duncan Dr returns priceMid $930,917 (band ±13%, medium confidence), methodology "74 comparable sales within 1.0km … Suburb median corroborates." Suburb house median is $720,000. Two external AVMs place the property at $630–655k.

**Root cause (verified in code, `src/lib/estimation/`):**

1. **Null-attribute comps are under-penalised.** The prefilter (`estimate-service.ts` `passesPrefilter`) only hard-excludes a comp when its bed count is *known* to differ by ≥2. VG-sourced sale rows routinely carry NULL beds/land, so large new-estate homes enter the pool with `wBeds = 1.0` and `wLand = 0.6`. In a 74-comp pool in a growth corridor, these dominate the weighted median.
2. **Shallow similarity decay when subject beds are known.** `similarityWeight` uses land-ratio steepness 0.7 when `subject.bedrooms != null` (vs 1.5 when unknown). A 600m² comp against a 370m² subject retains ~71% weight; a 4-bed comp against a 3-bed subject retains 75%.
3. **Suburb-median cross-check threshold too loose.** 25% — the observed 22.7% divergence passes as "corroborates", actively misleading the reader.
4. **External anchors unused.** Since PR #44 the profile carries `estimatedValue` from allhomes.com.au and onthehouse.com.au (and `estimatedRent` from Allhomes), but the estimator never sees them.

**Rent estimate:** $531/pw matches Allhomes' independent $530/pw — the rent *comparables* calibration is healthy. Its "Yield-implied rent diverges 36.9%" flag is **downstream of the price bug**: yield-implied rent = saleEstimateMid × gross yield / 52 = $930,917 × 4.06% / 52 ≈ $727/pw. Fixing the price estimate resolves most of this divergence; the rent scope is verification plus the external-rent cross-check.

---

## Requirements

- **R1** — For a subject with known beds/land, comps with NULL beds or NULL land must not carry full similarity weight relative to well-matched comps.
- **R2** — Similarity decay (beds, land) must be steep enough that a pool dominated by larger/newer stock cannot pull the weighted median more than ~10% above what size-matched comps support. Verified via the 66A-shaped fixture (U1).
- **R3** — The suburb-median cross-check must flag divergence at a threshold consistent with the other checks (15%), not 25%.
- **R4** — When the profile carries external AVM estimates (Allhomes `estimatedValue`, OnTheHouse `estimatedValue`/range), the price estimate must cross-check against them: divergence >15% widens the band and lowers confidence, with the source named in the methodology line. Our estimate remains independently computed — external values are cross-checks, never inputs to the median.
- **R5** — The rent estimate must cross-check against Allhomes' `estimatedRent` the same way (threshold 15%).
- **R6** — The yield-implied rent divergence flag for 66A must clear (fall under its 25% threshold) once the price estimate is corrected — verified, not assumed.
- **R7** — No regression on the existing estimator test suite (currently 29 tests in `src/lib/estimation/__tests__/comparables-estimator.test.ts`), including the 28 Serene Way small-block scenario from the 2026-08-03 plan.

---

## Key Technical Decisions

- **KTD1 — Recalibrate weights; do not hard-filter null-attribute comps.** (session-settled: user-approved — chosen over hard prefilter exclusion: data-sparse suburbs would lose their comp pool entirely.) Penalise unknowns multiplicatively (mirroring the existing null-land 0.6 treatment) rather than excluding rows. Governs R1, R2.
- **KTD2 — External AVMs are cross-checks, not anchors.** (session-settled: user-directed — chosen over blending external estimates into the median: keeps our estimate independent of third-party models.) They enter via the existing `pushCheck` mechanism. Governs R4, R5.
- **KTD3 — Rent scope is verification + cross-check only.** The rent comparables calibration already matches external evidence; only the plumbing for R5/R6 changes. Governs R5, R6.
- **KTD4 — Fixture-driven calibration.** Weight constants are tuned against a reproduction fixture shaped like the 66A pool (many large/null-attribute comps, few size-matched ones), not against intuition. The fixture asserts a target range, not an exact figure.

---

## Implementation Units

### U1. Reproduction fixture and characterisation test

**Goal:** A test fixture reproducing the 66A skew shape so calibration changes are measured, not guessed.
**Requirements:** R2, R7
**Dependencies:** none
**Files:** `src/lib/estimation/__tests__/comparables-estimator.test.ts`
**Approach:** Build a synthetic comp pool shaped like the observed one: ~15 size-matched sales (3 bed, 300–450m², ~$620–680k), ~40 larger/newer sales (4–5 bed or NULL beds, 500–700m² or NULL land, $850k–$1.05M), subject = 3 bed / 2 bath / 370m² house with coords. Assert the *current* estimator lands well above the size-matched cluster (characterises the bug), marked to flip after U2.
**Test scenarios:**
- Skewed pool + known-attribute subject → current estimator returns priceMid > $800k (characterisation, replaced by U2's target assertion)
- Size-matched-only pool → estimator lands inside $620–680k (sanity baseline, must hold before and after)

### U2. Recalibrate similarity weights and null-attribute penalties

**Goal:** Size-matched comps dominate the weighted median when the subject's attributes are known.
**Requirements:** R1, R2, R7
**Dependencies:** U1
**Files:** `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/__tests__/comparables-estimator.test.ts`
**Approach:**
1. When subject beds are known and the comp's beds are NULL, `wBeds` becomes an uncertainty penalty (~0.7), mirroring the existing null-land 0.6 rule — update the "never penalise a NULL" docstring to reflect the two-sided rule.
2. Steepen known-bed land decay from 0.7 toward ~1.2 (fixture-tuned); steepen bed-diff weights (diff 1: 0.75 → ~0.6; diff ≥2: 0.4 → ~0.25).
3. Tune against the U1 fixture until the skewed pool lands within ~10% of the size-matched cluster (~$620–750k), while the Serene Way and existing scenarios still pass.
4. AVM-independent guardrail (doc-review finding): the U6 backtest script (see U6) re-estimates recent sold properties with known prices; median absolute error must not worsen vs the current constants before the recalibration ships.
**Patterns to follow:** the null-land 0.6 penalty and its rationale comment (comparables-estimator.ts, wLand block); KTD4 land-steepness precedent from the 2026-08-03 small-block plan.
**Test scenarios:**
- Skewed pool (U1) → priceMid within $620–750k
- Comp with NULL beds vs subject with known beds → weight lower than an equal comp with matching beds, higher than one with diff ≥2
- Subject with unknown beds → NULL-bed comps keep weight 1.0 (penalty only applies when the subject side is known)
- All existing estimator tests (currently 29) pass unchanged

### U3. Tighten suburb-median cross-check

**Goal:** A 22.7% divergence from the suburb median flags instead of "corroborates".
**Requirements:** R3, R7
**Dependencies:** U2 (avoid double-counting band widening while calibrating)
**Files:** `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/__tests__/comparables-estimator.test.ts`
**Approach:** Lower the suburb-median `pushCheck` threshold from 0.25 to 0.15, matching the prior-sale and listing-guide checks. Review the flag's band-widening (×1.25) interaction with U2's recalibration on the fixture.
**Test scenarios:**
- priceMid 20% above suburb median → check flagged, band widened, confidence reduced
- priceMid 10% above suburb median → corroborates

### U4. External AVM price cross-checks

**Goal:** Allhomes/OnTheHouse estimates flag divergent estimates automatically.
**Requirements:** R4
**Dependencies:** U2
**Files:** `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/estimate-service.ts`, `src/lib/extraction/merger.ts`, `src/app/api/estimate/route.ts`, `src/components/property/PropertyProfile.tsx`, `src/lib/estimation/__tests__/comparables-estimator.test.ts`
**Approach:**
1. Add `externalEstimates?: Array<{ source: string; value: number }>` to `ComparableSubject` / `EstimateSubjectInput`.
2. In `estimateFromComparables`, `pushCheck` each external estimate (label `"<source> estimate"`, threshold 0.15).
3. Merger change (doc-review finding — the merger collapses `estimatedValue` to one scalar, so per-source values are otherwise unreachable): `mergePropertyData` additionally emits an `externalEstimates` array (source + value) preserving each AVM's value alongside the merged scalar. Profiles cached before the change simply lack it — silent degrade.
4. Plumb from the profile: PropertyProfile's estimate-params builder reads `externalEstimates` from merged profile data (per KTD2, values pass through — never averaged into the median). The API route accepts them as query params.
**Patterns to follow:** existing priorSale/activeListing plumbing through `EstimateSubjectInput` → `ComparableSubject` → `pushCheck`.
**Test scenarios:**
- External estimate diverging >15% from priceMid → flagged, band widened, confidence lowered, methodology names the source
- External estimate within 15% → listed as corroborating
- No external estimates → behaviour unchanged
- Two external estimates, one diverging → only the diverging one flags

### U5. External rent cross-check + yield-flag verification

**Goal:** Rent estimate cross-checks Allhomes' `estimatedRent`; yield-implied divergence clears once price is fixed.
**Requirements:** R5, R6
**Dependencies:** U2, U4
**Files:** `src/lib/estimation/rental-comparables-estimator.ts`, `src/lib/estimation/estimate-rental-service.ts`, `src/lib/extraction/merger.ts`, `src/app/api/estimate-rent/route.ts`, `src/components/property/PropertyProfile.tsx`, `src/lib/estimation/__tests__/rental-comparables-estimator.test.ts`
**Approach:** Mirror U4's plumbing for `estimatedRent` (threshold 0.15). Doc-review finding: `estimatedRent` is not in the merger's `SCALAR_FIELDS`, so it currently never survives the merge — add it (and reuse the `externalEstimates`-style pass-through for per-source rent values). Profiles cached before the change won't carry it until re-crawled. No calibration change to the rent comparables themselves (KTD3). Verify with a fixture that a corrected saleEstimateMid (~$680k × 4.06% / 52 ≈ $531) brings yield-implied divergence under its 25% threshold.
**Test scenarios:**
- External rent estimate diverging >15% → flagged; within → corroborates
- Yield check with corrected sale mid (~$680k) and comp rent ~$531 → not flagged
- No external rent estimate → behaviour unchanged

### U6. Live verification against 66A Duncan Dr

**Goal:** Prove the fix on the motivating property.
**Requirements:** R2, R4, R6
**Dependencies:** U2–U5 deployed
**Files:** none (verification unit)
**Approach:** (Extended per doc review — two spot-checks are too thin for a global constant change.) Add `scripts/backtest-estimator.mjs`: batch re-estimates 20–30 recent `property_sales` rows with known prices (held-out) across suburbs, units/houses, and small/large blocks, reporting per-property old-vs-new priceMid and median absolute error vs actual sale price. Run it against prod data before declaring done; flag any >15% shift for manual review. Also measure the suburb-median flag rate at the 15% threshold — if well-comped properties flag at an unacceptable rate, widen to 20% and record the choice. Then fetch `/api/estimate` for 66A Duncan Dr.
**Test expectation: none — live verification unit (script is the harness).**
**Verification:** backtest median absolute error does not worsen vs current constants; priceMid for 66A lands in ~$620–750k; methodology names the external cross-checks; rent estimate's yield divergence flag cleared.

---

## Scope Boundaries

**In scope:** price-estimator weighting/threshold calibration, external AVM cross-check plumbing (price + rent), reproduction fixture, live verification.

### Deferred to Follow-Up Work
- Regression-based or per-m² pricing models (rejected previously — comp attributes too often NULL).
- Persisting estimate history / drift monitoring across recalibrations.
- Using external AVM values as blend inputs (explicitly rejected — KTD2).
- Rent comparables calibration changes (no evidence of miscalibration — KTD3).

---

## Risks & Dependencies

- **Calibration whack-a-mole:** steeper decay could under-weight legitimate comps in data-sparse suburbs, pushing more estimates to the low-confidence suburb fallback. Mitigation: U1 fixture + full existing suite as guardrails; penalties are multiplicative, not exclusions (KTD1).
- **External estimate availability:** external AVM values only exist for properties whose profile crawl succeeded (Allhomes/OTH). The cross-check must degrade silently when absent (tested in U4/U5).
- **Cached estimates:** the property page may serve a cached profile/estimate; verification (U6) must force a fresh estimate before judging.

---

## Sources & Research

- `src/lib/estimation/comparables-estimator.ts`, `estimate-service.ts`, `rental-comparables-estimator.ts` (read in full)
- Live evidence: `/api/estimate` output for 66A Duncan Dr (2026-08-18), Allhomes APP_PROPS (`priceEstimate.medium` 630000, `rentalEstimate` 530/wk, HIGH confidence), OnTheHouse odin guesstimate (655000, range 650–700k, High confidence)
- Prior art: `docs/plans/2026-08-03-001-fix-small-block-estimate-skew-plan.md` (28 Serene Way — same failure family; its fixes were necessary but not sufficient for known-bed subjects)
