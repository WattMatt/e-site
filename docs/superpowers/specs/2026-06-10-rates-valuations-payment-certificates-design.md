# Rates Phase 2a — Valuations & Payment Certificates — Design Spec

**Date:** 2026-06-10
**Status:** Approved (design). First of two Phase-2 sub-projects (Valuations first, then Variations/remeasures — separate spec).
**Builds on:** the Phase-1 Rates/BOQ feature (`2026-06-08-project-rates-boq-design.md`; migration `00122`; `projects.boq_imports`/`boq_sections`/`boq_items`).

---

## 1. Problem & motivation

A contractor's cash flow runs on **interim payment certificates**: each period you value the work done to date against the contract BOQ, deduct retention and what was already certified, and claim the balance. E-Site now holds the priced BOQ (Phase 1) but has no way to value progress or produce a certificate.

This sub-project adds **dated valuations** and the **payment certificate** they produce. It deliberately excludes variations/remeasures of the BOQ itself (the second Phase-2 sub-project); v1 values the current contract BOQ.

---

## 2. Locked design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | **Sequence** | Valuations before Variations (each its own spec→plan→build). This spec = Valuations. |
| D2 | **Model is a dated event** | A *valuation* is a dated checkpoint (mirrors `field.snag_visits`); progress **carries forward** — valuation N pre-fills from N-1, you adjust upward. |
| D3 | **Open to ALL progress methods** | Storage is method-agnostic: every method collapses to one canonical `value_to_date` per item. The UI offers per-item %, per-item measured quantity, and section-level % — mixable within one valuation. |
| D4 | **Certify = lock** | A `draft` valuation is editable; **Certify** snapshots the figures, generates + saves the certificate PDF, and marks it `certified` (immutable). Re-issue creates a new certificate version (supersede). It becomes the "previous" for the next valuation. |
| D5 | **Certificate = a report kind** | The certificate is a `valuation` kind on the existing react-pdf report engine (`gather → doc → render → persist to projects.reports`), reusing the branded `Cover` (like snag-visit/inspection/generator reports). |
| D6 | **Placement & RBAC** | A new **"Valuations"** tab in the project **settings** area, next to **Rates** (cohesion with the BOQ it values; reuses the COST-gated settings shell). View/edit/certify gated to `COST_VIEW_ROLES` (owner/admin/PM). |
| D7 | **Retention v1** | Simple percentage from `project_settings.retention_pct` (default 5.0), snapshotted per valuation. JBCC retention cap + half-release at practical completion is **deferred**. |

---

## 3. Scope

**v1 (this spec):** dated valuations with carry-forward; all three progress-entry methods; the per-item `value_to_date` model; the interim payment-certificate math (gross-to-date − retention − previously-certified = due + VAT); the branded certificate PDF (a `valuation` report kind, persisted/superseded); draft→certify lifecycle; a Valuations settings tab.

**Deferred:** valuing variations/remeasures (the BOQ stays as imported — the second Phase-2 sub-project); JBCC retention cap + half-release at PC; materials-on-site; contract price adjustment (CPA/escalation); multi-currency (ZAR only).

---

## 4. Architecture

### 4.1 The dated-event + carry-forward model

A **valuation** is a sequential, dated checkpoint per project (`valuation_no` 1, 2, 3…), exactly like a `snag_visit`. At each one, the contractor records how far each BOQ item has progressed. The next valuation **pre-fills** from the previous (each line's % / quantity), so only changed lines need touching. The **payment certificate** for valuation N is the formal output: the cumulative value certified-to-date at N, minus retention, minus the net certified at N-1, plus VAT.

This reuses the proven snag-visit shape: a dated parent event + per-target lines + a pure compute function + a report kind. No triggers compute money (a dual-source trap, per the multiple-drawings lesson) — money is computed by a pure function and snapshotted only on Certify.

### 4.2 Data model — migration `00127_project_valuations.sql`, schema `projects`

(Verify the number at build — concurrent sessions are adding migrations; 00126 is the current max. Adding tables to the existing `projects` schema needs only `NOTIFY pgrst, 'reload schema'`.)

**`projects.valuations`** — the dated event (one row per valuation per project)
```
id                 uuid PK default gen_random_uuid()
project_id         uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE
organisation_id    uuid NOT NULL REFERENCES public.organisations(id)
boq_import_id      uuid NOT NULL REFERENCES projects.boq_imports(id)   -- the import it values
valuation_no       int NOT NULL                                        -- 1,2,3… per project (trigger, like snag visit_no)
valuation_date     date NOT NULL
status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','certified'))
retention_pct      numeric(5,2) NOT NULL                               -- snapshot of project_settings at create
-- figures snapshotted on Certify (NULL while draft; computed live for display):
gross_to_date      numeric(16,2)
retention_amount   numeric(16,2)
net_to_date        numeric(16,2)        -- gross − retention
previous_net       numeric(16,2)        -- net_to_date of valuation_no − 1 (0 for the first)
due_ex_vat         numeric(16,2)        -- net_to_date − previous_net
vat_amount         numeric(16,2)
due_incl_vat       numeric(16,2)
report_id          uuid REFERENCES projects.reports(id)               -- the certificate PDF artifact
notes              text
created_by         uuid REFERENCES public.profiles(id)
certified_by       uuid REFERENCES public.profiles(id)
certified_at       timestamptz
created_at/updated_at timestamptz NOT NULL DEFAULT now()
```
Unique `(project_id, valuation_no)`. A per-project auto-increment trigger fills `valuation_no` (mirror `00120`'s `snag_visits` numbering).

**`projects.valuation_lines`** — per BOQ item, sparse (only items with progress)
```
id               uuid PK default gen_random_uuid()
valuation_id     uuid NOT NULL REFERENCES projects.valuations(id) ON DELETE CASCADE
boq_item_id      uuid NOT NULL REFERENCES projects.boq_items(id) ON DELETE CASCADE
input_method     text NOT NULL CHECK (input_method IN ('percent','quantity','section'))
percent_complete numeric(6,3)         -- 0–100, when input_method in ('percent','section')
qty_complete     numeric(14,3)        -- cumulative quantity done, when input_method='quantity'
value_to_date    numeric(16,2) NOT NULL  -- the canonical computed value (see §4.3)
created_at/updated_at
```
Unique `(valuation_id, boq_item_id)`. Items with no line = 0 value-to-date.

RLS mirrors the `boq_*` tables: SELECT = `user_has_project_access(project_id)` (app adds the `COST_VIEW_ROLES` gate); INSERT/UPDATE/DELETE = `user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager')`. `valuation_lines` resolve the project via the `valuations`→`projects` chain (EXISTS subquery, like `boq_items`). `updated_at` triggers. All policies idempotent (`DROP … IF EXISTS`).

### 4.3 Method-agnostic value-to-date (the heart of "open to all methods")

A pure `computeLineValue(item, line)` derives `value_to_date` from the input:
- **`percent`** → `round(item.amount × percent/100, 2)`. (RATE-ONLY items have `amount=null` ⇒ percent is invalid; the UI forces `quantity` for them.)
- **`quantity`** → `round(qty_complete × effectiveRate, 2)`, where `effectiveRate = (supply_rate ?? 0)+(install_rate ?? 0)` for `supply_install`, or `rate` for `single`. Works for RATE-ONLY (you measure the quantity done).
- **`section`** → a section-level % cascaded onto each descendant item as `percent_complete`; each item's line is then computed exactly like `percent`. (Stored per item, so it's just a bulk-set convenience; the line records `input_method='section'` for provenance.)

`value_to_date` is stored (recomputed on every edit) so the certificate and rollups never re-derive money from rates. A guard clamps percent to 0–100 and `value_to_date` to `[0, item.amount]` for percent/section methods (you can't certify >100%); quantity is clamped to ≥0 (over-measure is allowed — it's a remeasurement signal, surfaced as a warning, but valuing > contract qty is a Variations concern, so v1 caps `value_to_date` at the item's contract amount and warns).

### 4.4 Certificate math — pure `computeCertificate`

`computeCertificate(lines, retentionPct, previousNet)` →
```
grossToDate   = Σ value_to_date
retention     = round(grossToDate × retentionPct/100, 2)
netToDate     = grossToDate − retention
dueExVat      = netToDate − previousNet            // this certificate's claim
vat           = round(dueExVat × 0.15, 2)
dueInclVat    = dueExVat + vat
```
Plus a **per-bill breakdown** (gross-to-date, this-period, retention per bill — using the BOQ section tree + `computeRollups`) for the certificate body. `previousNet` = the prior `certified` valuation's `net_to_date` (0 for the first). Pure + unit-tested; the single source of every money figure.

### 4.5 The certificate — a `valuation` report kind

Following `snag-visit-report-data.ts` + `snag-visit-report.tsx` + `render-*.ts` verbatim:
- **`valuation-report-data.ts`** — pure gatherer: RBAC gate, service-client name/branding resolution, the BOQ tree + the valuation's lines → the certificate figures (via `computeCertificate`) + the per-bill table. Returns a plain object; logos/photos as `data:` URIs (the react-pdf URL trap).
- **`valuation-report.tsx`** — react-pdf document reusing `Cover` + `interior.tsx` primitives: cover → per-bill schedule (gross-to-date / this-period / retention) → summary block (gross, less retention, less previous, **due ex-VAT, VAT, due incl-VAT**) → signature strip (engineer/PQS + contractor).
- **`render-valuation.ts`** — `renderToBuffer` → `Buffer` (`// @vitest-environment node` for any test that calls it).
- Persisted to `projects.reports` (kind `valuation`), superseded on re-issue. The valuation row's `report_id` points at the current artifact.

### 4.6 Shared service + schema

- **`packages/shared/src/schemas/valuation.schema.ts`** — Zod for `Valuation`, `ValuationLine`, the input-method enum, the progress-patch (`{ boqItemId, inputMethod, percentComplete?, qtyComplete? }`).
- **`packages/shared/src/services/valuation.service.ts`** — pure `computeLineValue` / `computeCertificate` (+ per-bill breakdown) and client methods: `list(projectId)`, `getCurrent`/`get(valuationId)` (+ lines), `create(projectId)` (next no., snapshot retention_pct, carry-forward lines from the previous), `upsertLine(valuationId, patch)` (recompute `value_to_date`), `certify(valuationId, …)` (snapshot figures, set status). Mappers in `_valuation-mappers.ts`.

### 4.7 Server actions — `apps/web/src/actions/valuation.actions.ts`

Mirror `boq.actions.ts`: resolve project→org, `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)`, `{ data } | { error }`, `revalidatePath`. Service-role writes behind the gate. Cross-project guards on every valuation/line id (resolve `valuation.project_id`, must equal `projectId`).
- `listValuationsAction(projectId)`, `getValuationAction(projectId, valuationId)`
- `createValuationAction(projectId, valuationDate)` — next no., carry-forward
- `updateValuationLineAction(projectId, valuationId, patch)` — one item's progress; recompute value
- `setSectionPercentAction(projectId, valuationId, sectionId, percent)` — cascade to descendant items
- `certifyValuationAction(projectId, valuationId)` — compute + snapshot + render PDF + persist report + lock
- `deleteValuationAction(projectId, valuationId)` — `ORG_WRITE_ROLES`; refuse if `certified` (audit) or only the latest draft

### 4.8 UI — `apps/web/src/app/(admin)/projects/[id]/settings/valuations/`

`page.tsx` (server): gate `COST_VIEW_ROLES`; if no `is_current` BOQ import → empty state ("Import a BOQ on the Rates tab first"); else render the valuations list. Register the tab in `SettingsTabs.tsx` (after Rates) + `docs/rbac-matrix.md`.

Components (`_components/`), mirroring the Rates tab + the snag visits-primary UI:
- **`ValuationsList`** — the sequence of valuations (no., date, status, due-incl) + **New valuation** (date picker → `createValuationAction`).
- **`ValuationDetail`** — the BOQ tree (reuse `BoqSectionTree`/`BoqLineItemTable`) with a **progress column** per item: a `%` input or a `qty` input (qty forced for RATE-ONLY), and a section-level `%` field that cascades. Live per-item `value_to_date` + running totals. Editable only while `draft`.
- **`CertificateSummary`** — the live certificate figures (gross, retention, previous, due, VAT) + per-bill table.
- **`CertifyBar`** — Certify (confirm) → locks + offers the PDF (download via `file-open.ts` `previewViaSignedUrl`). Certified valuations are read-only with a "view certificate" link.

---

## 5. RBAC matrix additions

| Route | owner | admin | PM | others |
|---|:---:|:---:|:---:|:---:|
| `/projects/[id]/settings/valuations` (view/edit/certify) | ✅ | ✅ | ✅ | — |

All gates via `requireEffectiveRole` / `requireRolePage` with `COST_VIEW_ROLES`; certificate render route (if any) via `requireRoleAPI(COST_VIEW_ROLES, projectOrgId)`.

---

## 6. Testing

- **Pure compute** (the priority): `computeLineValue` per method (percent / quantity / section; RATE-ONLY via quantity; the 0–100 / contract-amount clamps) and `computeCertificate` (gross, retention, cumulative-minus-previous, VAT, per-bill breakdown). Unit-tested exhaustively — this is where every money figure originates.
- **Service + actions**: mocked-client tests (`vi.hoisted`), the cross-project guards, carry-forward on `create`, the certify snapshot, `deleteValuationAction` refusing a certified row.
- **Migration**: transactional ROLLBACK-safe smoke test (`scripts/db/mgmt-api.sh`) — tables, RLS, policies, the `valuation_no` trigger, cascade.
- **Certificate render**: a Node-runtime render test, plus a **prod deploy-verify** of the PDF (the react-pdf/React-19 `renderToBuffer` trap — see [report-engine-react19]).

---

## 7. File manifest

**DB:** `apps/edge-functions/supabase/migrations/00127_project_valuations.sql`; `scripts/db/smoke-test-project-valuations.sh`.
**Shared:** `packages/shared/src/schemas/valuation.schema.ts`; `services/valuation.service.ts`; `services/_valuation-mappers.ts`; barrel exports.
**Web:** `apps/web/src/actions/valuation.actions.ts` (+tests); `apps/web/src/lib/reports/{valuation-report-data.ts, valuation-report.tsx, render-valuation.ts}` (+tests); `app/(admin)/projects/[id]/settings/valuations/page.tsx` + `_components/{ValuationsList,ValuationDetail,CertificateSummary,CertifyBar}.tsx`; edit `settings/_components/SettingsTabs.tsx`; `docs/rbac-matrix.md`.

---

## 8. Out of scope (this sub-project)

- Variations / remeasures of the BOQ (the second Phase-2 sub-project) — v1 values the contract BOQ as imported; over-measure is clamped + warned, not actioned.
- JBCC retention cap + half-release at practical completion; materials-on-site; CPA/escalation; non-ZAR currency.
- Mobile UI (web-first, consistent with the rest of Rates).
