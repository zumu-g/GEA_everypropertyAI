---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_depth: lightweight
---

# fix: Distinct ring/legend colors in Market Position chart

Created: 2026-07-14

## Summary

The Market Position radial chart (`src/components/property/QuadrantChart.tsx`) colors each ring and its matching legend dot with a single hue (`#2E5470`) at decreasing opacity per ring index. Adjacent opacity steps look too similar to reliably match a legend dot to its ring, especially for 3+ segments. Replace the opacity ramp with a small fixed palette of visually distinct, on-brand tones so each segment reads unambiguously.

## Problem Frame

`ringTint(index, selected)` (QuadrantChart.tsx:71) returns `rgba(46, 84, 112, opacity)` where opacity steps down by 0.16 per index (floor 0.32). On screen this produces a set of similar mid-blue tones that are hard to visually separate, which the user confirmed via screenshot — legend dot colors don't clearly map to their rings.

## Requirements

- R1: Each segment's ring color and legend dot color must remain in visual sync (already true structurally — both call `ringTint(index, selected)`).
- R2: Adjacent segments must be distinguishable at a glance without relying on position/order.
- R3: Selected-state highlighting (full accent `#2E5470`) must remain visually distinct from the unselected palette.
- R4: No reintroduction of the green/eucalypt tone — previously removed per explicit user request.

## Key Technical Decisions

**KTD1: Fixed 4-tone palette instead of opacity ramp.** Swap the opacity-based `ringTint` for a lookup into a small array of distinct, on-brand hex tones (steel blue family with varying hue/lightness, not just alpha). Rationale: opacity ramps on one hue are a known low-contrast pattern; a discrete palette guarantees separation regardless of segment count (chart supports up to ~4-5 segments in practice). Alternative considered: keep opacity but widen the steps — rejected, still fundamentally low-contrast for readers with any color vision deficiency.

## Implementation Units

### U1. Replace opacity-ramp tint with a distinct-hue palette

**Goal:** Make each ring/legend-dot pairing clearly distinguishable by color.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none

**Files:**
- `src/components/property/QuadrantChart.tsx` (modify `ringTint`, no test file — this is a pure visual/styling change with no behavioral branch to unit test)

**Approach:**
- Define a fixed palette array of 4-5 hex tones drawn from the existing steel-accent family plus complementary neutrals already used in the design system (e.g. deep steel `#16181D`/`#1D3A50`, accent `#2E5470`, mid slate `#5B7A94`, light slate `#94ABBC`) — avoid green (R4).
- `ringTint(index, selected)` returns `#2E5470` when `selected` (unchanged), otherwise `PALETTE[index % PALETTE.length]`.
- No other call sites change — `ringTint` is already used identically for both the SVG ring stroke and the legend dot background, so fixing the function fixes both in sync automatically.

**Test scenarios:**
- Test expectation: none — pure color-token change with no conditional logic beyond the existing `selected` branch, which is already exercised visually.

**Verification:** Load a property page with a Market Position chart showing 3-4 segments; confirm each ring's color is visually distinct from its neighbors and matches its legend dot; confirm the selected segment still highlights in full accent blue.

## Definition of Done

- `ringTint` returns a distinct hex tone per unselected index instead of an opacity-derived rgba string.
- Selected-segment highlighting unchanged (`#2E5470`).
- No green/eucalypt tone reintroduced.
- `tsc --noEmit` passes.
