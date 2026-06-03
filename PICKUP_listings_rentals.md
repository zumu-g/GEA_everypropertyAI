# Pickup prompt — finish Beaconsfield Upper + rentals ingest

Paste the block below into a Claude Code session in this repo to resume. The only thing standing
between "done" and the current state is a **fresh Apify run**, which was blocked by the account's
monthly spend limit.

## Where we got to (2026-06-02)
- ✅ Migrations `001` + `002` applied to Supabase; `property_listings` / `property_rentals` exist.
- ✅ `property_sales` suburb casing backfilled to title case (no more `BEACONSFIELD` dupes).
- ✅ Code: `titleCaseSuburb()` + `normaliseSuburbAlias()` in `src/lib/utils/address.ts`; alias wired
  into the suburb reads in `src/lib/db/queries.ts`; suburb title-cased at ingest in
  `src/lib/ingest/domain-mapper.ts` and `scripts/ingest-domain-apify.mjs`.
- ✅ Ingest dedup bug fixed (batch de-dupe by on-conflict key) in the `.mjs` loader and
  `upsertRows()` — was crashing ingests with HTTP 500.
- ✅ On-market loaded from the free cached dataset `V56AzVH6c9Bf2XNUN`: **1,323 rows / 60 suburbs**,
  incl. Beaconsfield (3).
- ⛔ Still missing: **Beaconsfield Upper on-market** (not in that dataset) and **all rentals** (no
  rental dataset). Both need a fresh Apify actor run.
- ⛔ Blocker: Apify account at monthly hard limit ($51.59 / $50) → 403 `platform-feature-disabled`
  on actor start.

## Prereq before running this prompt
Raise the Apify spend limit (Apify Console → Settings → Usage & billing → spend limit) above ~$55,
or wait for the monthly reset. A full on-market + rent run is ~$1–2.

---

```
Resume the PropertyIQ listings/rentals ingest. The migrations, casing fix, suburb-alias
normalisation, and the ingest dedup fix are already DONE and committed (see DATA_HANDOVER.md and
DAILY_SYNC_SETUP.md). On-market is already loaded from a cached dataset. The ONLY remaining work is a
fresh Apify scrape for the two gaps: Beaconsfield Upper on-market, and ALL rentals.

Do this:
1. Confirm the Apify monthly spend limit has been raised: GET
   https://api.apify.com/v2/users/me/limits?token=$APIFY_API_TOKEN — check current monthly usage is
   below the limit. If still over, STOP and tell me to raise it.
2. Run both ingests in parallel (they self-load .env.local):
     node scripts/ingest-domain-apify.mjs on-market --run
     node scripts/ingest-domain-apify.mjs rent --run
   Each triggers the Domain actor (0EXe0hsmDKWLI3JF9) over the suburb list, polls to SUCCEEDED, then
   upserts. ~5–15 min each.
3. Verify against Supabase (service-role REST, sanitise env values for \r/quotes) that BOTH suburbs
   have rows in property_listings AND property_rentals:
     - Beaconsfield (3807) and Beaconsfield Upper (3808)
   Also confirm the alias works end-to-end: a query for suburb "Upper Beaconsfield" returns the same
   rows as "Beaconsfield Upper" (test getRentalsForSuburb / the /api/rental-listings route, or the
   everypropertyai CLI: `everypropertyai rentals --suburb "Upper Beaconsfield" --state VIC`).
4. Report counts per suburb/feed and commit nothing unless code changed.

Constraints: do NOT modify the ingest mappers or schema; this is a data run. STOP AND ASK before any
new Apify spend beyond the two runs above, or if either suburb still returns 0 after a SUCCEEDED run
(may indicate the suburb slug isn't in SUBURB_SLUGS in scripts/ingest-domain-apify.mjs).
```

## Optional follow-ups (not blocking)
- Stand up the scheduled Apify tasks + webhooks for steady-state daily sync (see `DAILY_SYNC_SETUP.md`
  §4) so this stops being manual.
- Wire the vendor report UI to pass the listed property's lat/lng so "within 500m" radius mode
  actually engages (separate Claude Code prompt already drafted).
