---
title: "fix: /api/property attaches a neighbour's listing attributes (wrong-property match)"
status: completed
date: 2026-06-10
type: fix
---

# fix: /api/property attaches a neighbour's listing attributes (wrong-property match)

## Summary

`POST /api/property` returns **wrong attributes** for an address: "120 Moondarra Drive, Berwick VIC 3806"
(a 4-bed house) comes back as `bedrooms: 2, landArea: 263 m²` with realestate.com.au townhouse photos +
townhouse features. The address **resolves** correctly (right street/suburb/coords); the *attached
property data* is from a **nearby 2-bed townhouse**. Root cause is a chain in the scrape→extract→merge
pipeline that lets a neighbouring REA listing blend in, then caches it for 24h.

This plan fixes it **defensively, server-side, for every caller** — no cross-repo dependency and no
reliance on REA's suggest id (see Scope). It (1) selects only the target-matching Apify listing before
extraction, (2) hard-drops any extraction whose address mismatches the target before merge, and (3) adds
cache invalidation (`deleteCachedProfile` + `?refresh=1`) to clear the bad record and force re-crawl.

---

## Problem Frame

Confirmed by reading the pipeline (all five leads verified):

1. **Guessed REA URL.** `src/lib/firecrawl/sources/realestate.ts` `buildPropertyUrl` string-templates a
   slug from `{streetNumber-streetName-streetType-suburb-state-postcode}` — **not** REA's canonical
   property id. REA serves a street / nearest-match page for a slug it doesn't recognise.
2. **Multi-listing blend.** `src/lib/apify/client.ts` runs the actor with `maxItems: 5`;
   `src/lib/apify/format.ts` `actorItemsToMarkdown(items)` concatenates **all** returned items with
   `---` separators and **no address filter** → a neighbour's beds/landArea/photos land in the markdown.
3. **Advisory address check.** `src/lib/extraction/extractor.ts` `addressMatchesTarget` only
   `console.warn`s on mismatch (line ~235) and **still returns the extraction**; the check is weak
   (first number + first street-name word; if the extracted record has no `streetNumber` it passes —
   "benefit of the doubt").
4. **No gate in merge.** `src/lib/extraction/merger.ts` `mergePropertyData` has no target address and
   merges every extraction's fields.
5. **Cached 24h.** `src/lib/jobs/fetch-profile.ts` caches the merged profile (in-memory `propertyCache`
   + Supabase `property_cache`, slug `120-moondarra-drive-berwick-vic-3806`); `src/app/api/property/route.ts`
   serves it for 24h. **There is no cache-bust** (`deleteCachedProfile` doesn't exist; no `refresh` param).

The enforcement point that covers **both** extraction paths (the LLM `extractPropertyData` *and* the
Firecrawl-native `scrapeAndExtract`) is in `fetch-profile.ts` after extraction, before `mergePropertyData`
— that's where `fullAddress` is already known.

**Helpful interaction with plan 004:** when the REA source yields nothing usable (because we now suppress
a non-matching listing), the existing feed-seed layer fills the profile from our own
`property_sales`/`property_listings` row for the slug — i.e. the system degrades to our *correct* feed
data instead of a neighbour's listing.

---

## Requirements

- **R1** — For an address, `/api/property` never attaches attributes scraped from a **different**
  property. A scraped listing only contributes fields when its address matches the target (street number
  + street name + suburb).
- **R2** — When the Apify actor returns multiple listings, only the **target-matching** item is used for
  extraction; non-matching items are excluded (not concatenated/blended).
- **R3** — Any extraction whose address **clearly mismatches** the target is **dropped** before merge
  (hard gate), covering both the LLM and Firecrawl-native extraction paths.
- **R4** — When no scraped source matches the target, the profile falls back to feed-seed / address-only
  (plan 004) rather than emitting wrong data — no fabricated or neighbour attributes.
- **R5** — A cached profile can be invalidated and re-crawled: add `deleteCachedProfile(slug)` and a
  `refresh` path on `/api/property` that bypasses the cache, re-runs the pipeline, and overwrites. The
  existing bad `120-moondarra-drive-berwick-vic-3806` record is cleared.
- **R6** — No change to the `/api/property` response shape, auth, or the `fast:true` background contract.

---

## Key Technical Decisions

- **Filter Apify items at the source (highest leverage) — R2.** Selecting the single best-matching item
  in `actorItemsToMarkdown` before the markdown is built prevents the blend from ever reaching the LLM.
  When no item matches the target, return empty (the source yields nothing) so feed-seed/address-only
  takes over (R4) — better a correct gap than a confident wrong answer.
- **Hard-enforce the address match before merge (defence in depth) — R1, R3.** Move the strengthened
  match into a shared, tested helper and apply it as a *drop* gate over all extractions in
  `fetch-profile.ts`. This catches any extraction (LLM *or* Firecrawl-native) that self-identifies a
  mismatching address, even if item-selection let something through. Advisory→enforcing.
- **Drop only on a *confident* mismatch; abstain when the address is unparseable — R1, R4.** Drop when
  the extraction carries a `streetNumber`/`streetName` that contradicts the target. When the extraction
  has no usable address, the item-selection gate (R2) is the primary defence; don't blanket-drop
  address-less extractions (that would also discard correct data the LLM merely failed to re-state).
- **Add real cache invalidation — R5.** There is none today. `deleteCachedProfile(slug)` (Supabase
  `property_cache` delete) + `propertyCache.delete(slug)` (in-memory) + a `refresh` flag on `/api/property`
  that skips the cache read and overwrites. Also document the manual SQL to clear a row when Supabase
  access is direct (the operator may not have the app running).
- **Defensive-only scope (no canonical-id carry).** Threading REA's suggest id end-to-end (fix direction
  #1) is deferred: `StructuredAddress` has no id field, the CRM (separate repo) would have to send it, and
  REA's *suggest* id is not verified to map to a property-page URL. The defensive trio fixes the bug for
  all callers without that dependency.

---

## High-Level Technical Design

```
POST /api/property (or ?refresh=1)
        │  refresh? → skip cache read + deleteCachedProfile(slug)
        ▼
 fetchAndCacheProfile → crawlProperty (Apify actor, up to 5 items)
        │
        ├─ U2: actorItemsToMarkdown(items, TARGET)
        │       └─ select only the item whose address matches TARGET
        │          (street# + name + suburb); none match → "" (source yields nothing)
        ▼
 extract (LLM and/or Firecrawl-native)  →  [extractions]
        │
        ├─ U1: drop any extraction whose address CONFIDENTLY mismatches TARGET
        │       (shared addressMatchesTarget; abstain when address unparseable)
        ▼
 mergePropertyData(matching extractions)
        │   (empty? → plan-004 feed-seed fills from property_sales — correct data)
        ▼
 cache + return   ── U3: deleteCachedProfile / refresh can invalidate + overwrite
```

```
Apify items for the guessed URL    target-match?   → result
  [120 (4bd house), 118 (2bd th)]   118 dropped     → only 120 extracted ✅
  [118 (2bd th) only]               no match        → "" → feed-seed fills 120 from our DB ✅
  [120 (4bd house)]                 match           → 120 extracted ✅
```

---

## Implementation Units

### U1. Shared strict address matcher + hard drop-gate before merge

**Goal:** Replace the advisory address check with a shared, strict matcher and enforce it as a drop-gate
over all extractions before merge, so a confidently-mismatching listing can never contribute fields.

**Requirements:** R1, R3, R4

**Dependencies:** none

**Files:**
- `src/lib/extraction/address-match.ts` (new) — `extractionMatchesTarget(extraction, target): 'match' | 'mismatch' | 'abstain'` (street number must equal; street-name token must be contained; suburb must match when present; `abstain` when the extraction has no usable address). Pure.
- `src/lib/extraction/__tests__/address-match.test.ts` (new)
- `src/lib/jobs/fetch-profile.ts` (modify) — after building `extractions`, drop those returning `mismatch` before `mergePropertyData`; log how many were dropped.
- `src/lib/extraction/extractor.ts` (modify) — replace the inline `addressMatchesTarget` with the shared helper; on `mismatch`, drop the extraction (return the empty/flagged result) instead of warn-only.

**Approach:** The matcher compares the extraction's `address` (displayAddress / streetNumber / streetName / suburb) against the target string parsed to street#, street-name token, suburb. `mismatch` requires a *contradiction* (present-but-different street number, or different street-name token); `abstain` when no street number/name is present (item-selection in U2 is the primary defence there). The drop-gate in `fetch-profile.ts` is the single enforcement point covering both the LLM (`extractPropertyData`) and Firecrawl-native (`scrapeAndExtract`) results.

**Execution note:** Start with a failing test for `extractionMatchesTarget` against a 120-vs-118 Moondarra Drive pair, then make `fetch-profile` drop the mismatch.

**Patterns to follow:** the existing `addressMatchesTarget` in `src/lib/extraction/extractor.ts` (logic to strengthen + relocate); `parseAddress`/`formatAddress` in `src/lib/utils/address.ts`.

**Test scenarios:**
- Match: extraction `{streetNumber:'120', streetName:'Moondarra'}` vs target "120 Moondarra Drive, Berwick" → `match`.
- Mismatch (street number): `{streetNumber:'118', streetName:'Moondarra'}` vs target 120 → `mismatch`.
- Mismatch (street name): `{streetNumber:'120', streetName:'Loders'}` vs target 120 Moondarra → `mismatch`.
- Abstain: extraction with no `streetNumber`/`streetName` → `abstain` (not dropped).
- Suburb mismatch when both present → `mismatch`.
- Integration: `fetch-profile` given two extractions (one 120-match, one 118-mismatch) merges only the 120 fields; the 118 beds/land never appear.
- Integration: all extractions mismatch → merge is empty → profile falls back (no neighbour data) (R4).

**Verification:** A profile built from a blend of 120 + 118 Moondarra extractions contains only 120's attributes; an all-mismatch crawl yields no scraped attributes (feed-seed/address-only takes over).

---

### U2. Select the target-matching Apify listing before markdown

**Goal:** When the actor returns multiple listings, format only the item whose address matches the target
so neighbouring listings never enter the extraction markdown.

**Requirements:** R2, R4

**Dependencies:** U1 (reuses the address matcher)

**Files:**
- `src/lib/apify/format.ts` (modify) — `actorItemsToMarkdown(items, target?)`: when `target` given, pick the single best-matching item (street number + street name + suburb) via the U1 matcher; if none matches, return `''`. Unchanged behaviour when `target` is omitted.
- `src/lib/apify/client.ts` (modify) — pass the target address (already available where `buildPropertyUrl(address)` is called) into `actorItemsToMarkdown`.
- `src/lib/apify/__tests__/format.test.ts` (new or extend)

**Approach:** Reuse `extractionMatchesTarget` (or a thin item-shaped adapter) to score each actor item's address against the target; format only the best `match`. No match → empty markdown so the source contributes nothing (R4) and feed-seed fills in. Keep `maxItems: 5` (so the right item can be found among several), but only the matching one is emitted.

**Patterns to follow:** existing `actorItemsToMarkdown` formatting in `src/lib/apify/format.ts`; the address fields actor items expose (inspect a sample item's address keys during implementation).

**Test scenarios:**
- Two items (120 house, 118 townhouse), target 120 → markdown contains only the 120 item's fields.
- Single non-matching item (118), target 120 → returns `''` (no blend).
- Single matching item (120), target 120 → formats it.
- No target passed → formats all items (back-compat).
- Item with missing/garbled address among good ones → still selects the clear match, not the garbled one.

**Verification:** For a guessed-URL crawl that returns a neighbour listing, `actorItemsToMarkdown` emits nothing (or only the exact match), so the wrong attributes never reach extraction.

---

### U3. Cache invalidation: `deleteCachedProfile` + `?refresh=1`

**Goal:** Provide a way to invalidate and re-crawl a cached profile, and clear the existing bad
120 Moondarra record.

**Requirements:** R5, R6

**Dependencies:** none (independent of U1/U2; ordering free)

**Files:**
- `src/lib/db/queries.ts` (modify) — add `deleteCachedProfile(slug)` (delete the `property_cache` row; fail-soft).
- `src/lib/cache.ts` (modify) — ensure `propertyCache.delete(slug)` exists (add if missing).
- `src/app/api/property/route.ts` (modify) — accept `refresh` (query `?refresh=1` or body `{refresh:true}`): skip the cache read, call `deleteCachedProfile(slug)` + `propertyCache.delete(slug)`, run the pipeline, overwrite. Response shape unchanged (R6).
- `src/app/api/property/__tests__/refresh.test.ts` (new) — or extend an existing route test.

**Approach:** Mirror the existing `getCachedProfile`/`saveCachedProfile` pattern in `queries.ts`. The `refresh` flag short-circuits the two cache-read branches in the route and deletes before re-running. Document the manual fallback in the PR/INTEGRATIONS: `DELETE FROM property_cache WHERE address_slug = '120-moondarra-drive-berwick-vic-3806';` (when operating Supabase directly without the app). In-memory cache clears on the next deploy regardless.

**Test scenarios:**
- `?refresh=1` bypasses a present cache entry, re-runs the pipeline, and the returned profile is the fresh one (cache read not served).
- `refresh` deletes the Supabase row (`deleteCachedProfile` called with the slug) and the in-memory entry.
- `deleteCachedProfile` is fail-soft when Supabase is unconfigured/errors (no throw).
- Normal (no `refresh`) request still serves cache (no regression to the 24h path).

**Verification:** `POST /api/property {address: "120 Moondarra Drive…", refresh:true}` returns a freshly-crawled profile and removes the stale row; a subsequent normal request serves the corrected cached profile.

---

## Scope Boundaries

**In scope:** Apify item selection by target address; a shared strict address matcher enforced as a
drop-gate before merge (both extraction paths); cache invalidation (`deleteCachedProfile` + `refresh`);
clearing the existing 120 Moondarra record; reproducing + verifying the fix.

**Out of scope (true non-goals):**
- Changing `/api/property` response shape, auth, or the `fast:true` contract.
- The AVM/estimation work and the feed-seed mechanism itself (plan 004) — relied upon, not changed.

### Deferred to Follow-Up Work
- **Canonical REA id carry (fix direction #1):** thread an optional REA property id through
  `StructuredAddress` → `/api/property` → `buildPropertyUrl` so the scraper hits the exact page. Deferred
  pending (a) adding an id field, (b) the CRM/UI sending it, and (c) **verifying REA's suggest `id`
  actually maps to a property-page URL** (unconfirmed — if it doesn't, #1 yields nothing). The defensive
  fixes here make this a precision enhancement, not a prerequisite.
- **Stronger fuzzy address matching** (unit/lot handling, multi-word street names with abbreviations) if
  the strict matcher proves too aggressive in practice — tune from real dropped-extraction logs.

---

## Risks & Dependencies

- **Matcher too strict → drops correct data.** Mitigated by the `abstain` tier (don't drop address-less
  extractions) and by logging drop counts so over-aggression is visible; tune from logs (deferred item).
- **Actor item address shape unknown.** The actor item's address field names must be confirmed during U2
  (inspect a real item). Implementation-time detail — don't assume a key; read a sample.
- **Firecrawl-native path bypasses the LLM matcher.** Mitigated by enforcing the drop-gate in
  `fetch-profile.ts` over *all* extractions (U1), not only inside the LLM extractor.
- **Cache: in-memory vs Supabase.** `refresh` clears both; but a multi-instance deployment only clears the
  instance that served the request's in-memory cache. The Supabase delete is authoritative; in-memory
  entries expire on TTL/deploy. Acceptable for this fix; note it.
- **Reproduction triggers a live Apify crawl** (~cost/latency). Reproduce once via `?refresh=1`; rely on
  feed-seed for the corrected baseline.

---

## Sources & Research

Codebase grounding (root cause fully traced locally; no external research):
- `src/lib/firecrawl/sources/realestate.ts` — `buildPropertyUrl` guessed slug.
- `src/lib/apify/client.ts` (`maxItems: 5`, calls `actorItemsToMarkdown(items)`), `src/lib/apify/format.ts`
  (`actorItemsToMarkdown` concatenates all items).
- `src/lib/extraction/extractor.ts` — `addressMatchesTarget` advisory (warn-only) + weak; `src/lib/extraction/merger.ts` — no address gate.
- `src/lib/jobs/fetch-profile.ts` — both extraction paths + the pre-merge enforcement point; caching.
- `src/app/api/property/route.ts`, `src/lib/db/queries.ts` (`getCachedProfile`/`saveCachedProfile`, no delete),
  `src/lib/cache.ts` — 24h cache, no invalidation today.
- `src/lib/address-suggest.ts` (captures REA `id` as `slug`) + `src/components/search/AddressSearch.tsx`
  (`handleSelect` drops the slug) + `StructuredAddress` (no id field) — basis for deferring fix #1.
