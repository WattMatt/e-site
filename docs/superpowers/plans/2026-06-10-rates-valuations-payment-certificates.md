# Rates Phase 2a — Valuations & Payment Certificates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dated **valuations** (snag-visit-style carry-forward) that value the contract BOQ by per-item % / measured-quantity / section-%, and produce a branded **interim payment certificate** PDF (`gross-to-date − retention − previously-certified = due + VAT`), behind a `COST_VIEW_ROLES`-gated "Valuations" settings tab.

**Architecture:** Two tables in the `projects` schema (`valuations` dated event + `valuation_lines` per BOQ item). All money flows from two pure functions in `@esite/shared` — `computeLineValue` (any input method → one `value_to_date`) and `computeCertificate` (the certificate figures) — no triggers compute money. The certificate is a `valuation` kind on the existing react-pdf report engine. Mirrors the Phase-1 Rates feature + the snag-visit dated-event feature throughout.

**Tech Stack:** Next.js 15, TypeScript, Supabase Postgres (RLS), `@esite/shared` (Zod + pure services), `@react-pdf/renderer` (already a web dep), vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-rates-valuations-payment-certificates-design.md`

---

## Design conventions (every task follows these)

- **Migration:** `apps/edge-functions/supabase/migrations/`; **`00127`** is the target number — **confirm the next free number at build** (00126 is the current max on origin/main; concurrent sessions add migrations). Adding tables to the existing `projects` schema needs only `NOTIFY pgrst, 'reload schema'` (no PostgREST PATCH). Make every trigger/policy idempotent (`DROP … IF EXISTS` before `CREATE`).
- **RBAC:** `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)` in actions; `requireRolePage` on the page; `COST_VIEW_ROLES`/`ORG_WRITE_ROLES` from `@esite/shared`. Service-role (RLS-bypassing) writes sit behind the gate. Resolve other users' names via `createServiceClient()` after the gate (the `public.profiles` RLS lesson).
- **Money:** the ONLY source of every money figure is the two pure functions. Store `value_to_date` per line; snapshot the certificate figures onto the `valuations` row only on Certify. No money in triggers.
- **Service shape:** `packages/shared/src/services/valuation.service.ts` + `_valuation-mappers.ts`; schemas in `packages/shared/src/schemas/`. Loose client typed `AnyClient` cast to `.schema('projects')` (the codebase pattern for non-generated schemas). **Reads of >1000 rows MUST paginate** (`.range()` loop — see `boqService.getTree`; the PostgREST 1000-row cap).
- **Tests:** vitest. Shared: `pnpm --filter @esite/shared test`. Web: `pnpm --filter web test`. Type-check: `pnpm --filter web type-check` / `pnpm --filter @esite/shared type-check`. `vi.hoisted` for web action mocks (the `next/cache` TDZ trap). Node-only test files (anything calling `renderToBuffer`/using `Buffer`) carry `// @vitest-environment node`.
- **Branch:** all work on `feat/rates-phase2` (this worktree). Commit per green step.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00127_project_valuations.sql` | `valuations` + `valuation_lines`, `valuation_no` trigger, RLS |
| `scripts/db/smoke-test-project-valuations.sh` | transactional smoke test |
| `packages/shared/src/schemas/valuation.schema.ts` | Zod + enums + types |
| `packages/shared/src/services/_valuation-mappers.ts` | row ↔ domain |
| `packages/shared/src/services/valuation.service.ts` | pure `computeLineValue`/`computeCertificate` + client methods |
| `apps/web/src/actions/valuation.actions.ts` | RBAC-gated server actions |
| `apps/web/src/lib/reports/valuation-report-data.ts` | pure certificate data-gatherer |
| `apps/web/src/lib/reports/valuation-report.tsx` | react-pdf certificate document |
| `apps/web/src/lib/reports/render-valuation.ts` | `renderToBuffer` → Buffer |
| `apps/web/src/app/(admin)/projects/[id]/settings/valuations/page.tsx` | server page |
| `.../settings/valuations/_components/*.tsx` | ValuationsList, ValuationDetail, CertificateSummary, CertifyBar |
| `.../settings/_components/SettingsTabs.tsx` | register the tab (MODIFY) |
| `docs/rbac-matrix.md` | Valuations row (MODIFY) |

---

## Task 0: Verify the worktree + toolchain

- [ ] **Step 1:** Confirm branch + deps. Run: `git -C <worktree> branch --show-current` → `feat/rates-phase2`. Run `pnpm --filter @esite/shared test` and `pnpm --filter web type-check` → green baseline (so later failures are attributable). No commit.

---

## Task 1: Migration `00127` — schema, trigger, RLS

**Files:** Create `apps/edge-functions/supabase/migrations/00127_project_valuations.sql` + `scripts/db/smoke-test-project-valuations.sh`.

- [ ] **Step 1: Write the migration** (confirm `00127` is free first)

```sql
-- 00127_project_valuations.sql — dated valuations + payment-certificate lines.
BEGIN;

CREATE TABLE IF NOT EXISTS projects.valuations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id   uuid NOT NULL REFERENCES public.organisations(id),
  boq_import_id     uuid NOT NULL REFERENCES projects.boq_imports(id),
  valuation_no      int  NOT NULL DEFAULT 0,
  valuation_date    date NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  retention_pct     numeric(5,2) NOT NULL,
  gross_to_date     numeric(16,2),
  retention_amount  numeric(16,2),
  net_to_date       numeric(16,2),
  previous_net      numeric(16,2),
  due_ex_vat        numeric(16,2),
  vat_amount        numeric(16,2),
  due_incl_vat      numeric(16,2),
  report_id         uuid REFERENCES projects.reports(id),
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  certified_by      uuid REFERENCES public.profiles(id),
  certified_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.valuations DROP CONSTRAINT IF EXISTS valuations_status_check;
ALTER TABLE projects.valuations ADD CONSTRAINT valuations_status_check CHECK (status IN ('draft','certified'));
CREATE UNIQUE INDEX IF NOT EXISTS valuations_project_no ON projects.valuations(project_id, valuation_no);
CREATE INDEX IF NOT EXISTS valuations_project_idx ON projects.valuations(project_id);

-- per-project valuation_no (mirror 00120 snag_visits numbering)
CREATE OR REPLACE FUNCTION projects.valuations_set_no() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.valuation_no = 0 OR NEW.valuation_no IS NULL THEN
    SELECT COALESCE(MAX(valuation_no), 0) + 1 INTO NEW.valuation_no
      FROM projects.valuations WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS valuations_set_no ON projects.valuations;
CREATE TRIGGER valuations_set_no BEFORE INSERT ON projects.valuations
  FOR EACH ROW EXECUTE FUNCTION projects.valuations_set_no();

CREATE TABLE IF NOT EXISTS projects.valuation_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id      uuid NOT NULL REFERENCES projects.valuations(id) ON DELETE CASCADE,
  boq_item_id       uuid NOT NULL REFERENCES projects.boq_items(id) ON DELETE CASCADE,
  input_method      text NOT NULL,
  percent_complete  numeric(6,3),
  qty_complete      numeric(14,3),
  value_to_date     numeric(16,2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.valuation_lines DROP CONSTRAINT IF EXISTS valuation_lines_method_check;
ALTER TABLE projects.valuation_lines ADD CONSTRAINT valuation_lines_method_check CHECK (input_method IN ('percent','quantity','section'));
CREATE UNIQUE INDEX IF NOT EXISTS valuation_lines_uniq ON projects.valuation_lines(valuation_id, boq_item_id);
CREATE INDEX IF NOT EXISTS valuation_lines_valuation_idx ON projects.valuation_lines(valuation_id);

DROP TRIGGER IF EXISTS valuations_set_updated_at ON projects.valuations;
CREATE TRIGGER valuations_set_updated_at BEFORE UPDATE ON projects.valuations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS valuation_lines_set_updated_at ON projects.valuation_lines;
CREATE TRIGGER valuation_lines_set_updated_at BEFORE UPDATE ON projects.valuation_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.valuation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS valuations_select ON projects.valuations;
CREATE POLICY valuations_select ON projects.valuations FOR SELECT
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS valuations_modify ON projects.valuations;
CREATE POLICY valuations_modify ON projects.valuations FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'));

DROP POLICY IF EXISTS valuation_lines_select ON projects.valuation_lines;
CREATE POLICY valuation_lines_select ON projects.valuation_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id AND public.user_has_project_access(v.project_id)));
DROP POLICY IF EXISTS valuation_lines_modify ON projects.valuation_lines;
CREATE POLICY valuation_lines_modify ON projects.valuation_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')));

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 2: Write the smoke test** — mirror `scripts/db/smoke-test-project-boq.sh` (use the **capture-then-grep** `2>&1` sentinel pattern). Assert: both tables exist + RLS enabled; the 4 policies; the 2 updated_at triggers + the `valuations_set_no` trigger; a transactional DO-block inserting a project's valuation (asserting `valuation_no` auto-fills to 1, a 2nd to 2) + a line, then `RAISE EXCEPTION 'SMOKE_OK_ROLLBACK'`.
- [ ] **Step 3:** DO NOT apply to prod here (gated — Task 9). Just sanity-check balanced BEGIN/COMMIT and that every DROP precedes its CREATE.
- [ ] **Step 4: Commit** `feat(valuations): migration 00127 — valuations + valuation_lines + RLS`.

---

## Task 2: Shared schema — `valuation.schema.ts`

**Files:** Create `packages/shared/src/schemas/valuation.schema.ts` + `.test.ts`; export from the schemas barrel.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { valuationLineSchema, valuationProgressPatchSchema, INPUT_METHODS, VALUATION_STATUSES } from './valuation.schema'
describe('valuation.schema', () => {
  it('accepts a percent line', () => {
    expect(valuationLineSchema.parse({ id: '00000000-0000-0000-0000-000000000001', valuationId: '00000000-0000-0000-0000-000000000002', boqItemId: '00000000-0000-0000-0000-000000000003', inputMethod: 'percent', percentComplete: 50, qtyComplete: null, valueToDate: 100 }).inputMethod).toBe('percent')
  })
  it('progress patch requires a method + the matching field', () => {
    expect(() => valuationProgressPatchSchema.parse({ boqItemId: 'x', inputMethod: 'percent' })).toThrow()
    expect(valuationProgressPatchSchema.parse({ boqItemId: '00000000-0000-0000-0000-000000000003', inputMethod: 'quantity', qtyComplete: 12 }).qtyComplete).toBe(12)
  })
  it('exposes enums', () => { expect(INPUT_METHODS).toContain('section'); expect(VALUATION_STATUSES).toContain('certified') })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @esite/shared test valuation.schema`
- [ ] **Step 3: Implement**

```ts
// packages/shared/src/schemas/valuation.schema.ts
import { z } from 'zod'
export const INPUT_METHODS = ['percent', 'quantity', 'section'] as const
export const VALUATION_STATUSES = ['draft', 'certified'] as const

export const valuationLineSchema = z.object({
  id: z.string().uuid(),
  valuationId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  inputMethod: z.enum(INPUT_METHODS),
  percentComplete: z.number().nullable(),
  qtyComplete: z.number().nullable(),
  valueToDate: z.number(),
})
export const valuationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  boqImportId: z.string().uuid(),
  valuationNo: z.number().int(),
  valuationDate: z.string(),
  status: z.enum(VALUATION_STATUSES),
  retentionPct: z.number(),
  grossToDate: z.number().nullable(),
  retentionAmount: z.number().nullable(),
  netToDate: z.number().nullable(),
  previousNet: z.number().nullable(),
  dueExVat: z.number().nullable(),
  vatAmount: z.number().nullable(),
  dueInclVat: z.number().nullable(),
  reportId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  certifiedBy: z.string().uuid().nullable(),
  certifiedAt: z.string().nullable(),
})
export const valuationProgressPatchSchema = z
  .object({
    boqItemId: z.string().uuid(),
    inputMethod: z.enum(INPUT_METHODS),
    percentComplete: z.number().min(0).max(100).nullable().optional(),
    qtyComplete: z.number().min(0).nullable().optional(),
  })
  .refine((p) => (p.inputMethod === 'quantity' ? p.qtyComplete != null : p.percentComplete != null), {
    message: 'percent/section require percentComplete; quantity requires qtyComplete',
  })

export type Valuation = z.infer<typeof valuationSchema>
export type ValuationLine = z.infer<typeof valuationLineSchema>
export type ValuationProgressPatch = z.infer<typeof valuationProgressPatchSchema>
export type InputMethod = (typeof INPUT_METHODS)[number]
export type ValuationStatus = (typeof VALUATION_STATUSES)[number]
```

- [ ] **Step 4: Run → PASS** + type-check. Add `export * from './valuation.schema'` to the schemas barrel (mirror `boq.schema`).
- [ ] **Step 5: Commit** `feat(valuations): zod schema + enums`.

---

## Task 3: Mappers — `_valuation-mappers.ts`

**Files:** Create `_valuation-mappers.ts` + `.test.ts`. Mirror `_boq-mappers.ts` exactly (numeric-string coercion, nulls preserved).

- [ ] **Step 1: Failing test** — assert `rowToValuationLine` coerces `value_to_date:'100'`→`100`, keeps `percent_complete:null` null, and `rowToValuation` maps all snapshot fields. **Step 2:** FAIL. **Step 3:** implement `rowToValuation` / `rowToValuationLine` / `valuationLineToRow` (snake↔camel; `num()` helper from `_boq-mappers`'s pattern). **Step 4:** PASS + type-check. **Step 5: Commit** `feat(valuations): row<->domain mappers`.

---

## Task 4: Pure compute — `computeLineValue` + `computeCertificate` (the heart)

**Files:** Create `packages/shared/src/services/valuation.service.ts` (pure fns first) + `.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { computeLineValue, computeCertificate } from './valuation.service'

const item = (over = {}) => ({ amount: 1000, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install', ...over })

describe('computeLineValue', () => {
  it('percent: amount × %', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 25, qtyComplete: null })).toBe(250)
  })
  it('section behaves like percent', () => {
    expect(computeLineValue(item(), { inputMethod: 'section', percentComplete: 50, qtyComplete: null })).toBe(500)
  })
  it('clamps percent to 0–100', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 150, qtyComplete: null })).toBe(1000)
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: -5, qtyComplete: null })).toBe(0)
  })
  it('quantity: qty × (supply+install), capped at contract amount', () => {
    // 8 × (80+20) = 800
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 8 })).toBe(800)
    // over-measure 20 × 100 = 2000, capped at contract amount 1000
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 20 })).toBe(1000)
  })
  it('RATE-ONLY (amount null): quantity is uncapped (no contract amount)', () => {
    expect(computeLineValue(item({ amount: null }), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 5 })).toBe(500)
  })
  it('single rate model uses rate', () => {
    expect(computeLineValue(item({ rateModel: 'single', rate: 50, supplyRate: null, installRate: null }), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 4 })).toBe(200)
  })
})

describe('computeCertificate', () => {
  it('gross − retention − previous = due (+15% VAT)', () => {
    // gross 10000, retention 5% = 500, net 9500, previous 4000 → due 5500, vat 825, incl 6325
    const c = computeCertificate([{ valueToDate: 6000 }, { valueToDate: 4000 }], 5, 4000)
    expect(c.grossToDate).toBe(10000)
    expect(c.retention).toBe(500)
    expect(c.netToDate).toBe(9500)
    expect(c.dueExVat).toBe(5500)
    expect(c.vat).toBe(825)
    expect(c.dueInclVat).toBe(6325)
  })
  it('first valuation: previousNet 0', () => {
    expect(computeCertificate([{ valueToDate: 1000 }], 0, 0).dueExVat).toBe(1000)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @esite/shared test valuation.service`
- [ ] **Step 3: Implement (pure fns)**

```ts
// packages/shared/src/services/valuation.service.ts
import type { InputMethod } from '../schemas/valuation.schema'
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function computeLineValue(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; percentComplete: number | null; qtyComplete: number | null },
): number {
  if (line.inputMethod === 'quantity') {
    const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
    let v = round2(Math.max(0, line.qtyComplete ?? 0) * rate)
    if (item.amount != null) v = Math.min(v, item.amount) // over-measure capped at contract (a Variations concern)
    return v
  }
  // percent | section
  const pct = Math.min(100, Math.max(0, line.percentComplete ?? 0))
  return round2((item.amount ?? 0) * (pct / 100))
}

export function computeCertificate(
  lines: { valueToDate: number }[],
  retentionPct: number,
  previousNet: number,
): { grossToDate: number; retention: number; netToDate: number; previousNet: number; dueExVat: number; vat: number; dueInclVat: number } {
  const grossToDate = round2(lines.reduce((s, l) => s + l.valueToDate, 0))
  const retention = round2(grossToDate * (retentionPct / 100))
  const netToDate = round2(grossToDate - retention)
  const dueExVat = round2(netToDate - previousNet)
  const vat = round2(dueExVat * 0.15)
  const dueInclVat = round2(dueExVat + vat)
  return { grossToDate, retention, netToDate, previousNet, dueExVat, vat, dueInclVat }
}

/** True when a quantity line values more than the contract amount (over-measure → Variations). */
export function isOverMeasure(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; qtyComplete: number | null },
): boolean {
  if (line.inputMethod !== 'quantity' || item.amount == null) return false
  const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
  return round2((line.qtyComplete ?? 0) * rate) > item.amount
}
```

- [ ] **Step 4: Run → PASS** + type-check. **Step 5: Commit** `feat(valuations): pure computeLineValue + computeCertificate`.

---

## Task 5: Service client methods — `valuationService`

**Files:** Modify `valuation.service.ts` (add the `valuationService` object) + `valuation.service.client.test.ts`; export from the services barrel.

Mirror `boq.service.ts` for client typing/casting + error handling. **READ `boq.service.ts`'s `getTree` for the `.range()` pagination helper — reuse it for `getLines`.** Methods:
- `list(client, projectId): Promise<Valuation[]>` — ordered by `valuation_no`.
- `get(client, valuationId): Promise<{ valuation: Valuation; lines: ValuationLine[] } | null>` — paginate lines.
- `create(client, { projectId, organisationId, boqImportId, valuationDate, retentionPct, createdBy }): Promise<Valuation>` — insert (trigger sets `valuation_no`); then **carry-forward**: copy the previous valuation's lines (`SELECT` prior `valuation_no = new − 1`; bulk-insert its lines against the new `valuation_id`, preserving `input_method`/`percent_complete`/`qty_complete`/`value_to_date`).
- `upsertLine(client, valuationId, { boqItemId, inputMethod, percentComplete, qtyComplete }, item): Promise<ValuationLine>` — compute `value_to_date` via `computeLineValue(item, …)`, upsert on `(valuation_id, boq_item_id)`.
- `setSectionPercent(client, valuationId, itemsUnderSection, percent): Promise<void>` — for each item under the section, upsert a `section`-method line with that percent.
- `certify(client, valuationId, { certifiedBy, reportId, figures }): Promise<Valuation>` — write the snapshot figures + `status='certified'` + `certified_by/at` + `report_id`.
- `getPreviousNet(client, projectId, valuationNo): Promise<number>` — the prior certified valuation's `net_to_date` (0 if none).

- [ ] **Steps:** Failing test for `create` carry-forward (mock client; assert the prior lines are re-inserted against the new valuation) + `upsertLine` (asserts `value_to_date` from `computeLineValue`). FAIL → implement → PASS + type-check → export `valuationService` from the barrel → **Commit** `feat(valuations): valuationService client methods (list/get/create-carryforward/upsertLine/certify)`.

---

## Task 6: Server actions — `valuation.actions.ts`

**Files:** Create `apps/web/src/actions/valuation.actions.ts` + `.test.ts`. Mirror `apps/web/src/actions/boq.actions.ts` exactly (resolve project→org, `requireEffectiveRole(COST_VIEW_ROLES)`, `{ data } | { error }`, `revalidatePath`, service-client writes behind the gate, `vi.hoisted` mocks).

Actions (each with a **cross-project guard** — resolve the valuation's `project_id` and reject if `!== projectId`):
- `listValuationsAction(projectId)`; `getValuationAction(projectId, valuationId)` (returns valuation + lines + the live certificate figures via `computeCertificate` + `getPreviousNet`; resolve `certifiedBy`/`createdBy` names via service client).
- `createValuationAction(projectId, valuationDate)` — read `project_settings.retention_pct` + the `is_current` `boq_imports` row; if no import → `{ error: 'Import a BOQ first' }`; else `valuationService.create`.
- `updateValuationLineAction(projectId, valuationId, patch)` — load the boq item (for the rate), `upsertLine`; refuse if the valuation is `certified`.
- `setSectionPercentAction(projectId, valuationId, sectionId, percent)` — gather items under the section (`boqService.getTree` + descend the tree), `setSectionPercent`; refuse if certified.
- `certifyValuationAction(projectId, valuationId)` — load lines + items → `computeCertificate` → render the PDF (Task 7) → persist a `projects.reports` row (kind `valuation`, supersede any prior for this valuation) → `valuationService.certify` with the figures + report id → revalidate.
- `deleteValuationAction(projectId, valuationId)` — `ORG_WRITE_ROLES`; refuse if `certified`.

- [ ] **Steps:** Failing test — the cross-project guard on `updateValuationLineAction` (foreign valuation → `{ error: 'Not found' }`, no write) + `createValuationAction` returning the no-import error. FAIL → implement → PASS + type-check → **Commit** `feat(valuations): server actions + RBAC + cross-project guards`.

---

## Task 7: Certificate report kind

**Files:** Create `apps/web/src/lib/reports/{valuation-report-data.ts, valuation-report.tsx, render-valuation.ts}` + tests. **Mirror `snag-visit-report-data.ts` + `snag-visit-report.tsx` + `render-snag-visit.ts` (or `render-inspection.ts`) verbatim** for the gather/doc/render shape.

- **`valuation-report-data.ts`** — pure `gatherValuationReportData(supabase, projectId, valuationId)`: RBAC gate; resolve branding (`resolveBranding`) + names via service client (logos as `data:` URIs); load the valuation + lines + the BOQ tree (`boqService.getTree`); compute `computeCertificate` + a **per-bill breakdown** (sum each line's `value_to_date` into its bill by walking the section tree — reuse the boq tree-walk). Return a plain object: `{ branding, projectName, valuation: { no, date, retentionPct }, summary: {gross, retention, net, previous, dueExVat, vat, dueInclVat}, bills: [{ title, grossToDate, thisPeriod, retention }] }`.
- **`valuation-report.tsx`** — react-pdf `ValuationReportDocument` reusing `Cover` + `interior.tsx` primitives: cover ("Payment Certificate No. N") → per-bill schedule table → summary block (gross / less retention / less previous / **due ex-VAT / VAT / due incl-VAT**) → signature strip.
- **`render-valuation.ts`** — `export async function renderValuationReport(data): Promise<Buffer>` = `renderToBuffer(<ValuationReportDocument data={data} />)`.

- [ ] **Steps:** test the gatherer's pure math (mock the clients; assert the summary equals `computeCertificate`) + a Node-env render smoke test (`// @vitest-environment node`, assert a Buffer of `%PDF`). FAIL → implement → PASS + type-check → **Commit** `feat(valuations): payment-certificate report kind`.

---

## Task 8: UI — tab + page + components

**Files:** MODIFY `settings/_components/SettingsTabs.tsx` (+ `Slug` union, add `{ slug: 'valuations', label: 'Valuations', viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES }` after `rates`); MODIFY `docs/rbac-matrix.md`; CREATE `settings/valuations/page.tsx` + `_components/{ValuationsList,ValuationDetail,CertificateSummary,CertifyBar}.tsx`.

> Use **`frontend-design:frontend-design`** for the components, mirroring the **Rates tab** (`settings/rates/_components/`) for the BOQ tree + the **snag visits-primary UI** for the dated-event list.

- `page.tsx` (server): `requireEffectiveRole(COST_VIEW_ROLES)`; fetch `listValuationsAction` + the current BOQ import; empty state if no import ("Import a BOQ on the Rates tab first").
- `ValuationsList` — the valuation sequence (no., date, status badge, due-incl) + **New valuation** (date → `createValuationAction`).
- `ValuationDetail` — reuse `BoqSectionTree`/`BoqLineItemTable`; add a **progress column**: a `%` input or `qty` input per item (qty forced for RATE-ONLY; an over-measure `warning` badge via `isOverMeasure`), and a section-level `%` field that calls `setSectionPercentAction`. Live `value_to_date` + totals. Editable only while `draft`.
- `CertificateSummary` — the live figures (gross / retention / previous / due / VAT) + per-bill table.
- `CertifyBar` — Certify (confirm) → `certifyValuationAction` → lock + download the PDF (`file-open.ts` `previewViaSignedUrl`). Certified valuations are read-only + a "view certificate" link.

- [ ] **Steps:** build components; add a render/smoke test for `CertificateSummary` (figures) + `ValuationsList` (empty state). Update the existing `SettingsTabs.test.tsx` count (13 → 14). type-check + tests green. **Commit** `feat(valuations): Valuations settings tab + UI`.

---

## Task 9: Whole-feature verification (gated steps flagged)

- [ ] **Step 1:** `pnpm --filter @esite/shared test && pnpm --filter web test && both type-checks` → green.
- [ ] **Step 2 (gated — apply to prod):** apply `00127` via `scripts/db/mgmt-api.sh` + record the ledger + run `smoke-test-project-valuations.sh` (green). **Confirm with the user before applying.**
- [ ] **Step 3 (gated — render deploy-verify):** after merge, deploy-verify the certificate PDF on the Vercel runtime (the react-pdf/React-19 `renderToBuffer` trap — see [report-engine-react19]; the [prod-authenticated-render-verify] recipe). A real valuation → certify → 200 `application/pdf`.
- [ ] **Step 4:** real-data check — on KINGSWALK, create a valuation, set a few items to 50% + one RATE-ONLY item by quantity, confirm the certificate figures + per-bill totals, certify, open the PDF.
- [ ] **Step 5:** finish via `superpowers:finishing-a-development-branch` (PR/merge per Arno's call). ⚠ Preview shares the prod DB.

---

## Self-review (author check vs spec)

- **Spec coverage:** §4.1 dated-event → T1/T5(create-carryforward); §4.2 data model → T1; §4.3 method-agnostic value → T4 `computeLineValue` (all 3 methods + RATE-ONLY + over-measure cap); §4.4 certificate math → T4 `computeCertificate`; §4.5 report kind → T7; §4.6 service/schema → T2/T3/T4/T5; §4.7 actions → T6; §4.8 UI → T8; §5 RBAC → T6/T8; §6 testing → every task + T9; D4 certify-lock → T5 `certify` + T6 `certifyValuationAction` + refuse-edit-when-certified; D7 retention → T4 + `createValuationAction` reads `retention_pct`. ✅
- **Placeholders:** none — full code on migration/schema/mappers/compute; convention-anchored tasks name the exact file to mirror + the precise method signatures.
- **Type consistency:** `computeLineValue`/`computeCertificate`/`isOverMeasure`, `valuationService.{list,get,create,upsertLine,setSectionPercent,certify,getPreviousNet}`, the `{data}|{error}` result, `InputMethod`/`ValuationStatus`, and the `value_to_date`/`percent_complete`/`qty_complete` field names are used identically across tasks.
