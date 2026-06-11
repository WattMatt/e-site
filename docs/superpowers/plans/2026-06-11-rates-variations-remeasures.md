# Rates Phase 2b — Variations & Remeasures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered, lockable **variation orders** (qty adjustments at contract rates + new items) that produce a **revised** contract position — measuring RATE-ONLY items, formalising over-measure/omissions — with valuations capping at revised amounts and the payment certificate showing *Contract → + Variations → = Revised*.

**Architecture:** `projects.variation_orders` + `variation_lines` mirror the valuations dated-event shape (per-project `vo_no` trigger, draft→approved lock). The contract BOQ is never mutated: adjustments are pure-computed overlays (`computeRevisedItem`), and `add` lines **materialize as `boq_items` rows flagged `origin='variation'` on approve** so valuations/rollups/certificates work on the existing item machinery unchanged. All money originates in pure fns in `@esite/shared`.

**Tech Stack:** Next.js 15, TypeScript, Supabase Postgres (RLS), `@esite/shared`, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-11-rates-variations-remeasures-design.md`

---

## Design conventions (every task follows these)

- **Worktree/branch:** all work in `/Users/spud/.config/superpowers/worktrees/esite/rates-variations` on `feat/rates-variations`. NEVER the main checkout. Confirm `git branch --show-current` before each commit.
- **Migration:** target **`00133`** — confirm the next free number at build (`ls apps/edge-functions/supabase/migrations/ | sort | tail -3`); concurrent sessions add migrations (00127 was lost this way; 2a shipped as 00132). Idempotent everything (`DROP … IF EXISTS` before every trigger/policy; `IF NOT EXISTS` tables/indexes; the `DROP CONSTRAINT IF EXISTS … ADD` idiom for CHECKs). Adding tables/columns to `projects` needs only `NOTIFY pgrst, 'reload schema'`.
- **RBAC:** `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)` first in every action; `ORG_WRITE_ROLES` for the draft-only VO delete; cross-project guard (resolve the VO's `project_id` via the service client, reject `{ error: 'Not found' }` on mismatch) BEFORE any write; service-role writes behind the gate.
- **Money:** every figure originates in the pure fns (`computeLineChange`, `computeRevisedItem`, the revised-cap in `computeLineValue`). `value_change` is stored per line (recomputed on edit); `net_change` snapshots on approve. No money in triggers.
- **Reads >1000 rows paginate** (`.range()` loop — copy `boqService.getTree`'s `fetchAll`; approved variation lines can grow).
- **Tests:** vitest; `vi.hoisted` for web action mocks; `// @vitest-environment node` where `Buffer`/render is used. Shared: `pnpm --filter @esite/shared test`; web: `pnpm --filter web test`; both `type-check`s.
- **Commit** per green step (`feat(variations): …`).

---

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00133_project_variations.sql` | VO tables + `boq_items.origin`/`variation_line_id` + RLS + `vo_no` trigger |
| `scripts/db/smoke-test-project-variations.sh` | transactional smoke test |
| `packages/shared/src/schemas/variation.schema.ts` | Zod + enums + types |
| `packages/shared/src/services/_variation-mappers.ts` | row ↔ domain |
| `packages/shared/src/services/variation.service.ts` | pure `computeLineChange`/`computeRevisedItem`/`computeRevisedRollups` + `variationService` client methods |
| `packages/shared/src/services/valuation.service.ts` | MODIFY: optional revised-cap param on `computeLineValue` + `isOverMeasure` |
| `packages/shared/src/schemas/boq.schema.ts` | MODIFY: `origin`/`variationLineId` on `boqItemSchema` (+ mapper) |
| `apps/web/src/actions/variation.actions.ts` | RBAC-gated VO actions incl. approve-materialize |
| `apps/web/src/actions/valuation.actions.ts` | MODIFY: pass revised caps |
| `apps/web/src/lib/reports/valuation-report-data.ts` + `valuation-report.tsx` | MODIFY: Contract → +Variations → =Revised summary lines |
| `app/(admin)/projects/[id]/settings/variations/page.tsx` + `_components/{VariationsList,VariationDetail,VariationLineEditor,ApproveBar}.tsx` | the Variations tab |
| Rates `_components/{BoqMainSummary,BoqSectionTree,BoqLineItemTable}.tsx` | MODIFY: Contract | Revised columns + `variation` badge |
| `settings/_components/SettingsTabs.tsx` (+test) | register the tab (count → 15) |
| `docs/rbac-matrix.md` | Variations row |

---

## Task 0: Baseline

- [ ] **Step 1:** In the worktree: `git branch --show-current` → `feat/rates-variations`; `pnpm install` (worktree deps); `pnpm --filter @esite/shared test` + `pnpm --filter web type-check` green (attribute later failures correctly). No commit.

---

## Task 1: Migration `00133` + smoke test

**Files:** Create `apps/edge-functions/supabase/migrations/00133_project_variations.sql`, `scripts/db/smoke-test-project-variations.sh`.

- [ ] **Step 1: Verify `00133` is free** (`ls … | tail -3`; if taken, use the next free number consistently and report it).
- [ ] **Step 2: Write the migration**

```sql
-- 00133_project_variations.sql — variation orders + lines; boq_items origin columns.
BEGIN;

CREATE TABLE IF NOT EXISTS projects.variation_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  boq_import_id    uuid NOT NULL REFERENCES projects.boq_imports(id),
  vo_no            int  NOT NULL DEFAULT 0,
  vo_date          date NOT NULL,
  title            text NOT NULL,
  reason           text,
  status           text NOT NULL DEFAULT 'draft',
  net_change       numeric(16,2),
  approved_by      uuid REFERENCES public.profiles(id),
  approved_at      timestamptz,
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.variation_orders DROP CONSTRAINT IF EXISTS variation_orders_status_check;
ALTER TABLE projects.variation_orders ADD CONSTRAINT variation_orders_status_check CHECK (status IN ('draft','approved'));
CREATE UNIQUE INDEX IF NOT EXISTS variation_orders_project_no ON projects.variation_orders(project_id, vo_no);
CREATE INDEX IF NOT EXISTS variation_orders_project_idx ON projects.variation_orders(project_id);

CREATE OR REPLACE FUNCTION projects.variation_orders_set_no() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.vo_no = 0 OR NEW.vo_no IS NULL THEN
    SELECT COALESCE(MAX(vo_no), 0) + 1 INTO NEW.vo_no
      FROM projects.variation_orders WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS variation_orders_set_no ON projects.variation_orders;
CREATE TRIGGER variation_orders_set_no BEFORE INSERT ON projects.variation_orders
  FOR EACH ROW EXECUTE FUNCTION projects.variation_orders_set_no();

CREATE TABLE IF NOT EXISTS projects.variation_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_order_id   uuid NOT NULL REFERENCES projects.variation_orders(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  boq_item_id          uuid REFERENCES projects.boq_items(id) ON DELETE CASCADE,
  qty_delta            numeric(14,3),
  section_id           uuid REFERENCES projects.boq_sections(id),
  code                 text,
  description          text,
  unit                 text,
  quantity             numeric(14,3),
  rate_model           text,
  supply_rate          numeric(14,4),
  install_rate         numeric(14,4),
  rate                 numeric(14,4),
  value_change         numeric(16,2) NOT NULL,
  materialized_item_id uuid REFERENCES projects.boq_items(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_kind_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_kind_check CHECK (kind IN ('adjust','add'));
ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_rate_model_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_rate_model_check
  CHECK (rate_model IS NULL OR rate_model IN ('supply_install','single'));
ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_kind_fields_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_kind_fields_check
  CHECK ((kind = 'adjust' AND boq_item_id IS NOT NULL)
      OR (kind = 'add' AND section_id IS NOT NULL AND description IS NOT NULL));
CREATE INDEX IF NOT EXISTS variation_lines_vo_idx ON projects.variation_lines(variation_order_id);
CREATE INDEX IF NOT EXISTS variation_lines_item_idx ON projects.variation_lines(boq_item_id);

-- boq_items: provenance columns (additive; existing rows stay 'contract')
ALTER TABLE projects.boq_items ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'contract';
ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_origin_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_origin_check CHECK (origin IN ('contract','variation'));
ALTER TABLE projects.boq_items ADD COLUMN IF NOT EXISTS variation_line_id uuid REFERENCES projects.variation_lines(id);

DROP TRIGGER IF EXISTS variation_orders_set_updated_at ON projects.variation_orders;
CREATE TRIGGER variation_orders_set_updated_at BEFORE UPDATE ON projects.variation_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS variation_lines_set_updated_at ON projects.variation_lines;
CREATE TRIGGER variation_lines_set_updated_at BEFORE UPDATE ON projects.variation_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.variation_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.variation_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS variation_orders_select ON projects.variation_orders;
CREATE POLICY variation_orders_select ON projects.variation_orders FOR SELECT
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS variation_orders_modify ON projects.variation_orders;
CREATE POLICY variation_orders_modify ON projects.variation_orders FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'));

DROP POLICY IF EXISTS variation_lines_select ON projects.variation_lines;
CREATE POLICY variation_lines_select ON projects.variation_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.variation_orders v
                 WHERE v.id = variation_order_id AND public.user_has_project_access(v.project_id)));
DROP POLICY IF EXISTS variation_lines_modify ON projects.variation_lines;
CREATE POLICY variation_lines_modify ON projects.variation_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.variation_orders v WHERE v.id = variation_order_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.variation_orders v WHERE v.id = variation_order_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')));

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 3: Write the smoke test** — mirror `scripts/db/smoke-test-project-valuations.sh` (the `pass`/`fail`/`section` helpers; capture-then-grep `2>&1` sentinel). Sections: (1) both tables + RLS enabled AND `boq_items.origin`/`variation_line_id` columns exist (`information_schema.columns`); (2) 4 policies; (3) 3 triggers (`variation_orders_set_no` + 2 `updated_at`); (4) transactional DO-block — seed from `projects.boq_imports WHERE is_current LIMIT 1` (the project WITH a BOQ — the 2a lesson), insert two VOs asserting `vo_no` 1→2, insert an `adjust` line + an `add` line, then `RAISE EXCEPTION 'SMOKE_OK_ROLLBACK'`. `chmod +x`.
- [ ] **Step 4:** DO NOT apply to any DB (gated; applies via the deploy workflow on merge). Sanity-check balanced BEGIN/COMMIT + every DROP precedes its CREATE.
- [ ] **Step 5: Commit** `feat(variations): migration 00133 — variation_orders/lines + boq_items origin + RLS`.

---

## Task 2: Shared schema — `variation.schema.ts` (+ `boq.schema` origin fields)

**Files:** Create `packages/shared/src/schemas/variation.schema.ts` + `.test.ts`; MODIFY `packages/shared/src/schemas/boq.schema.ts` + `packages/shared/src/services/_boq-mappers.ts`; barrel export.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { variationLineSchema, variationLinePatchSchema, VARIATION_LINE_KINDS, VO_STATUSES } from './variation.schema'

describe('variation.schema', () => {
  it('accepts an adjust line', () => {
    expect(variationLineSchema.parse({
      id: '00000000-0000-0000-0000-000000000001', variationOrderId: '00000000-0000-0000-0000-000000000002',
      kind: 'adjust', boqItemId: '00000000-0000-0000-0000-000000000003', qtyDelta: -5,
      sectionId: null, code: null, description: null, unit: null, quantity: null,
      rateModel: null, supplyRate: null, installRate: null, rate: null,
      valueChange: -500, materializedItemId: null,
    }).kind).toBe('adjust')
  })
  it('patch refines kind-specific fields', () => {
    expect(() => variationLinePatchSchema.parse({ kind: 'adjust' })).toThrow()            // needs boqItemId+qtyDelta
    expect(() => variationLinePatchSchema.parse({ kind: 'add', description: 'x' })).toThrow() // needs sectionId+quantity+a rate
    expect(variationLinePatchSchema.parse({ kind: 'adjust', boqItemId: '00000000-0000-0000-0000-000000000003', qtyDelta: 10 }).qtyDelta).toBe(10)
  })
  it('enums', () => { expect(VARIATION_LINE_KINDS).toEqual(['adjust','add']); expect(VO_STATUSES).toContain('approved') })
})
```

- [ ] **Step 2: FAIL** (`pnpm --filter @esite/shared test variation.schema`). **Step 3: Implement**

```ts
// packages/shared/src/schemas/variation.schema.ts
import { z } from 'zod'
export const VARIATION_LINE_KINDS = ['adjust', 'add'] as const
export const VO_STATUSES = ['draft', 'approved'] as const

export const variationOrderSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), organisationId: z.string().uuid(),
  boqImportId: z.string().uuid(), voNo: z.number().int(), voDate: z.string(),
  title: z.string(), reason: z.string().nullable(),
  status: z.enum(VO_STATUSES), netChange: z.number().nullable(),
  approvedBy: z.string().uuid().nullable(), approvedAt: z.string().nullable(),
})
export const variationLineSchema = z.object({
  id: z.string().uuid(), variationOrderId: z.string().uuid(), kind: z.enum(VARIATION_LINE_KINDS),
  boqItemId: z.string().uuid().nullable(), qtyDelta: z.number().nullable(),
  sectionId: z.string().uuid().nullable(), code: z.string().nullable(), description: z.string().nullable(),
  unit: z.string().nullable(), quantity: z.number().nullable(),
  rateModel: z.enum(['supply_install', 'single']).nullable(),
  supplyRate: z.number().nullable(), installRate: z.number().nullable(), rate: z.number().nullable(),
  valueChange: z.number(), materializedItemId: z.string().uuid().nullable(),
})
export const variationLinePatchSchema = z
  .object({
    kind: z.enum(VARIATION_LINE_KINDS),
    boqItemId: z.string().uuid().optional(), qtyDelta: z.number().optional(),
    sectionId: z.string().uuid().optional(), code: z.string().nullable().optional(),
    description: z.string().min(1).optional(), unit: z.string().nullable().optional(),
    quantity: z.number().nonnegative().optional(),
    rateModel: z.enum(['supply_install', 'single']).optional(),
    supplyRate: z.number().nonnegative().nullable().optional(),
    installRate: z.number().nonnegative().nullable().optional(),
    rate: z.number().nonnegative().nullable().optional(),
  })
  .refine((p) => (p.kind === 'adjust' ? p.boqItemId != null && p.qtyDelta != null : true), { message: 'adjust requires boqItemId + qtyDelta' })
  .refine((p) => (p.kind === 'add'
      ? p.sectionId != null && p.description != null && p.quantity != null
        && (p.rateModel === 'single' ? p.rate != null : p.supplyRate != null || p.installRate != null)
      : true), { message: 'add requires sectionId + description + quantity + a rate' })

export type VariationOrder = z.infer<typeof variationOrderSchema>
export type VariationLine = z.infer<typeof variationLineSchema>
export type VariationLinePatch = z.infer<typeof variationLinePatchSchema>
export type VariationLineKind = (typeof VARIATION_LINE_KINDS)[number]
export type VoStatus = (typeof VO_STATUSES)[number]
```

- [ ] **Step 4: `boq.schema.ts` + `_boq-mappers.ts`:** add `origin: z.enum(['contract','variation'])` and `variationLineId: z.string().uuid().nullable()` to `boqItemSchema`; map `origin` (default `'contract'` when absent) + `variation_line_id` in `rowToBoqItem`. Update any `BoqItem` literals in existing tests (`boq.service.test.ts`, `flatten-for-persist.test.ts`, reports tests, etc.) — add the two fields. ALSO: `flattenForPersist`/`persistImport` insert items WITHOUT origin (DB default `'contract'`) — no change needed there; verify type-check.
- [ ] **Step 5: PASS** + full shared suite + both type-checks (web consumes `BoqItem` widely — fix any literal). Barrel-export `variation.schema`. **Commit** `feat(variations): zod schema + boq item origin fields`.

---

## Task 3: Mappers — `_variation-mappers.ts`

**Files:** Create `packages/shared/src/services/_variation-mappers.ts` + `.test.ts`. Mirror `_valuation-mappers.ts` (the `num()` helper; nulls stay null; numeric strings coerce).

- [ ] **Steps:** Failing test (`rowToVariationLine` coerces `value_change:'-500'`→−500, keeps `qty_delta:null` null; `rowToVariationOrder` maps `vo_no`/`net_change`/`approved_*`) → FAIL → implement `rowToVariationOrder`/`rowToVariationLine`/`variationLineToRow` (only-defined-keys) → PASS + type-check → **Commit** `feat(variations): row<->domain mappers`.

---

## Task 4: Pure compute (the heart)

**Files:** Create `packages/shared/src/services/variation.service.ts` (pure fns) + `.test.ts`; MODIFY `packages/shared/src/services/valuation.service.ts` (revised-cap params).

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { computeLineChange, computeRevisedItem, validateQtyDelta } from './variation.service'
import { computeLineValue, isOverMeasure } from './valuation.service'

const item = (over = {}) => ({ amount: 1000, quantity: 10, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install', quantityMode: 'measured', ...over })

describe('computeLineChange', () => {
  it('adjust: qty_delta x contract rate', () => {
    expect(computeLineChange({ kind: 'adjust', qtyDelta: 5 } as never, item())).toBe(500)
    expect(computeLineChange({ kind: 'adjust', qtyDelta: -3 } as never, item())).toBe(-300)
  })
  it('adjust on RATE-ONLY (amount null): the delta IS the measurement', () => {
    expect(computeLineChange({ kind: 'adjust', qtyDelta: 7 } as never, item({ amount: null, quantity: null, quantityMode: 'rate_only' }))).toBe(700)
  })
  it('add: quantity x own rate (supply_install and single)', () => {
    expect(computeLineChange({ kind: 'add', quantity: 4, rateModel: 'supply_install', supplyRate: 100, installRate: 25, rate: null } as never)).toBe(500)
    expect(computeLineChange({ kind: 'add', quantity: 3, rateModel: 'single', rate: 50, supplyRate: null, installRate: null } as never)).toBe(150)
  })
})

describe('validateQtyDelta (the >= 0 revised-qty floor)', () => {
  it('rejects a delta below the floor', () => {
    // contract qty 10, prior approved deltas -4 => floor is -6
    expect(validateQtyDelta(item(), [-4], -7)).toBe(false)
    expect(validateQtyDelta(item(), [-4], -6)).toBe(true)
  })
  it('RATE-ONLY: floor = -(prior deltas)', () => {
    expect(validateQtyDelta(item({ quantity: null, quantityMode: 'rate_only', amount: null }), [7], -8)).toBe(false)
    expect(validateQtyDelta(item({ quantity: null, quantityMode: 'rate_only', amount: null }), [7], -7)).toBe(true)
  })
})

describe('computeRevisedItem', () => {
  it('contract + approved deltas at the contract rate', () => {
    expect(computeRevisedItem(item(), [5, -2])).toEqual({ revisedQty: 13, revisedAmount: 1300 })
  })
  it('no adjustments => contract position', () => {
    expect(computeRevisedItem(item(), [])).toEqual({ revisedQty: 10, revisedAmount: 1000 })
  })
  it('RATE-ONLY: revised = sum(deltas) x rate', () => {
    expect(computeRevisedItem(item({ quantity: null, amount: null, quantityMode: 'rate_only' }), [7])).toEqual({ revisedQty: 7, revisedAmount: 700 })
  })
  it('amount_only passes through untouched', () => {
    expect(computeRevisedItem(item({ rateModel: 'amount_only', amount: 999, quantity: null }), [])).toEqual({ revisedQty: null, revisedAmount: 999 })
  })
})

describe('computeLineValue with a revised cap', () => {
  it('percent computes against the revised amount', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 50, qtyComplete: null }, { revisedAmount: 1300, revisedQty: 13 })).toBe(650)
  })
  it('quantity caps at the revised amount (not contract)', () => {
    // 12 x 100 = 1200 > contract 1000 but <= revised 1300
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 12 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(1200)
  })
  it('no revised arg => behaves exactly as before (contract cap)', () => {
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 12 })).toBe(1000)
  })
  it('isOverMeasure compares against revised qty when given', () => {
    expect(isOverMeasure(item(), { inputMethod: 'quantity', qtyComplete: 12 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(false)
    expect(isOverMeasure(item(), { inputMethod: 'quantity', qtyComplete: 14 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(true)
  })
})
```

- [ ] **Step 2: FAIL.** **Step 3: Implement** in `variation.service.ts`:

```ts
import type { BoqItem } from '../schemas/boq.schema'
import type { VariationLine } from '../schemas/variation.schema'
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type RateFields = Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>
const effectiveRate = (f: RateFields): number =>
  f.rateModel === 'single' ? (f.rate ?? 0) : (f.supplyRate ?? 0) + (f.installRate ?? 0)

/** Money effect of one variation line. adjust => delta x the ITEM's contract rate; add => qty x the LINE's own rate. */
export function computeLineChange(
  line: Pick<VariationLine, 'kind' | 'qtyDelta' | 'quantity' | 'rateModel' | 'supplyRate' | 'installRate' | 'rate'>,
  item?: Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>,
): number {
  if (line.kind === 'adjust') {
    if (!item) throw new Error('adjust line requires its boq item')
    return round2((line.qtyDelta ?? 0) * effectiveRate(item))
  }
  return round2((line.quantity ?? 0) * effectiveRate({ rateModel: line.rateModel ?? 'supply_install', supplyRate: line.supplyRate, installRate: line.installRate, rate: line.rate }))
}

/** The >= 0 revised-quantity floor: contractQty + priorDeltas + newDelta >= 0. */
export function validateQtyDelta(
  item: Pick<BoqItem, 'quantity'>,
  priorApprovedDeltas: number[],
  newDelta: number,
): boolean {
  const base = (item.quantity ?? 0) + priorApprovedDeltas.reduce((s, d) => s + d, 0)
  return base + newDelta >= -1e-9
}

/** Revised position of one contract item under its approved qty deltas. */
export function computeRevisedItem(
  item: Pick<BoqItem, 'quantity' | 'amount' | 'supplyRate' | 'installRate' | 'rate' | 'rateModel' | 'quantityMode'>,
  approvedDeltas: number[],
): { revisedQty: number | null; revisedAmount: number | null } {
  if (item.rateModel === 'amount_only') return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const deltaSum = approvedDeltas.reduce((s, d) => s + d, 0)
  if (approvedDeltas.length === 0) return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const revisedQty = round2((item.quantity ?? 0) + deltaSum)
  return { revisedQty, revisedAmount: round2(revisedQty * effectiveRate(item)) }
}

/** Revised rollups: computeRollups over revised amounts (adjustmentsByItem: boq_item_id -> approved deltas). */
export function computeRevisedAmounts(
  items: BoqItem[],
  adjustmentsByItem: Map<string, number[]>,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const it of items) out.set(it.id, computeRevisedItem(it, adjustmentsByItem.get(it.id) ?? []).revisedAmount)
  return out
}
```

  And in `valuation.service.ts` (backwards-compatible third params):

```ts
export interface RevisedPosition { revisedAmount: number | null; revisedQty: number | null }

export function computeLineValue(item, line, revised?: RevisedPosition): number {
  const capAmount = revised?.revisedAmount ?? item.amount
  if (line.inputMethod === 'quantity') {
    const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
    let v = round2(Math.max(0, line.qtyComplete ?? 0) * rate)
    if (capAmount != null) v = Math.min(v, capAmount)
    return v
  }
  const pct = Math.min(100, Math.max(0, line.percentComplete ?? 0))
  return round2((capAmount ?? 0) * (pct / 100))
}

export function isOverMeasure(item, line, revised?: RevisedPosition): boolean {
  if (line.inputMethod !== 'quantity') return false
  const capAmount = revised?.revisedAmount ?? item.amount
  if (capAmount == null) return false
  const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
  return round2((line.qtyComplete ?? 0) * rate) > capAmount
}
```
  (Keep the existing exported signatures source-compatible — the new param is optional; existing tests must pass unchanged.)

- [ ] **Step 4: PASS** (new tests + ALL existing valuation tests unchanged) + type-checks. Barrel-export. **Step 5: Commit** `feat(variations): pure computeLineChange/computeRevisedItem + revised valuation cap`.

---

## Task 5: Service client methods — `variationService`

**Files:** MODIFY `packages/shared/src/services/variation.service.ts` (+ `.client.test.ts`).

Mirror `valuationService` (the `AnyClient` cast, `fetchAll` `.range()` pagination, throw-on-error). Methods:
- `list(client, projectId)` → `VariationOrder[]` by `vo_no`.
- `get(client, voId)` → `{ vo, lines } | null` (paginate lines).
- `create(client, { projectId, organisationId, boqImportId, voDate, title, reason, createdBy })` → insert (trigger numbers it). No carry-forward — VOs are independent.
- `upsertLine(client, voId, patch, item?)` → compute `value_change` via `computeLineChange(patch, item)`; insert or update (lines have no natural conflict key — `patch.id` present = update, else insert).
- `deleteLine(client, lineId)`.
- `getApprovedAdjustments(client, projectId)` → `Map<boqItemId, number[]>` — all `adjust` lines of `approved` VOs for the project (paginated; join via `variation_orders!inner(project_id, status)`).
- `approve(client, voId, { approvedBy })` → **ordering matters**: (1) read the VO's `add` lines WHERE `materialized_item_id IS NULL`; (2) for each, insert a `boq_items` row (`section_id`, `code`, `description`, `unit`, `quantity`, `quantity_mode:'measured'`, `rate_model`, rates, `amount = value_change`, `origin:'variation'`, `variation_line_id`, `sort_order` = max(sort_order)+1 within the section) and set the line's `materialized_item_id`; (3) snapshot `net_change` = Σ `value_change`; (4) LAST set `status='approved'` + `approved_by/at`. (A mid-way failure leaves a draft; re-approve skips already-materialized lines — idempotent.)

- [ ] **Steps:** Failing tests — `approve` materializes only un-materialized `add` lines with the right fields + sets status LAST; `getApprovedAdjustments` groups deltas per item and ignores draft VOs. FAIL → implement → PASS + full shared suite + type-check → **Commit** `feat(variations): variationService (list/get/create/upsertLine/approve-materialize/getApprovedAdjustments)`.

---

## Task 6: Actions — `variation.actions.ts` + revised-cap wiring

**Files:** Create `apps/web/src/actions/variation.actions.ts` + `.test.ts`; MODIFY `apps/web/src/actions/valuation.actions.ts`.

Mirror `valuation.actions.ts` exactly (gate first, cross-project guard via the VO's `project_id`, `{data}|{error}`, `revalidatePath`, `vi.hoisted` tests). Actions:
- `listVariationOrdersAction(projectId)`; `getVariationOrderAction(projectId, voId)` (VO + lines + live `netChange` = Σ `value_change`; resolve names via service client).
- `createVariationOrderAction(projectId, { voDate, title, reason })` — needs the `is_current` import (error if none, same message pattern as valuations).
- `upsertVariationLineAction(projectId, voId, patch)` — refuse if `approved`; validate with `variationLinePatchSchema`; for `adjust`: load the boq item + `getApprovedAdjustments` and **enforce `validateQtyDelta`** (return `{ error: 'Delta would take the revised quantity below zero' }`); compute via `variationService.upsertLine`.
- `deleteVariationLineAction(projectId, voId, lineId)` — draft only.
- `approveVariationOrderAction(projectId, voId)` — refuse if already approved; `variationService.approve`; revalidate the rates + valuations + variations paths.
- `deleteVariationOrderAction(projectId, voId)` — `ORG_WRITE_ROLES`, draft only.

**Revised-cap wiring in `valuation.actions.ts`:** in `updateValuationLineAction` + `getValuationAction`, fetch `variationService.getApprovedAdjustments(service, projectId)` once; for each item compute `computeRevisedItem(item, deltas)` and pass `{ revisedAmount, revisedQty }` as the third arg to `computeLineValue`/`isOverMeasure` (and surface `revisedAmount` per line in `getValuationAction`'s payload so the UI can show it). Materialized `add` items need no special handling (their contract amount IS their revised amount — no adjustments reference them in v1).

- [ ] **Steps:** Failing tests — the floor rejection on `upsertVariationLineAction`; refuse-edit-when-approved; cross-project guard (no write on a foreign VO); `updateValuationLineAction` now accepting a quantity that exceeds contract but is within revised (mock adjustments). FAIL → implement → PASS (`pnpm --filter web test src/actions`) + type-check → **Commit** `feat(variations): actions + floor guard + revised valuation caps`.

---

## Task 7: Certificate — revised-contract summary lines

**Files:** MODIFY `apps/web/src/lib/reports/valuation-report-data.ts`, `valuation-report.tsx` (+ their tests).

- Gatherer: fetch Σ approved `net_change` (one query over `variation_orders WHERE project_id AND status='approved'`) + the import's `total_ex_vat`; add to the returned object: `contract: { asImported: number | null, approvedVariations: number, revised: number | null }` (revised = asImported + variations when asImported non-null).
- Document: three new rows ABOVE the existing summary block: "Contract value (as imported)" / "+ Approved variations" / "= Revised contract value". Render only when data present (asImported non-null OR variations ≠ 0).
- [ ] **Steps:** extend the gatherer test (mock the VO query; assert `contract.revised = asImported + variations`) + the render smoke still `%PDF`. FAIL → implement → PASS + type-check → **Commit** `feat(variations): certificate shows contract -> +variations -> revised`.

---

## Task 8: UI — Variations tab + Contract|Revised on Rates

**Files:** Create `app/(admin)/projects/[id]/settings/variations/page.tsx` + `_components/{VariationsList,VariationDetail,VariationLineEditor,ApproveBar}.tsx`; MODIFY `settings/_components/SettingsTabs.tsx` (+`.test.tsx` count → 15), the Rates `_components/{BoqMainSummary,BoqSectionTree,BoqLineItemTable}.tsx`, `settings/rates/page.tsx` (pass adjustments), `docs/rbac-matrix.md`.

> Use `frontend-design:frontend-design`. Mirror the **Valuations tab** components verbatim for the list/detail/approve shapes (`ValuationsList`→`VariationsList`, `CertifyBar`→`ApproveBar`).

- **Tab:** `{ slug: 'variations', label: 'Variations', viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES }` after `valuations`.
- **`page.tsx`:** gate; empty state when no current BOQ import; else `<VariationsTab projectId canEdit vos={…} />`.
- **`VariationsList`:** No., date, title, status badge, net change (±, red/green) + **New VO** (date+title+reason).
- **`VariationDetail` + `VariationLineEditor`:** lines table (kind badge, target item / new-item description, qty delta or qty, value change ±) + the editor: *Adjust* = searchable item picker (code + description + contract qty/rate + already-approved deltas shown) → ±qty → live value change (client-side `computeLineChange` preview; server recomputes); *Add* = section picker → description/unit/qty/rate-model/rates → live value. Floor errors surfaced inline. Draft-only editing.
- **`ApproveBar`:** two-step Approve (mirrors CertifyBar) → locks; approved VOs read-only with the net change.
- **Rates tab Contract|Revised:** `rates/page.tsx` fetches `getApprovedAdjustments` (expose via a small read in `listBoqAction` or a parallel call) + passes `revisedAmounts` (from `computeRevisedAmounts`) down; `BoqMainSummary`/`BoqSectionTree`/`BoqLineItemTable` show a **Revised** column ONLY when any adjustment/materialized item exists (else unchanged); materialized items get a `variation` Badge (`info`).
- [ ] **Steps:** build incrementally with per-group commits; smoke tests for `VariationsList` (empty + populated) and the floor-error rendering in `VariationLineEditor`; SettingsTabs test → 15. `pnpm --filter web test src/app` + type-check green. **Commit(s)** `feat(variations): Variations tab UI` / `feat(variations): Contract|Revised on the Rates tab`.

---

## Task 9: Whole-feature verification (gated steps flagged)

- [ ] **Step 1:** Full suites + type-checks green (shared + web).
- [ ] **Step 2:** Final whole-feature review (money-flow trace: line edit → value_change → approve → materialize/adjustments → revised rollups → valuation cap → certificate lines; dual-source audit; RBAC sweep).
- [ ] **Step 3 (gated — ship):** re-fetch origin/main, re-check the migration number is still free (renumber if taken — the 00127 lesson), merge main, re-verify combined tree, push + PR + merge per Arno's call. Migration applies via `deploy-migrations.yml`; then ledger check + `bash scripts/db/smoke-test-project-variations.sh` (4/4) + routes 307.
- [ ] **Step 4 (gated — real data):** KINGSWALK walkthrough — VO measuring one RATE-ONLY item → approve → Rates shows Contract|Revised → the item valuable in a draft valuation → certificate shows the revised contract value.

---

## Self-review (author check vs spec)

- **Spec coverage:** D1 dated/lockable VO → T1/T5(approve); D2 two kinds no rate-changes → T2 schema refines + T4 `computeLineChange`; D3 never-mutate + materialize-on-approve → T4 pure + T5 `approve` ordering + the `boq_items.origin` columns (T1/T2); D4 value-against-revised → T4 revised-cap + T6 wiring + T7 certificate lines; D5 tab+RBAC → T6/T8; §4.2 floor → T4 `validateQtyDelta` + T6 enforcement; §5 testing → every task + T9; KINGSWALK check → T9. ✅
- **Placeholders:** none — full DDL/schema/pure-compute code; precise signatures + mirror-files elsewhere.
- **Type consistency:** `computeLineChange(line, item?)`, `validateQtyDelta(item, priorDeltas, newDelta)`, `computeRevisedItem(item, deltas)`→`{revisedQty, revisedAmount}`, `RevisedPosition` third params, `variationService.{list,get,create,upsertLine,deleteLine,getApprovedAdjustments,approve}` — used identically across T4–T8. ✅
