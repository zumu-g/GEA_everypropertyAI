---
title: "fix: Robust suburb growth rate for comp time-adjustment"
type: fix
date: 2026-08-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: Robust suburb growth rate for comp time-adjustment

## Summary

The Pakenham market overview shows +7.95% annual growth. Investigation (2026-08-18) traced it to `src/lib/enrichment/market-data.ts:145` — the latest point of CoreLogic's `median-growth` monthly series via yourinvestmentpropertymag.com.au, verified arithmetically correct ($667k → $720k May-to-May). The number is faithful but composition-sensitive: it is a raw sales-median change, not a quality-adjusted index, and in a new-estate growth corridor it likely overstates like-for-like appreciation. All three estimators compound comps at this full rate, biasing estimates upward. This plan dampens and caps the growth rate applied to time-adjustment, caps total per-comp adjustment, and adds a transparency caveat to the Market Overview UI. The displayed suburb growth figure itself is unchanged.

Related: `docs/plans/2026-08-18-001-fix-estimate-comp-skew-plan.md` recalibrates comp weights for the same property. Independent changes; both reduce the same upward skew. Land this after (or rebased on) that plan to avoid merge conflicts in the same estimator files.

---

## Problem Frame

- `comparables-estimator.ts:296-306`, `price-estimator.ts:75-76`, and `rental-comparables-estimator.ts:155-161` (price-growth proxy path) all convert `segment.annualGrowth` straight into `monthlyGrowth = annualGrowth / 12 / 100` and compound every comp by months-since-sale.
- A 12-month-old comp is uplifted ~8%; the only bound is a far-too-loose [0.33x, 3.0x] clamp on the compounded factor (`GROWTH_CLAMP_LO/HI` in `comparables-estimator.ts`, mirrored inline in `price-estimator.ts`), which the new ±15% cap supersedes.
- Composition shift in the sales median (larger/newer stock selling) inflates the rate beyond real like-for-like growth; standard AVM practice is to discount stated suburb growth when time-adjusting.

## Requirements

- **R1** — Time-adjustment must use a guarded rate: `applied = clamp(annualGrowth, ±12) × 0.7` (dampening factor), applied consistently across the price comparables estimator, the price estimator, and the rental estimator's price-growth-proxy path. (session-settled: user-directed — chosen over cap-only and series-smoothing: composition-inflated medians warrant conservatism, not just outlier protection.)
- **R2** — Total per-comp time adjustment must be capped at ±15% regardless of comp age. The cap applies to comparable sales/rentals only; the subject's own prior-sale/prior-rent cross-check paths (legitimately multi-year) use the guarded rate with no total cap. (session-settled: user-directed — chosen over cap-everything and age-scaled cap.)
- **R3** — Methodology strings must report the applied (dampened) rate, not the raw suburb rate, so the text matches the arithmetic.
- **R4** — The Market Overview "Annual Growth" rows (houses and units) must carry a small caveat that the figure is the 12-month change in the sales median (composition-sensitive), CoreLogic-sourced. (session-settled: user-directed — chosen over estimator-only change.)
- **R5** — The displayed Annual Growth value and `market-data.ts` parsing are unchanged.

## Key Technical Decisions

- **KTD1** — One shared guard helper (e.g. in `comparables-estimator.ts`, exported, or a small `growth-guard.ts` in `src/lib/estimation/`) rather than three inline copies; constants `GROWTH_DAMPENING = 0.7`, `MAX_ANNUAL_GROWTH_PCT = 12`, `MAX_TOTAL_ADJUST = 0.15` live beside it. (session-settled: user-directed via R1.)
- **KTD2** — Add an optional cap to `timeAdjust` (`comparables-estimator.ts:159`): comp-adjustment call sites clamp the compounded factor to `[1 − 0.15, 1 + 0.15]`; prior-sale/prior-rent cross-check call sites pass no cap (multi-year adjustments are legitimate there). The existing `GROWTH_CLAMP_LO/HI` [0.33x, 3.0x] bounds are superseded and removed. `price-estimator.ts`'s sale-history path (~line 131) inlines its own compounding with its own 0.33x/3.0x clamp — refactor it to call the shared `timeAdjust` (uncapped variant: it adjusts the subject's own prior sale, not comps) so the rate guard reaches it.
- **KTD3** — Rent time-adjustment: the rental estimator's *own* `annualRentGrowth` (2.7%, computed from the rent series) passes through the same clamp but the dampening applies only to the price-growth **proxy** path — rent-series growth is not composition-inflated the same way (rents are per-dwelling asking figures).

---

## Implementation Units

### U1. Growth guard in the estimators

**Goal:** Dampen + cap the growth rate and cap total per-comp adjustment.
**Requirements:** R1, R2, R3, R5 (KTD1–KTD3).
**Files:** `src/lib/estimation/comparables-estimator.ts`, `src/lib/estimation/price-estimator.ts`, `src/lib/estimation/rental-comparables-estimator.ts`, `src/lib/estimation/__tests__/comparables-estimator.test.ts`, `src/lib/estimation/__tests__/rental-comparables-estimator.test.ts`
**Approach:**
1. Add guard helper + constants (KTD1).
2. Replace raw `annualGrowth` with guarded rate at the three consumption sites; rental proxy path dampens, rent-series path clamps only (KTD3).
3. Clamp the compounded factor in `timeAdjust` (KTD2).
4. Update methodology strings to print the applied rate (R3), e.g. "time-adjusted using 5.6% p.a. (dampened from 8.0% suburb growth)".
**Test scenarios:**
- 8% suburb growth → applied rate 5.6%; a 12-month-old comp uplifts ~5.7%, not ~8.3%.
- 20% suburb growth → clamped to 12% then dampened to 8.4%.
- 36-month-old comp at 8% growth → total uplift capped at +15% (uncapped would be ~+18%).
- Negative growth (−20%) → clamped to −12%, dampened to −8.4%; total downlift capped at −15%.
- Rental estimator with `annualRentGrowth` 2.7% present → 2.7% applied undampened; with only `priceAnnualGrowth` 8% → 5.6% applied and methodology notes the proxy.
- Methodology string contains the applied rate and the raw suburb rate.
**Verification:** Existing estimation test suites pass; 66A Duncan Dr estimate moves down (direction check via fixture from plan 001 if landed).

### U2. Market Overview caveat

**Goal:** Transparency caveat on the Annual Growth rows.
**Requirements:** R4, R5.
**Files:** `src/components/property/PropertyProfile.tsx`
**Approach:** Add a small tooltip/footnote to the houses and units Annual Growth `DataRow`s (`PropertyProfile.tsx:1318-1350`): "12-month change in the sales median (CoreLogic). Sensitive to the mix of stock sold — not a like-for-like index." Follow the existing pattern for secondary/explanatory text in this component; match DESIGN.md styling.
**Test scenarios:** Test expectation: none — presentational footnote; covered by existing PropertyProfile render tests not breaking.
**Verification:** Row renders with caveat in the profile view for a suburb with growth data; absent when growth is null.

---

## Scope Boundaries

**Out of scope:** changing the displayed growth number, the YIPM/CoreLogic parsing, or the growth source.
### Deferred to Follow-Up Work
- Blending a repeat-sales/hedonic growth check (needs sold-history data — see sold-history backfill, PR #36).
- Applying the same guard to any future buyer-demand or trend features consuming `annualGrowth`.

## Definition of Done

- All R1–R5 satisfied; U1 test scenarios pass; existing estimation suites green (`npx vitest run src/lib/estimation`).
- Methodology text matches applied arithmetic on a live `/api/estimate` response.

**Product Contract preservation:** n/a — bootstrap plan, no upstream contract.
