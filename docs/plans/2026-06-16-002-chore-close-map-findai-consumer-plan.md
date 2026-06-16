---
title: "chore: close MAP_findAI consumer — merged into GEA_CRM"
status: active
date: 2026-06-16
type: chore
depth: lightweight
---

# chore: close MAP_findAI consumer — merged into GEA_CRM

## Summary

MAP_findAI ("nearby sold + listed properties for a market appraisal / nurture") was a **planned CLI consumer** of the everypropertyAI API, documented only as a paste-in integration prompt (`services/everypropertyai/MAP_FINDAI_INTEGRATION_PROMPT.md`). It was never provisioned with its own `epai_` key. Its market-appraisal/nurture capability is now owned by **GEA_CRM** (live consumer, `epai_crm_` key).

This is a **bookkeeping close**: record the merge, retire MAP_findAI as a separate consumer in the docs/integration map, and verify GEA_CRM's existing key + CLI surface actually covers everything MAP_findAI relied on. No server, auth, or CLI code changes — consumer keys are global across all endpoints, so `epai_crm_` already authorises the `sold` / `comps` / `street` / `search` commands MAP_findAI used (confirmed present in `services/everypropertyai/src/cli.ts`).

---

## Problem Frame

The integration map and `INTEGRATIONS.md` currently present MAP_findAI as a distinct (sixth) consumer. After the merge it should read as **retired / folded into GEA_CRM**, so nobody provisions it a separate key or treats it as an independent integration. The "make sure this is done correctly" requirement is a coverage check: confirm GEA_CRM can do what MAP_findAI needed before the spec is archived.

---

## Requirements

- **R1.** Verify GEA_CRM's `epai_crm_` key + the everypropertyAI CLI cover MAP_findAI's data needs: suburb-wide sold feed (`sold --suburb`), comparable sales (`comps --suburb`), and street-level listed data (`street`). No capability is lost in the merge.
- **R2.** Retire `MAP_FINDAI_INTEGRATION_PROMPT.md` as an active spec — mark it superseded/merged-into-GEA_CRM rather than leaving it as a live integration to wire.
- **R3.** Reconcile `INTEGRATIONS.md` and the integration map so MAP_findAI no longer appears as a separate live consumer; record that GEA_CRM now owns the market-appraisal/nurture capability.
- **R4.** Confirm no dangling MAP_findAI `epai_` key exists to revoke (in-repo search found none; the server allowlist lives on Railway, not in-repo).

---

## Key Technical Decisions

**KTD1 — Archive, don't delete, the integration prompt.** Add a clear "SUPERSEDED — merged into GEA_CRM (2026-06-16)" banner to the top of `MAP_FINDAI_INTEGRATION_PROMPT.md` and keep the file as historical reference, rather than removing it. *Rationale:* the commands it documents (`sold`/`comps`/`street`) are still valid CLI usage GEA_CRM can reuse; the prose is useful provenance. Deleting loses that.

**KTD2 — No code/auth change.** The merge needs no change to `EVERYPROPERTY_API_KEYS`, middleware, routes, or the CLI. `epai_crm_` is a global key; the four commands already exist. *Rationale:* keys authorise every endpoint (the documented invariant in `INTEGRATIONS.md`), so GEA_CRM inherits MAP_findAI's surface for free.

**KTD3 — Treat the `services/everypropertyai 2/` duplicate as out-of-scope housekeeping.** The iCloud sync copy `services/everypropertyai 2/MAP_FINDAI_INTEGRATION_PROMPT.md` is a stray duplicate, not a real consumer. Note it but don't let this plan own the broader iCloud-dup cleanup.

---

## Implementation Units

### U1. Verify GEA_CRM covers MAP_findAI's data needs

**Goal:** Confirm — before archiving the spec — that GEA_CRM's `epai_crm_` key + the everypropertyAI CLI deliver MAP_findAI's three data needs (suburb sold, comps, street-level listed).
**Requirements:** R1, R4.
**Dependencies:** none.
**Files:** `services/everypropertyai/src/cli.ts` (read), `services/everypropertyai/MAP_FINDAI_INTEGRATION_PROMPT.md` (read), `INTEGRATIONS.md` (read).
**Approach:** Cross-check the commands MAP_findAI's prompt calls (`sold --suburb`, `comps --suburb`, `street`, `search`) against the CLI command definitions; confirm each maps to a live route (`/api/sold-sales`, `/api/comparable-sales`, `/api/street-details`, `/api/search`). Confirm the global-key invariant means `epai_crm_` authorises them. Grep the repo to confirm no MAP-specific `epai_` key is referenced anywhere. Record the result as the evidence backing R1/R4 (a short note in the PR description / commit body).
**Test expectation: none — verification unit** (a coverage audit, not a behavioural change). The "done" signal is the confirmed mapping, not a test.
**Verification:** Each of the four MAP_findAI commands resolves to an existing CLI command and live route; no MAP `epai_` key found in-repo. If any command/route is missing, STOP and surface it — the merge is not safe to close.

### U2. Mark the MAP_findAI integration prompt as superseded

**Goal:** Retire the spec as an active integration without losing its provenance.
**Requirements:** R2.
**Dependencies:** U1 (only mark superseded once coverage is verified).
**Files:** `services/everypropertyai/MAP_FINDAI_INTEGRATION_PROMPT.md` (modify).
**Approach:** Add a prominent banner at the top: status SUPERSEDED, date 2026-06-16, one line stating the market-appraisal/nurture capability is now owned by GEA_CRM and that the `sold`/`comps`/`street` commands are available to the `epai_crm_` key. Leave the body intact as historical reference.
**Test expectation: none — documentation change.**
**Verification:** The file opens with an unmistakable superseded banner; a reader won't mistake it for a live integration to wire.

### U3. Reconcile INTEGRATIONS.md and the integration map

**Goal:** Make the consumer inventory reflect that MAP_findAI is merged into GEA_CRM.
**Requirements:** R3.
**Dependencies:** U1.
**Files:** `INTEGRATIONS.md` (modify), `docs/INTEGRATIONS-MAP.svg` (modify), `docs/INTEGRATIONS-MAP.png` (regenerate from the SVG).
**Approach:** In `INTEGRATIONS.md`, ensure MAP_findAI is not listed as a separate live consumer; add a short note under GEA_CRM that it now owns the market-appraisal/nurture commands (formerly MAP_findAI). In the integration map SVG, remove the standalone MAP_findAI box (or relabel it as a sub-capability of GEA_CRM) and update the footer/key-hygiene note that previously flagged "MAP_findAI has no key". Regenerate the PNG via the same render path used to create it (`qlmanage -t` fallback).
**Test expectation: none — documentation/diagram change.**
**Verification:** `INTEGRATIONS.md` and the map both show five live consumers with MAP_findAI folded into GEA_CRM; the "no key assigned" warning for MAP_findAI is gone; PNG matches the edited SVG.

---

## Scope Boundaries

**In scope:** Verifying coverage, marking the MAP_findAI prompt superseded, reconciling `INTEGRATIONS.md` + the integration map.

**Deferred to Follow-Up Work:**
- Cleaning up the iCloud duplicate directories (`services/everypropertyai 2/`, `services/scraper 2/`, `src/app/api 2/`) — separate housekeeping (KTD3).
- Assigning dedicated per-consumer keys to GEA_ST_Proposals and GEA_HR_recruitAI (the other key-hygiene gaps surfaced in the integration audit) — unrelated to this merge.

**Outside this plan's scope:** Any change to `EVERYPROPERTY_API_KEYS`, middleware, routes, or the CLI (none needed — KTD2). Revoking a production MAP_findAI key (none exists per R4; if Railway turns out to hold one, that revoke is a one-line ops step, not code).

---

## Risks & Dependencies

- **Hidden production key.** The in-repo search found no MAP_findAI `epai_` key, but the live allowlist is on Railway. If MAP_findAI was ever provisioned there, it should be revoked separately — U1 records the in-repo finding so this is a conscious check, not an assumption.
- **Duplicate file drift.** Edits target `services/everypropertyai/MAP_FINDAI_INTEGRATION_PROMPT.md`, not the iCloud `… 2/` copy. The duplicate is stale and out of scope; don't edit both.
