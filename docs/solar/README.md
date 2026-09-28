# E-Site Solar add-on — specification pack

**Date:** 2026-09-28 · **Status:** DRAFT for owner review (no code written)
**Ask:** add a dedicated, paid, per-project Solar component to E-Site, based on a full review of the
WM Solar apps (web + iOS), the NERSA tariff source folder and the meter-CSV source folder.

## Contents

| File | What it is |
|---|---|
| `01-functional-spec.md` | The target E-Site Solar module: every tab, every control, its purpose, behaviour, data, roles, empty/error states |
| `02-calculation-engine-spec.md` | Every formula and default: load, PV, battery, bill, finance; validation targets |
| `03-data-model-and-security.md` | Schemas, tables, per-project entitlement, RLS pattern, buckets, tariff model |
| `04-gap-register.md` | What WM Solar gets wrong or lacks (security, maths, dead features, data) and where each is resolved |
| `05-development-plan.md` | Phases P0–P8 with deliverables, verification, effort |
| `06-open-decisions.md` | 25 owner decisions with proposed defaults (10 needed before Phase 1) |
| `as-is/` | The exhaustive as-built review of WM Solar — every tab, button and function with `file:line` (11 reports, ~15k lines) |

## Executive summary

1. **WM Solar should be a behavioural reference, not a code source.** The UI is broad (14 project tabs,
   ~140k lines web + a SwiftUI app) but most of its sophistication does not reach the numbers:
   - the hourly engine ignores irradiance and yields ≈ 2,346 kWh/kWp/yr everywhere, 30–50 % above realistic SA values;
   - load is flattened to one averaged day;
   - tariff units are mixed (100× errors);
   - the bill model ignores most charges;
   - export is valued at R0 or full retail;
   - insurance is ×12.
   Proposals issued from it may overstate savings.
2. **The live WM Solar apps have serious exposure.** Critical items:
   - anon-key read/write on ~20 tables;
   - org isolation void;
   - 27 of 34 edge functions unauthenticated (one reads GitHub repos, one copies ~49 tables elsewhere);
   - public buckets;
   - three stored-XSS paths;
   - iOS builds shipped the service-role key.

   This needs containment now, independent of E-Site (gap register §A, decision D-24).
3. **E-Site already has most of the plumbing:**
   - project RBAC and RLS helpers;
   - tenant schedule with shop areas and categories;
   - calibrated drawings with Konva sheet primitives and route tracing;
   - versioned reports;
   - Dropbox sync, work items and notifications;
   - the GCR module as a structural template.

   It lacks per-project entitlements (every unlock today is per-org or per-user), and has no tariff,
   meter-data, load or yield model.
4. **The target module:** nine tabs per project (Overview, Site & Supply, Load, Tariff, Layout,
   Yield & Scenarios, Financials, Reports & Proposal, Operations). It sits behind a per-project unlock
   enforced in the page, the actions and the database, and adds a platform tariff library and org Solar
   settings. There is one engine in `@esite/shared` and every figure comes from one stored, reproducible run.
5. **Blockers:** the NERSA and meter-CSV folders are online-only Dropbox placeholders, and the tariff data
   is a year stale (2026/27 missing). Ten owner decisions are needed before Phase 1.
6. **Effort:** P1–P6 is about 57–64 build-days; operations, mobile and migration add about 13–17.

## Review method
Eleven parallel reviewers read the canonical code (web `origin/main` `8e9208d8` of `WattMatt/greencalc-sa`
— the local checkout is on a stale branch; iOS `main`), the data folders, and E-Site `origin/main`
`b8cca2e`. Findings come from reading code, not from probing live databases; they are cited `file:line`
in `as-is/`. Nothing in any repository or database was changed by the review.
