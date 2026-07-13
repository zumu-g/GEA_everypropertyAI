---
title: "feat: Market Position Quadrant Chart"
date: 2026-07-13
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_depth: standard
---

# feat: Market Position Quadrant Chart

**Target repo:** `propertyiq` (this repo)

## Summary

A self-contained, props-driven React client component rendering market position as a **radial (circular polar) bar chart** — four market segments as bars radiating from a center hub, bar length keyed to price — for use in GEA listing presentations and appraisal packs. Click-to-select "Most similar to yours", inline editing of every figure, print-friendly output, plus a demo page at `/quadrant` with hardcoded Berwick defaults. No data wiring in this pass.

Product Contract preservation: no upstream brainstorm — direct planning from the user's brief (`ce-plan-bootstrap`).

**Revision note (2026-07-13):** The first pass built a 2×2 card-grid layout and it went through a full code review before the user redirected the chart type to a radial bar chart. That grid version is superseded — this revision replaces R1/KTD1/U1's approach with the radial design. Findings from the grid review that are geometry-independent are carried forward into U1 below (event-bubbling fix, shared currency helper, `Badge` reuse, focus-ring token, additional test scenarios) so the rebuild doesn't repeat them.

---

## Problem Frame

Agents in listing presentations need to show a vendor where their property sits relative to four market segments ("this quadrant is most similar to yours — here's what that segment is doing"). Today there is no reusable visual for this. The segment set varies by property type (e.g. a 2-bed unit compares against 1-bed unit / 2-bed unit / 3-bed house / 4-bed house), so the component must be fully segment-agnostic — the parent decides the four segments; future data wiring (everypropertyAI records + published suburb medians) supplies them.

---

## Requirements

- **R1** — Render a radial (polar/circular) bar chart: four segment bars radiate from a center hub around a circle (90° apart), bar length proportional to the segment's price (median by default), each labeled with segment name, icon, and Low / Average / Median prices formatted as AUD (e.g. `$835,000`).
- **R2** — Header shows the target property address prominently, with optional suburb and data date. The target address may also anchor the chart's center hub.
- **R3** — Clicking a segment bar marks it "Most similar to yours" (highlighted stroke/fill, badge, subtle tint); exactly one selected at a time; clicking the selected bar may deselect it.
- **R4** — All prices, the address, and segment names are inline-editable: click to edit, blur (or Enter) to save.
- **R5** — Props-driven: `segments: { name, low, avg, median, icon? }[]`, `targetAddress`, plus optional `suburb` and `dataDate`; sensible hardcoded Berwick defaults when omitted. Local state via `useState`; `onChange` callback fires with the full state (segments, address, selected quadrant) on every change.
- **R6** — Print-friendly: edit affordances and interactive hints hidden in print; colours preserved; exports cleanly to PDF for appraisal packs.
- **R7** — PropertyIQ styling per `DESIGN.md` (steel accent `#2E5470`, restrained, no gradients or heavy shadows); legible on a projector/iPad.
- **R8** — Responsive: the radial chart scales down (viewBox-based SVG, no fixed pixel radius) and remains legible on desktop/tablet; below ~640px the four segments render as a stacked list **in place of** the radial chart (bar visualization loses label legibility below a minimum size — the stacked list is the fallback, not the chart shrinking to unreadable; the chart is not shown at this breakpoint).
- **R9** — "Prepared by Grants Estate Agents" footer with date.
- **R10** — "Copy summary" button placing a plain-text rendering of the four segments on the clipboard; if the clipboard write rejects (permissions, insecure context), show a brief inline "Copy failed" state instead of silently succeeding.
- **R11** — Demo page at `/quadrant` rendering the component with default data; README note documenting the props interface.
- **R12** — Verified working: compiles, runs in the dev server, screenshot captured.

---

## Key Technical Decisions

- **KTD1 — Plain inline SVG, no charting library.** recharts exists in the repo but doesn't natively do polar/radial bar geometry cleanly for a fixed 4-segment case; a hand-rolled SVG (arcs/lines computed from trig) is simpler and fully controllable for a small fixed segment count. Labels/prices render as SVG `<foreignObject>` elements (not absolutely-positioned HTML siblings) so they live in the exact same coordinate space as the bars and scale identically as the SVG's `viewBox` resizes — two independent doc reviewers (design-lens, feasibility) flagged that HTML-overlay-siblings-computed-in-viewBox-units drift out of alignment with the bars at any non-1:1 scale factor, a well-known SVG/HTML coordination failure. `foreignObject` keeps editable fields as real DOM form elements (KTD3 still applies) while staying pinned to the chart's coordinate system.
- **KTD1b — Event-bubbling fix carried from the grid-version review (correctness + adversarial, both P1, independently agreed).** Any element that is both (a) a clickable "select this segment" surface and (b) a container for nested interactive children (edit buttons/inputs) must guard the parent's onClick/onKeyDown with an `e.target !== e.currentTarget` check (or call `stopPropagation()` on every nested interactive child's onClick **and** onKeyDown — not just onClick, which the grid version missed for the input's Enter-to-save keydown). Concretely: clicking or pressing Enter inside an open edit `<input>` must never also toggle the segment's "most similar" selection.
- **KTD2 — Repo path conventions over the brief's literal paths.** Component lives at `src/components/property/QuadrantChart.tsx`, page at `src/app/quadrant/page.tsx` (the repo has no root `components/` or `app/`). Confirmed with user.
- **KTD3 — Reuse the existing inline-edit pattern.** `EditableStat` in `src/components/property/PropertyProfile.tsx` (with tests in `src/components/property/__tests__/EditableStat.test.tsx`) is the established click-to-edit/blur-to-save pattern. Note it is number-only (`<input type="number">`) and coupled to parent-managed editing state, so expect to write an adapted, self-contained editable-field component following its interaction pattern — not a direct drop-in reuse.
- **KTD4 — Segment-agnostic component.** The component renders whatever four segments it receives; it contains no logic for choosing segments by property type. That logic arrives with the Supabase/everypropertyAI wiring pass (deferred).
- **KTD5 — AUD formatting via a shared helper, not another inline copy.** The grid-version review (maintainability, P2) found this would be a third near-duplicate of the same `Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD', maximumFractionDigits:0})` already in `src/components/property/KeyStats.tsx` and `src/lib/estimation/price-estimator.ts`. Extract one `formatCurrency` into `src/lib/format-currency.ts` and import it from all three call sites (the two existing ones plus this new component). During editing, show the raw number; on blur, parse digits and reformat.
- **KTD6 — Icons from `lucide-react`** (already installed), via an optional per-segment `icon` prop with a defined default heuristic on the segment name: contains "unit" or "townhouse" → Building2; otherwise BedDouble/Home for bedroom segments; unrecognised names fall back to Home.
- **KTD7 — Print styles via Tailwind `print:` variants.** Note: the existing `@media print` block in `src/app/globals.css` scopes `print-color-adjust: exact` to table elements only (built for the street report), so it does NOT cover this SVG/div hybrid — the component must apply `print-color-adjust: exact` to its own bars/tiles (Tailwind arbitrary property) or the globals print block gets a small extension. No separate stylesheet file.
- **KTD8 — Client component (`'use client'`)** — it owns interactive state; demo page stays a thin server component wrapper (or client if it wants to consume `onChange`).
- **KTD9 — Reuse `src/components/ui/Badge.tsx` for the selection badge, not a hand-rolled span.** Grid-version review (project-standards, P2): DESIGN.md requires shared primitives be reused rather than re-inlined; `<Badge tone="accent">Most similar to yours</Badge>` matches the intended styling exactly.
- **KTD10 — Focus rings include `ring-offset-2`.** Grid-version review (project-standards, P2): DESIGN.md's focus rule is `ring-2 ring-[#2E5470] ring-offset-2` (see `src/components/ui/Button.tsx`'s BASE class) — every focusable element in this component (bars, edit buttons/inputs, copy button) must match, not just `ring-2`.
- **KTD11 — Each bar carries an accessible name; a faint scale reference.** Radial-plan doc review (design-lens, P1): a bar's `role="button" aria-pressed` alone gives assistive tech no content — add `aria-label` (or `aria-labelledby` referencing its `foreignObject` label) stating the segment name and low/average/median prices, updating as values are edited. Also add one or two faint concentric gridline rings (labeled with rounded price values) so the chart has a scale reference per `DESIGN.md`'s "charts always show axis context" rule, not just relative bar-length comparison.

---

## Implementation Units

### U1. QuadrantChart component (radial bar chart)

**Goal:** The full interactive component, rendered as a radial/polar bar chart.

**Requirements:** R1–R10.

**Dependencies:** none.

**Files:**
- `src/components/property/QuadrantChart.tsx` (component name unchanged for continuity with the demo page/README; visual is now radial, not a grid)
- `src/components/property/__tests__/QuadrantChart.test.tsx`
- `src/lib/format-currency.ts` (new — shared AUD formatter, KTD5)
- `src/lib/estimation/price-estimator.ts`, `src/components/property/KeyStats.tsx` (modify — switch to the shared `formatCurrency` import, removing their inline copies)

**Approach:** Single client component. Props unchanged: `segments?`, `targetAddress?`, `suburb?`, `dataDate?`, `onChange?`. State unchanged: segments array, address, `selectedIndex: number | null`. Layout: header (address, suburb + date) above the chart, footer ("Prepared by Grants Estate Agents" + date + Copy summary button) below. Chart: an SVG (`viewBox`, no fixed pixel size) with 4 bars at 0°/90°/180°/270°, each bar's length scaled to its price value (median by default) against the max across the 4 segments (so the chart is proportionate as prices are edited live), plus 1-2 faint concentric gridline rings labeled with rounded price values for scale reference (KTD11). Bars are real interactive elements — an SVG `<g>` per segment wrapping a `<path>`/`<rect>` bar shape, with `role="button" aria-pressed tabIndex={0}`, an `aria-label` stating the segment name and its low/average/median prices (KTD11), and the KTD1b bubbling guard. Labels/prices render inside an SVG `<foreignObject>` per segment at the same computed angle (KTD1) — this keeps `EditableField` inputs as real DOM form elements while staying in the SVG's coordinate space so they scale with the `viewBox`, not as separate absolutely-positioned HTML siblings. Selection: selected bar gets accent fill/stroke, `accent-soft` tint, and a `<Badge tone="accent">Most similar to yours</Badge>` (KTD9) positioned near that segment's label. Edits follow the `EditableStat`-derived `EditableField` pattern (KTD3); segment names editable the same way. Every state change calls `onChange` with the complete state. Copy summary uses `navigator.clipboard.writeText`. Print: `print:hidden` on the copy button and edit affordances/hints; `print-color-adjust: exact` on bar fills (KTD7). Below `sm` breakpoint, render the same 4 segments as a stacked list **in place of** the radial chart — the chart is not shown at this breakpoint (R8) — reusing the same label/edit sub-components, just laid out in a `flex flex-col` instead of positioned around the SVG.

**Technical design (directional, not implementation-specification):**
```
angle(i) = i * 90deg  // i in 0..3, segments in prop order
barLength(segment) = (segment.median / maxMedianAcrossSegments) * maxRadius
bar endpoint = center + barLength * (cos(angle), sin(angle))
label position = center + (maxRadius + labelOffset) * (cos(angle), sin(angle))
```

**Patterns to follow:** `EditableStat` in `PropertyProfile.tsx` (KTD3); `Badge` in `src/components/ui/Badge.tsx` (KTD9); `Button.tsx`'s focus-ring class (KTD10); tokens from `DESIGN.md` (accent `#2E5470`, rules `#E7E9EE`, no gradients/heavy shadows).

**Test scenarios** (Vitest + Testing Library, per existing `__tests__` convention):
- Renders four segments with names, and low/avg/median formatted as AUD — assert at least 2 distinct formatted values (not just one), covering the grid-review gap where only 1 of 12 currency values was checked.
- Renders target address, footer text, and date.
- Clicking a segment bar selects it (badge appears); clicking another moves the selection — only one badge ever rendered; clicking the selected bar again deselects it.
- `onChange` fires with full state on selection, on price edit, **and on address/segment-name edit** (the grid review found onChange was only asserted for price/selection, not address/name edits — cover all three paths this time).
- Editing a price: click, type `900000`, blur → displays `$900,000` and state updated; non-numeric junk on blur reverts or parses digits only (no `$NaN`).
- Editing the address and a segment name persists on blur; blurring an empty/whitespace-only address **or segment name** reverts to the last valid value (the grid review only tested this for address, not segment name — cover both).
- **Clicking or pressing Enter inside an open edit `<input>` does not toggle the parent segment's selection state** (regression test for KTD1b — this exact composition bug was found independently by two reviewers in the grid version and must not reappear in the radial rebuild).
- Keyboard activation (Enter/Space) on a segment bar toggles selection when the bar itself has focus.
- Each segment bar has an accessible name (via `aria-label`/`aria-labelledby`) that includes the segment name and its current prices — not just its pressed state.
- Copy summary writes plain text containing all four segment names and prices to a mocked clipboard.
- Copy summary shows an inline "Copy failed" state when the clipboard write rejects (mock rejection).
- Defaults render when no props are passed.
- Below the `sm` breakpoint the four segments render as a stacked list (assert the fallback layout's segments are present; jsdom has no real layout engine, so assert via a data attribute or class toggle rather than measured geometry).

**Verification:** Tests pass. (Demo-page rendering is verified in U2/U3, which depend on this unit.)

### U2. Demo page + README note

**Goal:** A viewable demo and props documentation.

**Requirements:** R11.

**Dependencies:** U1.

**Files:**
- `src/app/quadrant/page.tsx` (exists — no change needed this pass)
- `src/middleware.ts` (already has `/quadrant` in `config.matcher` from the prior grid-version build — no change needed this pass)
- `README.md` (modify — update the "QuadrantChart" section's props interface note for the radial redesign, if it changed)

**Approach:** The demo page and the auth matcher entry already landed in the prior grid-version build and don't need rework — `/quadrant` sits behind the existing Supabase session + allow-list gate like the rest of the app. This unit is now just the README update.

**Test scenarios:** Test expectation: none — thin page wrapper, one-line matcher addition, and docs; behaviour is covered by U1's component tests.

**Verification:** Page loads at `http://localhost:3002/quadrant` after sign-in, with no console errors; unauthenticated requests are redirected to sign-in.

### U3. Runtime verification and screenshot

**Goal:** Prove it works end-to-end, per the brief's explicit ask.

**Requirements:** R12, R6, R8.

**Dependencies:** U2.

**Files:** none (verification only).

**Approach:** Run `npm run build` (compile check) and `npm run dev`; open `/quadrant`; exercise selection, editing, and copy summary; capture a screenshot of the rendered chart and hand it to the user. Check the print view (browser print preview or `page.emulateMedia({ media: 'print' })` if driving via a headless browser) confirms edit affordances are hidden. Check mobile stacking at <640px viewport.

**Execution note:** Smoke/runtime verification is the primary proof here, alongside U1's unit tests.

**Test scenarios:** Test expectation: none — manual/automated smoke pass, no new test files.

**Verification:** Build succeeds, page renders, screenshot delivered, print preview clean, mobile stacks to one column.

---

## Scope Boundaries

### In scope
Everything in Requirements, including both nice-to-haves (copy summary, editable segment names).

### Deferred to Follow-Up Work
- Embedding the chart as a section of the property page (`src/app/property/...`) — the brief's "added as a section" lands there.
- Supabase / everypropertyAI wiring: deriving the four segments from the target property's type and comparable-sales + published suburb median data.
- Persisting edited state anywhere (the `onChange` callback is the seam for this).

### Out of scope
- Charting libraries, data fetching, auth changes.

---

## Open Questions / Assumptions

- **Open (for the follow-up wiring pass, not this one):** when the property-page embedding lands, should `onChange` state persist via the existing property PATCH endpoint used by `EditableStat`'s parent, or a new mechanism?
- **Assumption:** deselecting by re-clicking the selected quadrant is allowed (harmless; presenter may want a neutral state). Trivial to remove if unwanted.
- **Assumption:** default Berwick figures are illustrative placeholders (e.g. units ~$600k, 3-bed ~$700k, 4-bed ~$835k, 5+ bed ~$1.05M low/avg/median spreads) — real figures arrive with data wiring.
- **Carried from grid-version security review (residual risk, not blocking):** the `/quadrant` middleware matcher entry is an exact-string match with no nested routes today; if the deferred property-page embedding later adds routes under `/quadrant/[param]`, the matcher must become `/quadrant/:path*` or those sub-routes are unintentionally public.
- **Re-review required.** U1 must go through `ce-code-review` again after the radial rebuild — the prior review's findings (event bubbling, currency helper, Badge reuse, focus ring, test gaps) are folded into this plan as guidance, but the rebuilt implementation still needs independent verification, not just self-attestation that the guidance was followed.

## Definition of Done

All requirements R1–R12 met; U1 test scenarios pass under `npm run test`; `npm run build` clean; screenshot of the running demo page delivered to the user.
