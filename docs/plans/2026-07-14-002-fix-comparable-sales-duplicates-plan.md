---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_depth: lightweight
---

# fix: Deduplicate Comparable Sales across property_cache and VG sources

Created: 2026-07-14

## Summary

The Comparable Sales section shows the same property twice. `GET /api/comparable-sales` (`src/app/api/comparable-sales/route.ts`) merges candidates from two sources — `property_cache` profiles and Valuer-General records via `getSalesForSuburb()` — into one array with no deduplication, then sorts and slices the top 4. When the same sale exists in both sources it renders as two near-identical cards (differing only in incidental fields like land area). Fix: dedupe by normalized address before the final sort/slice, keeping the richer/higher-scored record.

## Problem Frame

Confirmed from the route code: `comparables.push(...)` runs once per `property_cache` row (lines ~278) and again per VG sale (lines ~314) with no cross-source identity check. "22 Boundary Road, Narre Warren East VIC 3804" exists in both sources → two cards. Duplicates within a single source (e.g. VG re-ingest rows) are also possible and should be covered by the same dedup.

## Requirements

- R1: A given property/sale must appear at most once in the returned `comparables` list.
- R2: When duplicates exist across sources, keep the record with the higher similarity score; on ties, prefer the one with more populated fields (image, beds/baths, non-zero land area).
- R3: Dedup must be tolerant of address-format variance (case, punctuation, `VIC 3804` suffix presence) since cache addresses come from `raw_data` display strings and VG uses `raw_address`.

## Key Technical Decisions

**KTD1: Dedup key = normalized address string.** Lowercase, strip punctuation, collapse whitespace, and drop the trailing state+postcode before comparing. Rationale: there is no shared stable ID across `property_cache` (address_slug) and `property_sales` (raw_address) — the address text is the only common identity. The repo already has address utilities in `src/lib/utils/address.ts` (`toSlug`, `titleCaseSuburb`) — reuse `toSlug` if it produces a suitable normalized key rather than writing a new normalizer.

**KTD2: Dedupe after merging, before sort/slice.** Keeps both scoring paths untouched; the winner-selection rule (R2) runs on the full candidate set so the top-4 slice can backfill with the next-best unique property.

## Implementation Units

### U1. Add cross-source dedup to /api/comparable-sales

**Goal:** Same property never renders twice in Comparable Sales.

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:**
- `src/app/api/comparable-sales/route.ts` (modify)
- `src/app/api/__tests__/comparable-sales-images.test.ts` (extend, or add sibling `comparable-sales-dedup.test.ts` following its patterns)

**Approach:**
- Build a normalized-address key function (prefer reusing `toSlug` from `src/lib/utils/address.ts`).
- After the VG supplement loop, reduce `comparables` into a Map keyed by normalized address; on collision keep per R2 (score first, then field-richness).
- Apply the same dedup in the `findComparablesFromCache` fallback path only if trivially shareable — the cache path iterates unique slugs so it is less exposed, but sharing one dedup helper keeps both paths consistent.

**Patterns to follow:** existing test setup in `src/app/api/__tests__/comparable-sales-images.test.ts` for mocking Supabase/cache in this route.

**Test scenarios:**
- Happy path: cache row and VG row with the same address (different case/punctuation) → one result, the higher-scored one kept.
- Tie-break: equal scores, one record has `imageUrl` + beds/baths, the other doesn't → richer record kept.
- Backfill: 5 unique properties where 2 pairs are duplicates → top 4 returns 4 unique properties, not 2 unique + 2 dupes.
- No-dup case: 4 distinct addresses → all 4 returned unchanged.
- Address variance: `"22 Boundary Road, Narre Warren East VIC 3804"` vs `"22 boundary rd narre warren east"` — decide and test the intended behaviour (at minimum, exact-after-normalization matches must dedupe; abbreviation mapping like Road/Rd is a stretch goal, note if skipped).

**Verification:** Reload the affected property page (130 Hayseys Rd, Narre Warren East) — Comparable Sales shows unique properties only; tests pass; `tsc --noEmit` clean.

## Scope Boundaries

### Deferred to Follow-Up Work
- Upstream dedup at ingest time (preventing the same sale landing in both `property_cache` and `property_sales`) — larger data-pipeline concern, not needed to fix the display bug.
- Street-type abbreviation normalization (Road/Rd, Street/St) if not trivially covered by `toSlug`.

## Definition of Done

- No duplicate cards in Comparable Sales for properties present in both data sources.
- New/extended tests covering the dedup scenarios above pass.
- `tsc --noEmit` passes.
