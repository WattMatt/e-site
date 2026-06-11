# Rates Phase 2b — Variations & Remeasures — Design Spec

**Date:** 2026-06-11
**Status:** Approved (design). Second Phase-2 sub-project (after Valuations, `2026-06-10-rates-valuations-payment-certificates-design.md`).
**Builds on:** Phase 1 Rates/BOQ (`00122`) and Phase 2a Valuations (`00132`).

---

## 1. Problem & motivation

The contract BOQ is frozen at import, and v1 valuations deliberately cap every item at its contract amount. Three real-world things therefore can't be done yet:

1. **Measure the RATE-ONLY items** (~624 in KINGSWALK) — rate fixed at tender, quantity measured during the works. Until measured they carry no value and can only be valued ad-hoc by quantity with no contractual ceiling.
2. **Over-measure** — actual quantity exceeds the billed quantity. Valuations currently cap + warn; there's no way to formalise the extra.
3. **Scope changes** — additional work, omitted work. No mechanism at all.

A QS handles all three with **variation orders**: numbered, dated, approved instruments that adjust the contract. The revised contract value (contract + approved variations) is what valuations and payment certificates should work against.

---

## 2. Locked design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | **A VO is a dated, numbered, lockable entity** | `projects.variation_orders` mirrors the valuations shape: per-project auto `vo_no`, `vo_date`, title/reason, `draft → approved` lifecycle. **Approve = lock** (immutable; no un-approve; drafts deletable). Multiple drafts may coexist (no sequencing requirement — unlike valuations, VOs have no carry-forward semantics). |
| D2 | **Two line kinds, no rate changes** | A `variation_lines` row is either **`adjust`** (a ± quantity delta on an existing `boq_item`, always priced at the contract rate — covers remeasure incl. RATE-ONLY measurement, over-measure, and omission via negative) or **`add`** (a new priced item under an existing BOQ section). Rate-changes on existing items are **deferred** (contractually contentious under JBCC; complicates the money model). |
| D3 | **The contract BOQ is never mutated; revised = pure compute + materialize-on-approve** | Adjustments never write to `boq_items` — the revised position is computed (`computeRevisedItem`). On **approve**, a VO's `add` lines materialize as real `boq_items` rows flagged `origin='variation'` (FK back to the variation line), so valuations/rollups/reports work on the existing item machinery unchanged while contract-vs-revised stays separable. |
| D4 | **Value against revised immediately** | An approved VO immediately moves each affected item's valuation cap from contract to **revised** amount; materialized `add` items become valuable lines; the certificate shows the revised contract value. |
| D5 | **Placement & RBAC** | A **"Variations"** settings tab next to Rates/Valuations. View/edit/approve gated to `COST_VIEW_ROLES`; delete (draft-only) gated `ORG_WRITE_ROLES`. |

---

## 3. Scope

**v1 (this spec):** variation orders with the two line kinds; RATE-ONLY measurement; omissions (negative deltas, floored so a revised quantity can't go below 0); approve-lock + materialize; **Contract | Revised** rollups on the Rates tab; the valuations cap moves to revised; the certificate gains the contract → +variations → revised summary lines; a Variations settings tab.

**Deferred:** rate changes on existing items; VO document attachments; client/engineer approval workflow beyond the internal lock; CPA/escalation; deleting/reversing an approved VO (issue a counter-VO instead — standard QS practice).

---

## 4. Architecture

### 4.1 Data model — migration `00133_project_variations.sql` (verify the number at build), schema `projects`

**`projects.variation_orders`**
```
id                uuid PK default gen_random_uuid()
project_id        uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE
organisation_id   uuid NOT NULL REFERENCES public.organisations(id)
boq_import_id     uuid NOT NULL REFERENCES projects.boq_imports(id)
vo_no             int NOT NULL DEFAULT 0          -- per-project auto trigger (mirror 00132 valuations_set_no)
vo_date           date NOT NULL
title             text NOT NULL
reason            text
status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved'))
net_change        numeric(16,2)                   -- snapshot on approve (Σ line value_change)
approved_by       uuid REFERENCES public.profiles(id)
approved_at       timestamptz
created_by        uuid REFERENCES public.profiles(id)
created_at/updated_at timestamptz
```
Unique `(project_id, vo_no)`; `variation_orders_set_no` BEFORE INSERT trigger.

**`projects.variation_lines`**
```
id                   uuid PK
variation_order_id   uuid NOT NULL REFERENCES projects.variation_orders(id) ON DELETE CASCADE
kind                 text NOT NULL CHECK (kind IN ('adjust','add'))
-- adjust:
boq_item_id          uuid REFERENCES projects.boq_items(id) ON DELETE CASCADE   -- NOT NULL when kind='adjust'
qty_delta            numeric(14,3)                                              -- ± quantity at the contract rate
-- add:
section_id           uuid REFERENCES projects.boq_sections(id)                  -- NOT NULL when kind='add'
code                 text
description          text
unit                 text
quantity             numeric(14,3)
rate_model           text CHECK (rate_model IN ('supply_install','single'))
supply_rate          numeric(14,4)
install_rate         numeric(14,4)
rate                 numeric(14,4)
-- both:
value_change         numeric(16,2) NOT NULL       -- canonical money effect (pure-computed, stored)
materialized_item_id uuid REFERENCES projects.boq_items(id)                     -- set on approve (kind='add')
created_at/updated_at
CHECK ((kind='adjust' AND boq_item_id IS NOT NULL) OR (kind='add' AND section_id IS NOT NULL AND description IS NOT NULL))
```

**`projects.boq_items` gains two columns** (same migration): `origin text NOT NULL DEFAULT 'contract' CHECK (origin IN ('contract','variation'))` and `variation_line_id uuid REFERENCES projects.variation_lines(id)`. Existing rows stay `'contract'`. **Contract totals = `origin='contract'` items at contract quantities; revised totals = all items with approved adjustments applied.**

RLS mirrors `00132` (select = `user_has_project_access`; modify = owner/admin/PM; lines resolve the project via the `variation_orders` EXISTS chain). All idempotent.

### 4.2 Pure compute (in `@esite/shared` `variation.service.ts` — every money figure originates here)

- `computeLineChange(line, item?)` → `value_change`:
  - `adjust`: `round2(qty_delta × effectiveContractRate(item))` (supply+install or single — same rule as `computeLineValue`). For RATE-ONLY items the contract amount is null, so the delta IS the measurement. Negative deltas floored: a revised quantity can't go below 0 (`qty_delta ≥ −(contract qty)`; for RATE-ONLY, `≥ −(previously approved deltas)`).
  - `add`: `round2(quantity × effectiveRate(line))`.
- `computeRevisedItem(item, approvedDeltas: number[])` → `{ revisedQty, revisedAmount }`: contract qty + Σ deltas, × contract rate; `amount_only` items pass through (adjusting them = a future `add`-style VO line, not v1); RATE-ONLY: revised = Σ deltas × rate.
- `computeRevisedRollups(sections, items, adjustmentsByItem)` → the **Revised** column (reuses the `computeRollups` tree-walk over revised amounts).
- `revisedContractValue = contractTotal + Σ approved VOs' net_change` — shown on the Rates tab + the certificate.

### 4.3 Valuations integration (the D4 wiring)

- `computeLineValue` gains an optional `revisedAmount`/`revisedQty` cap parameter (default = current behaviour): percent lines compute against the **revised** amount; quantity lines cap at the revised amount. The action layer (`updateValuationLineAction`/`getValuationAction`) resolves approved adjustments per item (one query over approved VOs' lines) and passes the revised figures. `isOverMeasure` compares against the revised quantity — the warning's tooltip becomes "raise a variation order".
- Materialized `add` items are ordinary `boq_items` → already valuable, already in the tree, zero valuation-code changes.
- The certificate summary gains three lines above Gross: **Contract value (as imported)** / **+ Approved variations** / **= Revised contract value** (gatherer pulls `boq_imports.total_ex_vat` + Σ approved `net_change`).

### 4.4 Actions — `apps/web/src/actions/variation.actions.ts` (mirror `valuation.actions.ts` exactly)

`listVariationOrdersAction` · `getVariationOrderAction` (VO + lines + live net change) · `createVariationOrderAction(projectId, {date,title,reason})` · `upsertVariationLineAction` (refuse if approved; validate the kind-specific fields; compute `value_change`) · `deleteVariationLineAction` (draft only) · `approveVariationOrderAction` (snapshot `net_change`, **materialize `add` lines as `boq_items`** with `origin='variation'`+`variation_line_id`+`sort_order` appended to the section, set `materialized_item_id`, lock) · `deleteVariationOrderAction` (`ORG_WRITE_ROLES`, draft only). Every action: `requireEffectiveRole(COST_VIEW_ROLES)` first, cross-project guard via the VO's `project_id`, `{data}|{error}`, `revalidatePath`.

### 4.5 UI

- **Variations tab** (`settings/variations/`, registered after Valuations, `COST_VIEW_ROLES`): VO list (no., date, title, status, net change) + **New VO**; VO detail = lines editor — *Adjust*: pick a BOQ item (searchable, shows contract qty/rate + already-approved deltas) → enter ± qty → live value change; *Add*: pick a section → description/unit/qty/rates → live value. ApproveBar (confirm → lock). Approved VOs read-only.
- **Rates tab**: when any approved VO exists, the summary/bill/section rows show **Contract | Revised** (revised via `computeRevisedRollups`); materialized items get a `variation` badge.
- **Valuations tab**: progress caps move to revised automatically (no UI change beyond the over-measure tooltip).

### 4.6 RBAC matrix additions

`/projects/[id]/settings/variations` — owner/admin/PM (W); all others —.

---

## 5. Testing

- **Pure compute (priority):** `computeLineChange` (adjust ± at contract rate; RATE-ONLY measurement; the ≥0 revised-qty floor; add-line pricing), `computeRevisedItem`/`computeRevisedRollups` (contract vs revised), and the revised-cap behaviour of `computeLineValue`.
- **Service/actions:** mocked-client (`vi.hoisted`); cross-project guards; approve materializes `add` lines correctly (origin/FK/section placement) and refuses re-approve; draft-only deletes.
- **Migration:** transactional ROLLBACK-safe smoke test (tables, RLS, `vo_no` trigger, the `boq_items` columns).
- **Integration check at build end (real data):** on KINGSWALK — measure one RATE-ONLY item via a VO, approve, confirm the Rates tab shows Contract|Revised, the item becomes valuable in a draft valuation, and the certificate shows the revised contract value.

---

## 6. File manifest

**DB:** `apps/edge-functions/supabase/migrations/00133_project_variations.sql`; `scripts/db/smoke-test-project-variations.sh`.
**Shared:** `packages/shared/src/schemas/variation.schema.ts`; `services/variation.service.ts` (pure + client); `services/_variation-mappers.ts`; the `computeLineValue` revised-cap parameter in `valuation.service.ts`; barrel exports.
**Web:** `apps/web/src/actions/variation.actions.ts` (+tests); revised-cap wiring in `valuation.actions.ts`; the certificate gatherer's revised-contract lines (`valuation-report-data.ts` + `valuation-report.tsx`); `app/(admin)/projects/[id]/settings/variations/` page + `_components/{VariationsList,VariationDetail,VariationLineEditor,ApproveBar}.tsx`; Contract|Revised columns in the Rates `_components`; `SettingsTabs.tsx` (+1 tab, count test → 15); `docs/rbac-matrix.md`.

---

## 7. Out of scope (v1)

Rate changes on existing items; reversing approved VOs (counter-VO instead); VO attachments; external approval workflows; adjusting `amount_only` items via `adjust` lines (use an `add`/omission pair); mobile.
