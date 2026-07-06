---
title: "feat: App-wide loading speed + clickable comparable sales"
type: feat
status: active
created_at: 2026-07-06
---

# feat: App-wide loading speed + clickable comparable sales

## Summary

Two pieces of work. First, an app-wide loading-performance pass targeting the highest-impact general offenders found in research: the serial fetch waterfall on the property profile, missing HTTP caching on every API route, framer-motion in every route's first-paint bundle, unoptimised images, and full-page-reload internal links. Second, a small UX feature: each comparable-sale card links to that property's own profile page, using the same `/property?address=` pattern My Properties already uses.

Backend crawl/profile-generation speed is out of scope — this targets the web app's loading behaviour.

---

## Problem Frame

The app feels slow to load everywhere. Research confirms structural causes rather than one bad page: all 8 routes are `"use client"` components that ship JS, hydrate, then fetch — nothing paints with data server-side; no API response carries a `Cache-Control` header, so every navigation refetches everything with no CDN or browser reuse; the property profile runs a strictly serial 4-fetch waterfall (property → enrich → estimate → estimate-rent) plus a 5th independent comparables fetch; framer-motion ships in the initial bundle of every route for simple fades; property photos are raw `<img>` with no dimensions (LCP/CLS damage on the heaviest page); and several internal links are raw `<a>` tags that trigger full document reloads.

Separately, comparable-sale cards are dead ends — users can't open the comparable they're looking at.

## Requirements

- R1. Clicking a comparable-sale card opens that property's profile page in the app (same tab), with a visible hover/focus affordance that it is clickable.
- R2. The property profile's data fetches run concurrently where data dependencies allow, instead of strictly serially.
- R3. Public, non-user-specific GET API responses carry browser-honoured caching headers so repeat navigations of the same query are served instantly for that user; user-specific and auth-gated routes are never cached.
- R4. framer-motion is out of the first-paint JS of routes that only use simple fades, either via CSS transitions or `LazyMotion`/`m` with the slim `domAnimation` feature set.
- R5. Property photos render via `next/image` with dimensions, and the profile hero is prioritised for LCP.
- R6. All internal navigation uses `next/link` — no full-page reloads from raw `<a href>` tags.
- R7. Nothing visually regresses: DESIGN.md's 150ms-transition discipline, skeleton loading pattern, and `prefers-reduced-motion` respect are preserved.

---

## Key Technical Decisions

- **Comparables link with the existing plain-address pattern, structured (not concatenated).** `src/app/my-properties/page.tsx` already links `/property?address=${encodeURIComponent(fullAddress)}`, but that plain-string form makes `PropertyProfile`'s parser fall back to stuffing the whole string into `streetName` with empty `suburb`/`state`/`postcode` (`src/components/property/PropertyProfile.tsx:239-251`) — which then degrades the enrich/estimate calls built from those fields for the comparable's own load. Instead, build the same **structured** address object `AddressSearch.tsx` sends (`JSON.stringify({ streetNumber, streetName, streetType, suburb, state, postcode })`, URL-encoded) from `comp.address` + `comp.suburb`, splitting the street line into its components on the leading number the same way the structured form expects. Comparables are mostly never-profiled addresses, so this click will cache-miss `POST /api/property` and run a live crawl — acceptable (My Properties has the same cold-start behaviour), but note it in the unit rather than implying an instant load.
- **Fix the real fetch graph, don't parallelise past it.** `PropertyProfile.tsx`'s `fetchEnrichment` (`~line 280-421`) is not simply serial-by-choice — it has real data dependencies: `/api/estimate` needs `coords` taken from the **enrich** response (`data.coordinates`, line 354), and `/api/estimate-rent` needs `saleEstimateMid` taken from the **estimate** response (`saleMid`, line 401). The true graph is `property → enrich → estimate → estimate-rent`; none of the three trailing legs can run concurrently with each other today. The parallelisable win is between `property` and `enrich` — un-hook `estimate` from waiting on `enrich`'s round-trip by having `POST /api/property` return coordinates (property's DB row already carries `latitude`/`longitude`), so `estimate` can start as soon as `property` resolves, in parallel with `enrich`, while `estimate-rent` stays chained behind `estimate`'s `saleMid`. This preserves both estimates' quality (no coordless suburb-only fallback, no unanchored rent estimate) instead of trading correctness for concurrency.
- **Also fix the confirmed stale-closure bug: estimate/rent likely never fire on first load today.** `fetchEnrichment` is a plain (non-`useCallback`) function that reads the component's `property` state directly; `fetchProperty`'s `useCallback` closes over the `fetchEnrichment` reference from the render that created it, so the `property` it reads at `data?.marketData && property` (line 307) is the pre-fetch value (`null`) — the entire estimate/rent block is gated on a condition that is false on first load. This is not a corner case to preserve; root-cause it (derive the gate from the just-fetched property data passed as a parameter, not from stale component state) as part of this unit, and expect the "serial baseline" timing to include requests that don't currently fire at all.
- **Caching is browser-side, not CDN — production runs on Railway, not Vercel.** `docs/PICKUP_PROMPT.md` confirms prod is served from `https://geaeverypropertyai-production.up.railway.app`; `vercel.json`'s cron entries are a separate, unrelated concern. `s-maxage`/`stale-while-revalidate` are shared-cache directives with no CDN in front of Railway to honour them — they'd ship as inert headers. Use `Cache-Control: private, max-age=300, stale-while-revalidate=86400` instead: browsers honour `private`/`max-age` directly, so a revisit or back/forward navigation to the same query is served from the browser's own cache with no network round-trip at all — no infra dependency, and it sidesteps the CDN-vs-auth-gate interaction entirely (nothing but the requesting browser ever sees the cached body). Cache candidates: `comparable-sales`, `enrich`, `estimate`, `estimate-rent`, `street-details` — keyed by the browser per full query string. Three of these (`comparable-sales`, `enrich`, `street-details`) sit behind `src/middleware.ts`'s API-key gate for cross-origin callers; `private` caching doesn't change what the gate protects (each caller's browser only ever caches its own authorized response), so no gate redesign is needed. Never cache: anything under `auth`, `user`, `team`, `admin`, or any route reading the session. `POST /api/property` is uncacheable by method and stays as-is — its revisit speed is explicitly out of this unit's scope (see Deferred to Follow-Up Work).
- **Motion diet via CSS-first, LazyMotion where motion stays.** Most framer-motion usage is fade-up-on-mount. Replace those with the existing Tailwind transition vocabulary (DESIGN.md's 150ms discipline) where the animation is a simple fade/translate; where springy motion genuinely earns its keep, switch `motion.*` to `m.*` inside a single shared `LazyMotion features={domAnimation}` provider so the full animation runtime drops out of the first-paint bundle. Recharts is already correctly code-split via `next/dynamic` — leave it. The comparable cards' per-index stagger (`delay: i * 0.07`) has no static-CSS equivalent; preserve it via an inline `style={{ transitionDelay: `${i * 70}ms` }}` alongside the Tailwind transition classes, and implement `prefers-reduced-motion` handling as one shared CSS utility/class applied everywhere motion is converted, not bespoke per component, so a single test covers all conversions.
- **`next/image` needs real remotePatterns added, not left as a contingency.** `next.config.ts` currently only allows `**.realestate.com.au` and `**.domain.com.au`, but actual photo URLs live on `i2.au.reastatic.net` (confirmed in `src/lib/extraction/__tests__/grounding.test.ts`) and Domain's actual CDN is `*.domainstatic.com.au`, plus Homely's image host for `source='homely'` rows. Adding the real hosts to `remotePatterns` is a required first step of the unit that adopts `next/image`, not something to discover via a 400 in production.
- **Not doing server-component conversion in this pass.** Converting the client-rendered shell to server components is the deepest structural win but a large, regression-prone refactor across all 8 routes. Deferred (see Scope Boundaries) — the units above capture most of the perceived-speed win at a fraction of the risk.

---

## Implementation Units

### U1. Make comparable-sale cards link to their property profile

- **Goal:** Each comparable card is a link opening `/property?address=…` for that comparable.
- **Requirements:** R1, R7
- **Dependencies:** none
- **Files:** `src/components/property/ComparableSales.tsx`, `src/components/property/__tests__/ComparableSales.test.tsx` (new)
- **Approach:** Wrap the **entire card** (the current outer `rounded-xl border ... p-5 hover:shadow-md` element, not just the address text) in `next/link`, so the whole card is the tap/click target per DESIGN.md's ≥44px touch-target floor. Build the `href` from a **structured** address object (matching the shape `AddressSearch.tsx` sends: `{streetNumber, streetName, streetType, suburb, state, postcode}`, `JSON.stringify`'d and URL-encoded) derived from `comp.address` (split into number/name/type) and `comp.suburb`/state — not the plain-string form — so the profile's parser doesn't fall back to stuffing everything into `streetName`. Add focus-visible ring per DESIGN.md. Keep the entrance animation and stagger behaviour consistent with whatever U4 decides for this component (see U4's CSS-stagger approach).
- **Patterns to follow:** the structured-address JSON shape built in `src/components/search/AddressSearch.tsx`; the `/property?address=` link pattern in `src/app/my-properties/page.tsx` (simpler plain-string case — not the pattern to copy here, since it doesn't carry suburb/state/postcode as separate fields); focus/hover treatments in existing cards.
- **Test scenarios:**
  - Card renders as a link with `href` containing a URL-encoded structured-address JSON object whose `suburb` field is `comp.suburb` (not concatenated into `streetName`).
  - Address splitting: `"12 Smith St"` → `streetNumber: "12"`, `streetName: "Smith"`, `streetType: "St"`.
  - The whole card element (not just the address text) is the `next/link` anchor — assert the link wraps price, date, and badge children too.
  - Empty comparables state still renders the "not enough local data" panel with no link wrapper errors.
- **Verification:** Clicking a comparable on a real profile navigates client-side (no full reload) to that comparable's profile page; the structured address sent to `POST /api/property` carries the suburb in the `suburb` field. Note: most comparables are never-profiled, so this is expected to trigger a live crawl on `/api/property` (same cold-start behaviour as My Properties) rather than an instant load — this unit does not need to eliminate that latency.

### U2. Fix the stale-closure bug, then parallelise property→enrich and property→estimate

- **Goal:** Estimate and estimate-rent panels reliably render on first load (currently gated on a stale-closure bug that likely blocks them), and estimate starts as soon as the property fetch resolves instead of waiting on enrich's round-trip — cutting time-to-estimate roughly to `max(enrich, estimate)` instead of `enrich + estimate`. Estimate-rent stays chained behind estimate (it needs `saleEstimateMid`).
- **Requirements:** R2
- **Dependencies:** none
- **Files:** `src/components/property/PropertyProfile.tsx`, `src/app/api/property/route.ts` (return `latitude`/`longitude` on the profile response), plus its existing test surface (`src/lib/jobs/__tests__/` covers the API side; component-level coverage as feasible)
- **Approach:** Root-cause and fix the stale-closure bug first: `fetchEnrichment` reads component `property` state directly and is captured by `fetchProperty`'s `useCallback` from a render before `property` is set, so `data?.marketData && property` is checked against a stale (`null`) value — likely meaning estimate/rent never fire today. Fix by passing the just-fetched property data as a parameter instead of reading closed-over state. Then have `POST /api/property` include `latitude`/`longitude` in its response (already columns on the property/comparable rows) so `estimate` can be called with `lat`/`lng` as soon as `property` resolves, running concurrently with `enrich`, rather than waiting for `enrich`'s response to supply `data.coordinates`. Leave `estimate-rent` sequenced behind `estimate`'s result (`saleEstimateMid`) — that dependency is real and not worth breaking.
- **Execution note:** Characterise the current (buggy) behaviour first — confirm via a real profile load whether estimate/rent currently fire at all — before restructuring. This is 1,758 lines of legacy client code.
- **Test scenarios:**
  - Regression test pinning the stale-closure fix: estimate/rent panels populate on a genuine first load (not a re-render) with fresh property data.
  - `estimate` is requested with `lat`/`lng` sourced from the property response, not the enrich response.
  - `estimate` and `enrich` requests are issued concurrently (assert relative call order/concurrency with mocked fetch) — `estimate-rent` is NOT issued until `estimate`'s response resolves.
  - Enrich failure does not prevent the estimate panel from rendering (since estimate no longer depends on enrich for coordinates).
  - Property fetch failure short-circuits all three dependent fetches (no orphan requests with undefined params).
- **Verification:** Network tab on a cached profile shows enrich and estimate overlapping, with estimate-rent starting only after estimate resolves; total time-to-estimate drops versus the serial baseline; no panel regresses to permanent skeleton; estimate quality is unchanged (still coordinate-anchored, still sale-mid-anchored rent).

### U3. Browser caching headers on public GET API routes

- **Goal:** A revisit or back/forward navigation to the same query (same suburb's comparables, same address's enrich/estimate) is served from the requesting browser's own cache with no network round-trip, for the panels this unit touches.
- **Requirements:** R3
- **Dependencies:** none
- **Files:** `src/app/api/comparable-sales/route.ts`, `src/app/api/enrich/route.ts`, `src/app/api/estimate/route.ts`, `src/app/api/estimate-rent/route.ts`, `src/app/api/street-details/route.ts` (final list confirmed at implementation by auditing each GET route for user-specificity), plus a small shared helper if one doesn't exist; tests colocated per route where test files exist.
- **Approach:** Add `Cache-Control: private, max-age=300, stale-while-revalidate=86400` (tune per route) to responses of GET routes whose output depends only on query params + public feed data — `private` restricts the cache to the requesting browser, sidestepping any need for a fronting CDN (production runs on Railway, not Vercel) and avoiding any interaction with `src/middleware.ts`'s API-key gate (each caller only ever caches its own authorized response). Explicitly audit and exclude any route that reads the session, an API key identity, or user tables. Error responses must not be cached (no cache headers on non-200s).
- **Test scenarios:**
  - Each cached route's 200 response carries the expected `Cache-Control: private, max-age=...` header.
  - Error responses (400/404/500) from the same routes carry no cache header.
  - Auth-gated routes (e.g. user/team) demonstrably do NOT gain cache headers (guard test on one representative route).
- **Verification:** In the browser devtools network tab, a second request to the same comparable-sales/enrich/estimate URL within the `max-age` window is served `(from disk cache)`/`(from memory cache)` with no network request. This unit does not change `POST /api/property`'s revisit speed — that stays out of scope (see Deferred to Follow-Up Work).

### U4. Trim framer-motion from first-paint bundles

- **Goal:** Routes that only fade content in no longer ship the full framer-motion runtime in their initial JS.
- **Requirements:** R4, R7
- **Dependencies:** U1 (touches `ComparableSales.tsx` — land U1 first for a clean merge)
- **Files:** `src/app/page.tsx`, `src/app/street/page.tsx`, `src/components/property/ComparableSales.tsx` and the other property components importing `framer-motion` (full list at implementation via grep); a shared reduced-motion CSS utility/class; shared `LazyMotion` provider file if the LazyMotion path is used.
- **Approach:** Per component: if the animation is a mount fade/translate, replace with CSS (Tailwind transition/animation classes, respecting the 150ms discipline). Preserve `ComparableSales`' per-card stagger via an inline `style={{ transitionDelay: `${i * 70}ms` }}` alongside the Tailwind classes — a static utility class can't express the per-index delay. Implement `prefers-reduced-motion` handling as one shared CSS utility applied to every converted component (not bespoke per component), so a single test genuinely covers all of them. If real motion value remains, convert `motion.*` → `m.*` under one `LazyMotion features={domAnimation}` boundary. Measure before/after with `next build` route-size output as the objective check.
- **Test scenarios:**
  - Existing component tests still pass with animations replaced (no reliance on framer-motion internals).
  - `prefers-reduced-motion` users get no entrance animation — tested against the shared utility/class itself (one test covers every component using it), not a single representative component.
  - `ComparableSales`' stagger delay still increases per card index after the CSS conversion.
- **Verification:** `next build` first-load JS for the home and street routes drops measurably (framer-motion is ~30-40KB gzipped); visual spot-check shows equivalent fades.

### U5. next/image for property photos, next/link for internal nav, route loading states

- **Goal:** The heaviest page's images stop hurting LCP/CLS, internal links stop full-page reloading, and route transitions show an immediate loading state.
- **Requirements:** R5, R6, R7
- **Dependencies:** none
- **Files:** `next.config.ts` (remotePatterns), `src/components/property/PropertyProfile.tsx` (hero + thumbnails), `src/components/property/PropertyHero.tsx`, `src/app/page.tsx`, `src/app/settings/page.tsx`, `src/app/my-properties/page.tsx` (wordmark link), `src/app/property/loading.tsx` (new), `src/app/my-properties/loading.tsx` (new), other routes as sensible.
- **Approach:** First, add the real photo CDN hosts to `next.config.ts`'s `remotePatterns` — the configured `**.realestate.com.au`/`**.domain.com.au` don't match actual photo URLs (`i2.au.reastatic.net`, `*.domainstatic.com.au`, plus the Homely image host for `source='homely'` rows); confirm exact hosts by sampling `photos` values from the property/comparable data before hardcoding. Then swap raw `<img>` → `next/image` with explicit dimensions (or `fill` + sized container); hero gets `priority`. Replace raw internal `<a href>` with `next/link`. Add minimal `loading.tsx` files reusing `src/components/ui/Skeleton.tsx` so navigation paints instantly.
- **Test scenarios:**
  - Internal nav elements render as `next/link` anchors (no `target`/full-reload semantics).
  - Hero image renders with `priority` and explicit dimensions; thumbnails lazy-load.
  - Test expectation for `loading.tsx` files: none — pure loading UI scaffolding, verified visually.
- **Verification:** Lighthouse on /property shows improved LCP and CLS versus baseline; clicking the wordmark/settings links no longer flashes a full document reload.

---

## Scope Boundaries

**In scope:** the five units above.

### Deferred to Follow-Up Work

- **Server-component conversion of route shells** — the deepest structural fix for first-paint (nothing currently renders server-side), but a broad, regression-prone refactor across all 8 routes; do it as its own plan once this pass's wins are banked.
- **Using `cachedOnly=1` on `POST /api/property` for instant profile paint + background refresh** — a ready-made lever the UI never adopted; changes profile freshness semantics, so it deserves its own product decision.
- **Bundle analyzer + Turbopack dev flag** — nice observability, not needed to execute this plan; `next build` route sizes are sufficient measurement.
- **Backend crawl/profile-generation speed** — explicitly out of scope per user.

---

## Risks

- **Browser caching still serves stale data within its window:** feeds update daily, so minutes-fresh `max-age` with day-long SWR is safe; the risk is bounded to one browser's own cache (not shared), so the blast radius of a mismatch is a single user seeing slightly stale panel data, never a cross-user leak.
- **PropertyProfile is 1,758 lines of legacy client code:** the waterfall fix (U2) is the riskiest unit — it's also fixing a live bug (the stale-closure gate), not just restructuring; the characterise-first execution note and per-panel skeleton fallbacks bound the blast radius.
- **Animation regressions:** swapping framer-motion for CSS can subtly change feel; DESIGN.md's 150ms discipline is the arbiter, and U4 keeps LazyMotion as the fallback where CSS feels worse.
- **This pass may not fully resolve "feels slow"**: the biggest levers — nothing renders server-side, and `POST /api/property`'s crawl-on-miss dominates cold loads — are both deferred. U2's characterisation step should record per-leg timings on a cold load (not just a cached one) so it's clear whether the parallelised legs are a meaningful fraction of total time before investing further in this direction versus prioritising the deferred work.
