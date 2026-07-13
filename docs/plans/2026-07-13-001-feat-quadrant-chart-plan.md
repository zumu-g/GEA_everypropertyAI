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

A self-contained, props-driven React client component rendering a 2×2 quadrant chart of four market segments (name, icon, low/average/median AUD prices) around a target property address, for use in GEA listing presentations and appraisal packs. Click-to-select "Most similar to yours", inline editing of every figure, print-friendly output, plus a demo page at `/quadrant` with hardcoded Berwick defaults. No data wiring in this pass.

Product Contract preservation: no upstream brainstorm — direct planning from the user's brief (`ce-plan-bootstrap`).

---

## Problem Frame

Agents in listing presentations need to show a vendor where their property sits relative to four market segments ("this quadrant is most similar to yours — here's what that segment is doing"). Today there is no reusable visual for this. The segment set varies by property type (e.g. a 2-bed unit compares against 1-bed unit / 2-bed unit / 3-bed house / 4-bed house), so the component must be fully segment-agnostic — the parent decides the four segments; future data wiring (everypropertyAI records + published suburb medians) supplies them.

---

## Requirements

- **R1** — Render a 2×2 quadrant grid; each quadrant shows segment name, icon, and Low / Average / Median prices formatted as AUD (e.g. `$835,000`).
- **R2** — Header shows the target property address prominently, with optional suburb and data date.
- **R3** — Clicking a quadrant marks it "Most similar to yours" (highlighted border, badge, subtle tint); exactly one selected at a time; clicking the selected quadrant may deselect it.
- **R4** — All prices, the address, and segment names are inline-editable: click to edit, blur (or Enter) to save.
- **R5** — Props-driven: `segments: { name, low, avg, median, icon? }[]`, `targetAddress`, plus optional `suburb` and `dataDate`; sensible hardcoded Berwick defaults when omitted. Local state via `useState`; `onChange` callback fires with the full state (segments, address, selected quadrant) on every change.
- **R6** — Print-friendly: edit affordances and interactive hints hidden in print; colours preserved; exports cleanly to PDF for appraisal packs.
- **R7** — PropertyIQ styling per `DESIGN.md` (steel accent `#2E5470`, restrained, no gradients or heavy shadows); legible on a projector/iPad.
- **R8** — Responsive: quadrants stack single-column below ~640px (Tailwind `sm` breakpoint).
- **R9** — "Prepared by Grants Estate Agents" footer with date.
- **R10** — "Copy summary" button placing a plain-text rendering of the four segments on the clipboard; if the clipboard write rejects (permissions, insecure context), show a brief inline "Copy failed" state instead of silently succeeding.
- **R11** — Demo page at `/quadrant` rendering the component with default data; README note documenting the props interface.
- **R12** — Verified working: compiles, runs in the dev server, screenshot captured.

---

## Key Technical Decisions

- **KTD1 — Plain divs + CSS grid, no charting library.** Per the brief; recharts exists in the repo but is unnecessary for a 2×2 layout.
- **KTD2 — Repo path conventions over the brief's literal paths.** Component lives at `src/components/property/QuadrantChart.tsx`, page at `src/app/quadrant/page.tsx` (the repo has no root `components/` or `app/`). Confirmed with user.
- **KTD3 — Reuse the existing inline-edit pattern.** `EditableStat` in `src/components/property/PropertyProfile.tsx` (with tests in `src/components/property/__tests__/EditableStat.test.tsx`) is the established click-to-edit/blur-to-save pattern. Note it is number-only (`<input type="number">`) and coupled to parent-managed editing state, so expect to write an adapted, self-contained editable-field component following its interaction pattern — not a direct drop-in reuse.
- **KTD4 — Segment-agnostic component.** The component renders whatever four segments it receives; it contains no logic for choosing segments by property type. That logic arrives with the Supabase/everypropertyAI wiring pass (deferred).
- **KTD5 — AUD formatting via `Intl.NumberFormat('en-AU', ...)`,** matching existing usage in `src/components/property/KeyStats.tsx` / `src/lib/estimation/price-estimator.ts`. During editing, show the raw number; on blur, parse digits and reformat.
- **KTD6 — Icons from `lucide-react`** (already installed), via an optional per-segment `icon` prop with a defined default heuristic on the segment name: contains "unit" or "townhouse" → Building2; otherwise BedDouble/Home for bedroom segments; unrecognised names fall back to Home.
- **KTD7 — Print styles via Tailwind `print:` variants.** Note: the existing `@media print` block in `src/app/globals.css` scopes `print-color-adjust: exact` to table elements only (built for the street report), so it does NOT cover this div-based grid — the component must apply `print-color-adjust: exact` to its own tiles (Tailwind arbitrary property) or the globals print block gets a small extension. No separate stylesheet file.
- **KTD8 — Client component (`'use client'`)** — it owns interactive state; demo page stays a thin server component wrapper (or client if it wants to consume `onChange`).

---

## Implementation Units

### U1. QuadrantChart component

**Goal:** The full interactive component.

**Requirements:** R1–R10.

**Dependencies:** none.

**Files:**
- `src/components/property/QuadrantChart.tsx` (new)
- `src/components/property/__tests__/QuadrantChart.test.tsx` (new)

**Approach:** Single client component. Props: `segments?` (default Berwick house set: Units/townhouses, 3-bed, 4-bed, 5+-bed with plausible Berwick figures), `targetAddress?` (default a Berwick address), `suburb?`, `dataDate?`, `onChange?`. State: segments array, address, `selectedIndex: number | null`. Layout: header (address, suburb + date), 2×2 grid (`grid-cols-1 sm:grid-cols-2`), footer with "Prepared by Grants Estate Agents" + date + Copy summary button. Selection: quadrant tiles are `<button aria-pressed>` elements (native keyboard/focus semantics — do not use role-annotated divs); selected tile gets accent border, `accent-soft` tint, and a "Most similar to yours" badge (reuse `src/components/ui/Badge.tsx` styling language). Edits follow the `EditableStat` pattern (KTD3); segment names editable the same way. Every state change calls `onChange` with the complete state. Copy summary uses `navigator.clipboard.writeText` with the four segments in plain text. Print: `print:hidden` on the copy button and edit affordances/hints; keep tint/border legible in print.

**Patterns to follow:** `EditableStat` in `PropertyProfile.tsx`; card/heading idiom from `src/components/ui/Card.tsx` and `SectionHeading.tsx`; tokens from `DESIGN.md` (accent `#2E5470`, rules `#E7E9EE`, no gradients/heavy shadows).

**Test scenarios** (Vitest + Testing Library, per existing `__tests__` convention):
- Renders four quadrants with names, and low/avg/median formatted as AUD (`$835,000` for 835000).
- Renders target address, footer text, and date.
- Clicking a quadrant selects it (badge appears); clicking another moves the selection — only one badge ever rendered.
- `onChange` fires with full state on selection and on edit.
- Editing a price: click, type `900000`, blur → displays `$900,000` and state updated; non-numeric junk on blur reverts or parses digits only (no `$NaN`).
- Editing the address and a segment name persists on blur; blurring an empty/whitespace-only address or segment name reverts to the last valid value rather than saving an empty string.
- Copy summary writes plain text containing all four segment names and prices to a mocked clipboard.
- Copy summary shows an inline "Copy failed" state when the clipboard write rejects (mock rejection).
- Defaults render when no props are passed.

**Verification:** Tests pass. (Demo-page rendering is verified in U2/U3, which depend on this unit.)

### U2. Demo page + README note

**Goal:** A viewable demo and props documentation.

**Requirements:** R11.

**Dependencies:** U1.

**Files:**
- `src/app/quadrant/page.tsx` (new)
- `src/middleware.ts` (modify — add `/quadrant` to the matcher allow-list)
- `README.md` (modify — short "QuadrantChart" section documenting the props interface)

**Approach:** Thin page rendering `<QuadrantChart />` with default data on the standard page background. **Auth:** the middleware matcher in `src/middleware.ts` is an explicit allow-list — new pages are NOT gated by default — so add `'/quadrant'` to the `config.matcher` array so the page sits behind the existing Supabase session + allow-list gate like the rest of the app. README gets a brief props table/snippet.

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

## Definition of Done

All requirements R1–R12 met; U1 test scenarios pass under `npm run test`; `npm run build` clean; screenshot of the running demo page delivered to the user.
