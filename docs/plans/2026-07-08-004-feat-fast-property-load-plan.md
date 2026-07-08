---
title: "feat: Fast-partial property page load with background upgrade"
status: active
date: 2026-07-08
type: feat
depth: lightweight
---

# feat: Fast-partial property page load with background upgrade

## Summary

When a target property is entered, the page currently blocks on `POST /api/property`'s **full crawl** (60–120s uncached) before rendering anything. The API already supports everything needed to avoid that wait: `fast: true` returns a trimmed partial in seconds and kicks the full crawl off in the background; `cachedOnly: 1` polls the cache without ever crawling; a Supabase cache tier already persists profiles across restarts (so the "cache lost on deploy" concern from planning is already solved — route step 1b).

The gap is purely in the web UI: `src/components/property/PropertyProfile.tsx` posts `{ address }` with no `fast` flag and has no upgrade mechanism. Fix: fetch fast, render the partial immediately, poll for the completed full profile, swap it in.

## Requirements

- R1. Entering an uncached address renders a usable partial profile within the fast-crawl budget (seconds), not after the full crawl.
- R2. The full profile replaces the partial automatically when the background crawl completes — no manual refresh.
- R3. While the upgrade is pending, the page shows a subtle "still gathering data" indicator; it disappears once full.
- R4. Cached (full) profiles behave exactly as today — instant, no polling, no indicator.
- R5. Estimates/enrichment quality is not degraded: when the full profile swaps in, dependent estimate calls re-run if the partial lacked the data they need (coords/beds/baths).
- R6. The `queued`/empty-partial case (fast crawl found nothing yet) shows the loading/skeleton state with the gathering indicator, not an empty or error page.

## Key Technical Decisions

- **`fast: true` + `cachedOnly` polling, no new endpoints.** The route's fast path already backgrounds the full crawl (`after(fetchAndCacheProfile)`) and `cachedOnly` returns 404-until-cached, then the full profile (fast partials are only served to `fast`/`cachedOnly` callers; the poll detects completion via `profile.crawlMode !== 'fast'`). Poll every ~5s, cap ~3min, stop on unmount/navigation (reuse the existing `requestId` supersession guard).
- **Swap-in re-runs estimates only when needed.** `fetchEstimates` derives inputs from the profile; if the partial had enough (coords, attrs) the numbers stand; otherwise re-fire with the full profile on upgrade.
- **No change to `/api/property`** — it already implements fast/background/cachedOnly semantics used by the CRM.

## Implementation Units

### U1. Fast-partial load + background upgrade in PropertyProfile

**Goal:** R1–R6.

**Dependencies:** none

**Files:**
- `src/components/property/PropertyProfile.tsx` — send `fast: true`; render partial; poll `cachedOnly`; swap full profile in; gathering indicator.
- `src/components/property/__tests__/PropertyProfile.fetch.test.tsx` — extend existing fetch tests.

**Approach:** In `fetchProperty`, add `fast: true` to the POST body. On response: render as today. If `data.profile.crawlMode === 'fast'` or `data.source === 'queued'`, start a poll loop: `POST /api/property` with `{ address, cachedOnly: true }` (or GET param form) every 5s; on a 200 whose profile has `crawlMode !== 'fast'`, set the new profile, re-run `fetchEstimates` if the partial lacked coords/attrs, and stop. Stop on 3min cap or `requestId` supersession. Show a small inline indicator (existing design language) while polling.

**Patterns to follow:** the `requestId`/`requestIdRef` supersession guard already in the component; the CRM fast-mode consumption described in `src/app/api/property/route.ts` comments.

**Test scenarios:**
- Fast response with `crawlMode: 'fast'` → partial renders, poll starts, and a subsequent `cachedOnly` 200 with `crawlMode: 'full'` replaces the profile and stops polling.
- Fast response already full (cache hit) → no poll, no indicator (R4).
- `source: 'queued'` empty partial → skeleton + indicator, not error (R6).
- Poll 404s keep polling; supersession (new address entered) stops the old poll.
- Estimates re-fire on upgrade when the partial had no coordinates.

**Verification:** with a cold cache, entering an address paints data in seconds and the network tab shows the `cachedOnly` polls, ending with a full-profile swap; a cached address behaves exactly as before.

## Scope Boundaries

**Non-goals:** crawl-cascade speed, `/api/property` changes, server-component conversion (still deferred from plan 2026-07-06-001).

## Risks

- Fast partials render fewer fields for a minute or two — mitigated by the indicator and automatic upgrade.
- Polling adds light request load (≤36 cheap cache-read requests per cold lookup, bounded).
