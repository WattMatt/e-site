# E-Site Solar add-on — specification pack

**Date:** 2026-09-28 · **Status:** DRAFT for owner review (no code written)
**Ask:** add a dedicated, paid, per-project Solar component to E-Site, based on the **WM Solar web app**,
with every gap in it fixed; tariffs from the NERSA source folder; load profiles from the meter-CSV folder.
**Baseline:** the WM Solar web app only. Nothing is taken from the WM Solar iOS app.

## Contents

| File | What it is |
|---|---|
| `01-functional-spec.md` | The target E-Site Solar module: every tab and control (purpose, behaviour, data, roles, empty/error states), the org portfolio page, org settings, the platform tariff library, and the **web parity matrix (§16)** mapping every WM Solar web feature to its E-Site home |
| `02-calculation-engine-spec.md` | Every formula and default: load, PV, battery, bill, finance; validation targets |
| `03-data-model-and-security.md` | Schemas, tables, per-project entitlement, RLS pattern, buckets, tariff model |
| `04-gap-register.md` | What the web app gets wrong or lacks (security, maths, broken features, data) and where each is fixed |
| `05-development-plan.md` | Phases P0–P8 with deliverables, verification, effort |
| `06-open-decisions.md` | Owner decisions with proposed defaults |
| `as-is/` | The exhaustive as-built review of the WM Solar web app, NERSA folder, meter folder and E-Site integration points, with `file:line` citations |

## Executive summary

1. **Everything the web app does comes across.** It has 14 project tabs and supporting pages: tenants,
   schematics, load profiles, costs, tariff, simulation, PV layout with 3D, solar forecast, proposals
   with a client portal, schedule/Gantt, documents, generation, monthly reports, the tariff database,
   the meter library, the quick estimate/sandbox, settings and the projects map. Each is carried into
   E-Site and fixed, or mapped to the E-Site module that already does the same job: documents, auth,
   users and the tenant-schedule import (§16). The only things not carried are dead or non-solar code:
   the dashboard mock, onboarding tours, the code-review suite and ops leftovers.
2. **The web app's numbers need fixing, not copying:**
   - the hourly engine ignores irradiance and yields ≈ 2,346 kWh/kWp/yr everywhere, 30–50 % above realistic SA values;
   - load is flattened to one averaged day;
   - tariff units are mixed (100× errors);
   - the bill model ignores most charges;
   - export is valued at R0 or full retail;
   - insurance is ×12.

   The engine is re-specified in `02`.
3. **The live web app has serious exposure:**
   - anon-key read/write on ~20 tables;
   - org isolation void;
   - 27 of 34 edge functions unauthenticated;
   - public buckets;
   - stored-XSS paths.

   This needs containment now, independent of E-Site (gap register §A, D-24).
4. **E-Site supplies most of the platform:**
   - RBAC and RLS helpers;
   - the tenant schedule with areas and categories;
   - calibrated drawings with Konva sheet primitives and route tracing;
   - versioned reports;
   - Documents with Dropbox sync;
   - work items and notifications.

   **It lacks per-project entitlements** (every unlock today is per-org or per-user).
5. **Target module:** eleven tabs per project behind a per-project unlock, enforced in the page, the
   actions and the database. The tabs are Overview, Site & Supply, Load, Schematics, Tariff, Layout,
   Yield & Scenarios, Financials, Reports & Proposal, Schedule and Operations. There are also a Solar
   portfolio page, org Solar settings and a platform tariff library. One engine in `@esite/shared`
   produces every figure from one stored, reproducible run.
6. **Data sources read (2026-09-28):** both folders synced and analysed. Blockers now: the tariff data
   is a year stale (2026/27 missing).
7. **Effort:** P1–P6 ≈ 71–80 build-days; operations and migration add ≈ 13–15.

## Review method
Parallel reviewers read the web app's canonical code (`origin/main` `8e9208d8` of `WattMatt/greencalc-sa`;
the local checkout is on a stale branch), the data folders, and E-Site `origin/main` `b8cca2e`. Findings
come from reading code, not from probing live databases. Nothing in any repository or database was changed.
