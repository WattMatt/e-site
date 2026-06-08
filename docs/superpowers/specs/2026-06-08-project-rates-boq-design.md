# Project Rates / BOQ — Design Spec

**Date:** 2026-06-08
**Status:** Approved (design) — Phase 1 is the build target; Phases 2–4 are scope-only.
**Author:** Arno Mattheus (with Claude)
**Source data:** `AEEC - KIGSWALK ELECTRICAL BOQ -F - Tender.xlsx` (the priced KINGSWALK electrical tender, an Open Nexus export).

---

## 1. Problem & motivation

E-Site projects carry a contract value (`projects.contract_value`) as a single opaque number. There is no structured record of **how that number is built up** — the priced Bill of Quantities (BOQ) that defines every item, its unit, its quantity, and its supply/install rates.

The contractor receives this BOQ as an Open Nexus spreadsheet export at tender. We want to capture it inside the project so that:

- the agreed **rates** are on file per project (a schedule of rates),
- the **contract value is broken down** and verifiable (Mall + per-tenant bills → grand total),
- later phases can drive **variations, remeasures, valuations and payment certificates** off the same data, and
- the bills can eventually **link to the live project model** (tenant nodes, cable schedule, Equipment & Materials).

The feature lives as a new **Rates** tab in project settings.

---

## 2. Source-data analysis (what we are modelling)

The attached file is a real, complete priced BOQ. Key facts that drive the model:

- **~2,994 coded line items** across **36 sheets**; total **R51,064,581.53 ex-VAT → +R7,659,687.23 VAT → R58,724,268.76 incl-VAT**.
- **Three-level hierarchy:**
  - **Main Summary** — rolls up the *Mall portion* (R37,184,510.62) + **19 tenant bills** (Boxer, Boxer Liquor, Sportscene, Clicks, Shoprite Liquor, Shoprite, Truworths, Identity, SYNC, JET, Vacant(Sport), Markhams, Exact, Dis-Chem, ASJ, Totalsport, The Fix, Cashbuild) → grand total.
  - **Bill / sheet** — each tenant is one self-contained sheet (`Shop 01 – SHOPRITE`); the Mall portion is composed of sheets `1.2 Medium Voltage … 1.16 Day Works`, rolled up by `1.17 Mall Summary` into lettered sections A–P.
  - **Category → line item** — e.g. `C1` (LV cable) → `C1.1 = 4C×185mm · m · 60 · …`.
- **Canonical line-item columns (29 of 36 sheets, identical):**
  `ITEM · DESCRIPTION · UNIT · QTY · SUPPLY · INSTALL · AMOUNT`, where **Amount = Qty × (Supply + Install)**.
- **Column-model variants the parser must tolerate:**
  - **Single-rate** sheets (`P&G`, `1.16 Day Works`): `… QTY · RATE · AMOUNT`.
  - **Amount-only** sheets (`1.15 Sundries`): `… QTY · AMOUNT` (lump sums).
  - **Summary** sheets (`Main Summary`, `1.17 Mall Summary`): `ITEM · DESCRIPTION` + amount column only.
  - **Prose** sheets (`NOTES TO TENDERER`, `QUALIFICATIONS TO TENDER`): no BOQ — skipped.
  - **Source noise:** header typos (`ITEA` for `ITEM`), `SUPPLY RATE`/`INSTALL RATE` labels (Cashbuild) vs `SUPPLY`/`INSTALL`.
- **Domain quirks to model:**
  - **624 "RATE ONLY" rows** — rate fixed, quantity remeasured later (a contractual concept, per the Notes sheet: *"All 'Rate only' request must be…"*). `AMOUNT` is blank for these.
  - **27 provisional refs**, **73 PC-sum (Prime Cost) refs**, `Sum` (lump-sum) units, and `QTY = 0` / blank rows.
  - Float noise in amounts (e.g. `187778.21000000002`) — must round to 2dp.

**Item-code grammar:** section letter (A–P) → category (`C1`, `C2`) → line item (`C1.1`, `C1.2`). The letter prefixes its categories, which prefix their items — consistent within both Mall sheets and tenant sheets.

---

## 3. Locked design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | **Scope** | **Full priced BOQ, phased UI.** Store the whole bill (sections, line items, qty + supply/install + amounts + rollups). Phase 1 ships import + view + rate editing; valuations/variations are later phases. |
| D2 | **Ingestion** | **Import this Excel, then edit in-app.** Build an Open-Nexus `.xlsx` parser; one-shot seed; adjustments edited in-app afterwards. |
| D3 | **Integration** | **Standalone now, linkable later.** Own tables; schema carries an optional `node_id` FK on bills so a future phase can wire BOQ ↔ structure/materials. No coupling in Phase 1. |
| D4 | **Re-import behaviour** | **Re-import replaces.** A new import row is created and flipped `is_current = true`; the prior import is kept (`is_current = false`) for audit. A confirm step guards it. |
| D5 | **Home & RBAC** | New `/settings/rates` tab, **view + edit gated to `COST_VIEW_ROLES`** (owner/admin/PM). Rates are cost data. |

---

## 4. Scope & phasing (full scope)

- **Phase 1 — BUILD TARGET of this spec.** Schema (`00122`) + Open-Nexus importer + reconciliation report + Main-Summary / drill-down viewer + inline supply/install rate editing. *Outcome: the contract BOQ is captured, verified against its own totals, visible and rate-editable.*
- **Phase 2 — Variations & remeasures.** Measure the RATE-ONLY items, capture variation orders, show revised-vs-baseline totals; import versioning beyond the simple replace.
- **Phase 3 — Valuations / payment certificates.** % complete per item/section → interim valuation → branded certificate PDF (reuses the existing react-pdf report engine + `projects.reports`).
- **Phase 4 — Integration.** Activate the `node_id` link (bill ↔ tenant node), feed contract rates into Equipment & Materials, surface a tenant node's BOQ value.

Phases 2–4 are documented here for context and to justify Phase-1 schema choices (the `node_id` hook, the `boq_imports` versioning row, stored leaf amounts). **They are NOT implemented in Phase 1.**

---

## 5. Architecture

### 5.1 Data model — migration `00122_project_boq_rates.sql`, schema `projects`

Three tables. The hierarchy is a **self-referencing tree** (matching the `structure.nodes` `parent_node_id` pattern). Adding tables to the existing `projects` schema needs only `NOTIFY pgrst, 'reload schema'` — **no PostgREST `db_schema` PATCH** (that is required only for `CREATE/DROP SCHEMA`).

**`projects.boq_imports`** — one row per import (contract baseline + audit/version trail)

```
id                uuid PK default gen_random_uuid()
project_id        uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE
organisation_id   uuid NOT NULL REFERENCES public.organisations(id)
source_filename   text NOT NULL
storage_path      text                      -- original .xlsx in the boq-imports bucket (nullable)
imported_by       uuid REFERENCES public.profiles(id)
imported_at       timestamptz NOT NULL default now()
total_ex_vat      numeric(16,2)
vat_amount        numeric(16,2)
total_incl_vat    numeric(16,2)
line_item_count   int NOT NULL default 0
is_current        boolean NOT NULL default true
created_at/updated_at timestamptz
```
Partial unique index: **one** `is_current = true` per `project_id`.

**`projects.boq_sections`** — the bill/section/category tree

```
id                 uuid PK
import_id          uuid NOT NULL REFERENCES projects.boq_imports(id) ON DELETE CASCADE
parent_section_id  uuid REFERENCES projects.boq_sections(id) ON DELETE CASCADE
kind               text NOT NULL CHECK (kind IN ('bill','section','category'))
code               text                      -- 'MALL', '7', 'C', 'C1' …
title              text NOT NULL
sort_order         int NOT NULL default 0
node_id            uuid                      -- link-later hook → structure.nodes(id); NULL in Phase 1
created_at/updated_at
```
Roots (`parent_section_id IS NULL`) are the **bills** (`kind='bill'`): Mall portion + each tenant. Same-import parent enforced via composite FK `(import_id, parent_section_id) → (import_id, id)`; self-parent CHECK.

**`projects.boq_items`** — priced leaf rows

```
id              uuid PK
section_id      uuid NOT NULL REFERENCES projects.boq_sections(id) ON DELETE CASCADE
code            text                         -- 'C1.1'
description     text NOT NULL
unit            text                         -- 'm','No','Sum'
quantity        numeric(14,3)                -- NULL when not measured
quantity_mode   text NOT NULL DEFAULT 'measured'
                  CHECK (quantity_mode IN ('measured','rate_only','lump_sum','provisional','pc_sum'))
rate_model      text NOT NULL DEFAULT 'supply_install'
                  CHECK (rate_model IN ('supply_install','single','amount_only'))
supply_rate     numeric(14,4)
install_rate    numeric(14,4)
rate            numeric(14,4)                -- single-rate model
amount          numeric(16,2)                -- stored leaf value
sort_order      int NOT NULL default 0
created_at/updated_at
```

**Rollups** (section + bill totals) are computed on read via a recursive CTE / service-layer aggregation — **no rollup triggers** (avoids a dual source of truth, per the multiple-drawings lesson). Stored `amount` is the leaf truth; group totals are derived.

**Amount rule:** for `rate_model='supply_install'`, `amount = round(quantity × (coalesce(supply_rate,0)+coalesce(install_rate,0)), 2)`; for `'single'`, `quantity × rate`; for `'amount_only'`, the imported amount is stored directly. `quantity_mode IN ('rate_only')` ⇒ `amount = NULL`.

**RLS** (mirrors `00101`): SELECT for active org members in `COST_VIEW_ROLES`; INSERT/UPDATE/DELETE for `owner/admin/project_manager`. `updated_at` triggers via `public.set_updated_at()`.

**Storage:** a private `boq-imports` bucket (org-scoped RLS, pattern from `00117`'s `reports` bucket) holds the original `.xlsx` for audit. Storing the source is optional per-import (`storage_path` nullable); parsing happens from the in-memory upload regardless.

### 5.2 The importer — `apps/web/src/lib/boq/` (web-only, Node runtime)

Kept out of `packages/shared` so the `xlsx` (SheetJS) dependency never reaches the mobile bundle (the report-engine bundle lesson). New dep: `pnpm --filter web add xlsx`.

Modules:
- **`types.ts`** — `ParsedBoq`, `ParsedBill`, `ParsedSection`, `ParsedItem`, `ReconciliationReport`.
- **`classify-sheet.ts`** — pure: given a worksheet, classify as `bill | summary | prose`, locate the header row, and resolve the column map tolerating `SUPPLY/INSTALL` vs `RATE` vs amount-only and the `ITEA`/`SUPPLY RATE` noise.
- **`parse-boq-xlsx.ts`** — orchestration: read workbook → use the **Main Summary as the authoritative bill index** (order + expected totals) → map sheets to bills by the leading-number convention (`1.x` → Mall portion; `N-NN Name` → tenant bill) → within each sheet, walk rows distinguishing **category headers** (`C1`, no qty/rate) from **line items** (`C1.1`, priced) from **rate-note prose** ("Rates to include…") → emit the section tree + items.
- **`reconcile.ts`** — pure: recompute every leaf amount and every section/bill rollup; compare against the sheet's stored `AMOUNT`, the `1.17 Mall Summary` letters, and the `Main Summary` bill totals (tolerance ±R1 / ±0.5% for float/rounding). Returns a `ReconciliationReport`: matched totals, mismatches (sheet, code, expected vs computed), unparseable rows, and skipped sheets. **Mismatches are surfaced, never silently swallowed.**

All parser logic is **pure and unit-testable** (workbook in → structures out); the only impure shell is `xlsx.read(buffer)`.

### 5.3 Import flow

1. User clicks **Import** (gated `COST_VIEW_ROLES`) → file picker (`.xlsx`).
2. `POST /api/projects/[id]/boq/import` (Node runtime) — `requireRoleAPI(COST_VIEW_ROLES, projectOrgId)`; reads the multipart upload; parses + reconciles; returns the `ReconciliationReport` + a parse token (does **not** persist yet).
3. UI shows the **reconciliation preview** (grand total vs R58.72m, per-bill matches, any warnings).
4. User confirms → `importBoqAction(projectId, …)` persists: new `boq_imports` row (`is_current=true`, prior flipped to `false`), the section tree, the items; optionally uploads the original to `boq-imports`. Service-role writes behind `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)`.
5. `revalidatePath`/tag the rates tab.

### 5.4 Server actions — `apps/web/src/actions/boq.actions.ts`

- `importBoqAction(projectId, parsed, opts)` → persist a parsed BOQ (D4 replace semantics).
- `listBoqAction(projectId)` → current import + section tree + items + computed rollups (read gate = `COST_VIEW_ROLES` via `requireEffectiveRole`; names/audit resolved with the service client after the gate, per the recurring profiles-RLS lesson).
- `updateBoqItemRateAction(projectId, itemId, { supplyRate?, installRate?, rate? })` → edit a rate, recompute + store `amount`. Cross-project guard: the item's `section.import.project_id` must equal `projectId`.
- `deleteBoqImportAction(projectId, importId)` → owner/admin/PM; removes a non-current import (audit cleanup).

Each action resolves project → org → role-gate before touching the DB, and returns `{ data } | { error }` (the established `project-settings.actions.ts` shape).

### 5.5 Shared service + schema

- **`packages/shared/src/schemas/boq.schema.ts`** — Zod for `BoqImport`, `BoqSection`, `BoqItem`, the patch types, and `boqItemRatePatchSchema`. Enums mirror the CHECK constraints.
- **`packages/shared/src/services/boq.service.ts`** — `getCurrent(client, projectId)`, `getTree(client, importId)`, `persistImport(client, …)`, `updateItemRate(client, …)`, `setCurrent(client, …)`, `computeRollups(sections, items)` (pure). Heavy `xlsx` parsing stays in `apps/web` — the service only takes already-parsed structures.
- **`packages/shared/src/services/_boq-mappers.ts`** — snake_case ↔ camelCase row mappers (the `_*-mappers.ts` convention), with numeric coercion.

`computeRollups` is pure and unit-tested — it is the heart of the displayed totals.

### 5.6 UI — `apps/web/src/app/(admin)/projects/[id]/settings/rates/`

`page.tsx` (server): resolve project → `requireEffectiveRole(COST_VIEW_ROLES)` → fetch current BOQ via `listBoqAction` → render. Empty state when no import yet ("Import your tender BOQ").

Components (`_components/`), master-detail like the Equipment & Materials tab:
- **`RatesTab.tsx`** — shell + Import button + empty/loaded states.
- **`BoqMainSummary.tsx`** — bill list with totals + grand total ex/incl VAT (the landing).
- **`BoqSectionTree.tsx`** — drill bill → section → category.
- **`BoqLineItemTable.tsx`** — `code · desc · unit · qty · supply · install · amount`; `RATE ONLY`/provisional/PC badges (badge variants `info`/`warning`); natural-sorted via `natural-compare.ts`.
- **`RateCell.tsx`** — inline supply/install edit with live amount recompute (edit gate = `COST_VIEW_ROLES`; read-only cells otherwise).
- **`BoqImportDialog.tsx`** + **`BoqReconciliationReport.tsx`** — upload → preview reconciliation → confirm. Uses `previewViaSignedUrl` (`file-open.ts`) for the stored source download.

UI uses `Card/CardHeader/CardBody`, CSS-var styling, `[id]` routes — per conventions.

### 5.7 Tab registration

- `settings/_components/SettingsTabs.tsx`: add `{ slug: 'rates', label: 'Rates', viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES }` to `TABS`; extend the `Slug` union with `'rates'`. The 🔒 marker shows automatically for view-but-not-edit (here the sets are equal, so it won't appear for COST roles).
- `docs/rbac-matrix.md`: add the Rates row in the **same PR** (project convention).

---

## 6. RBAC matrix addition

| Route | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `/projects/[id]/settings/rates` (view+edit) | ✅ | ✅ | ✅ | — | — | — | — |
| `POST /api/projects/[id]/boq/import` | ✅ | ✅ | ✅ | — | — | — | — |

All gates use `requireEffectiveRole` / `requireRoleAPI` with `COST_VIEW_ROLES` from `@esite/shared`; no hardcoded role arrays.

---

## 7. Testing strategy

- **Parser (pure):** unit tests against small fixtures derived from this file — a supply/install sheet, a single-rate sheet (`P&G`), an amount-only sheet (`Sundries`), RATE-ONLY rows, a summary sheet, and the `ITEA`/`SUPPLY RATE` typo headers. Assert classification, column mapping, tree shape, and `quantity_mode`/`rate_model` tagging.
- **Reconciliation:** assert the full-file grand total reconciles to **R58,724,268.76 incl-VAT** within tolerance, the Mall portion to **R37,184,510.62**, and that a deliberately corrupted amount is flagged.
- **`computeRollups` + mappers:** pure unit tests.
- **Service + actions:** mocked-client unit tests (RBAC gate, replace semantics on re-import, cross-project guard on `updateBoqItemRateAction`) — use `vi.hoisted` for mocks (the `next/cache` hoisting trap).
- **Migration:** transactional, ROLLBACK-safe smoke test via `scripts/db/mgmt-api.sh` — tables exist, RLS enabled, policies present, `is_current` partial-unique enforced, cascade from `projects.projects` works.

---

## 8. Risks & open items

- **Parser robustness vs source noise** is the main risk. Mitigation: the reconciliation report is the safety net — the user confirms against a number they recognise (R58.72m) before anything persists; unparseable rows are listed, not dropped.
- **Sheet→bill mapping** relies on the leading-number convention (`1.x` Mall, `N-NN` tenant) cross-checked against the Main Summary. If a future export renames sheets, the Main Summary index still drives reconciliation.
- **Mall section letters** (A–P) map to sheets non-positionally (K–N are several "associated installation" sheets); the parser reconciles by the Mall Summary's titles/amounts rather than assuming order.
- **`xlsx` (SheetJS) dependency** — pin the version; web-only; confirm it tree-shakes out of the mobile build (it should never be imported there).
- **VAT** is stored at the import header only (15% ZA); not modelled per line.
- Storing the original `.xlsx` (`boq-imports` bucket) is included for audit; if it complicates the migration it can drop to a fast-follow without changing the table model.

---

## 9. File manifest (Phase 1)

**DB**
- `apps/edge-functions/supabase/migrations/00122_project_boq_rates.sql`
- `scripts/db/smoke-test-project-boq.sh`

**Shared (`packages/shared/src/`)**
- `schemas/boq.schema.ts`
- `services/boq.service.ts`
- `services/_boq-mappers.ts`
- barrel export additions

**Web (`apps/web/src/`)**
- `lib/boq/{types,classify-sheet,parse-boq-xlsx,reconcile}.ts` (+ tests)
- `actions/boq.actions.ts` (+ tests)
- `app/api/projects/[id]/boq/import/route.ts`
- `app/(admin)/projects/[id]/settings/rates/page.tsx`
- `app/(admin)/projects/[id]/settings/rates/_components/{RatesTab,BoqMainSummary,BoqSectionTree,BoqLineItemTable,RateCell,BoqImportDialog,BoqReconciliationReport}.tsx`
- edit `app/(admin)/projects/[id]/settings/_components/SettingsTabs.tsx`
- `package.json` — add `xlsx`

**Docs**
- `docs/rbac-matrix.md` — Rates rows

---

## 10. Out of scope (Phase 1)

- Variation orders, remeasures, revised-vs-baseline reporting (Phase 2).
- Valuations, % complete, payment certificates (Phase 3).
- Activating `node_id` links to structure/materials (Phase 4).
- Mobile UI (web-first, consistent with snags/inspections export).
- Editing item descriptions/quantities/structure in Phase 1 — **rates only** are editable (quantities are contract-fixed until Phase 2's variation flow).
