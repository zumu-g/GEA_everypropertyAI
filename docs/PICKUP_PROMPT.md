# Pickup prompt — everypropertyAI / PropertyIQ (as of 2026-06-10)

Paste the block below into a new session to resume.

---

You're working in the **PropertyIQ / everypropertyAI** repo (`propertyiq/`), a Next.js app +
`services/everypropertyai` CLI/MCP client. Prod runs on Railway
(`https://geaeverypropertyai-production.up.railway.app`, project `GEA_everypropertyAI`). Tests: `npx vitest run`. Typecheck: `npx tsc --noEmit`.

## Current state (what's true now)

- **Prod is fully live.** All env vars set on Railway (Supabase, Mapbox, Apify, `EVERYPROPERTY_API_KEYS`).
  Data routes return real data (verified: `/api/agents/listings`, `/api/search`, `/api/address-suggest`).
- **API auth = per-consumer keys, append-only** in `EVERYPROPERTY_API_KEYS` (comma-sep allowlist). Keys:
  `epai_cma_` (CMA), `epai_wcv_` (vendor report), `epai_crm_` (CRM, added 2026-06-10), plus a shared
  `epai_4c8c…`. Middleware (`src/middleware.ts`) reads `EVERYPROPERTY_API_KEYS` only; in-route routes
  (`search`/`proposal`/`agents`) read `KEYS ∪ EVERYPROPERTY_API_TOKEN`. See INTEGRATIONS.md.
- **CRM enrich 401 — fixed.** Root cause: GEA_crmAI's `EVERYPROPERTY_API_TOKEN` was a stale/shared key.
  Switched it to a dedicated `epai_crm_…` key (server-side verified live). Client hardened to report
  *which* 401 cause (plan 006, merged). **Open:** confirm the CRM enrich works end-to-end after its redeploy.
- **`main` has:** PR #4 (empty-profile feed-seed), #5 (401 hardening), #6 (per-consumer key docs).
- **Unmerged work on branch `feat/avm-data-foundation-rebased`:**
  - Plan 002 (statistical AVM) — U1 attribute persistence, U2 floor-area capture, U3 external
    `property_features` table + batch enricher (planning zone/overlays + nearest station; SEIFA/parcel
    deferred), U4 market-time price-index adjustment. U5–U10 (Python AVM service, hedonic model,
    backtesting, conformal intervals, API wiring) NOT started.
  - Plan 005 (school-zone enrichment) — code + tests done; the bundled GeoJSON reference data is NOT
    generated (needs GDAL/`ogr2ogr` per `scripts/prep-school-zones.md`); lookups fail-soft until then.

## Likely next tasks (pick one)

1. **CRM enrich smoke test** — verify GEA_crmAI enrich returns attributes for a real address now that it
   has the dedicated key; if still failing, check the CRM loads `EVERYPROPERTY_API_TOKEN` at call time.
2. **Merge the AVM branch** — review/merge `feat/avm-data-foundation-rebased` into `main` (plans 002 U1–U4 + 005).
3. **Continue plan 002 at U5** — Python AVM service scaffold + training-dataset builder (needs a Python env).
4. **Generate school-zone data** (plan 005 U1) — run `scripts/prep-school-zones.md` with GDAL, commit the
   clipped Casey/Cardinia GeoJSON.
5. **Rentals backfill** — `property_rentals` empty; raise the Apify cap, run the rent ingest (`PICKUP_listings_rentals.md`).

## Conventions

- Plans live in `docs/plans/`; use `/ce-plan` then `/ce-work`. Flip plan frontmatter `status:` to
  `completed` only when done. Branch off `main` per feature; open a PR (`gh pr create`), squash-merge.
- Never commit secrets; keys live in `.env.local` (gitignored) + Railway Variables.
- `gh` is at `/opt/homebrew/bin/gh` (not on PATH); `railway` CLI is installed + logged in.
