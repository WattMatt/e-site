# Project Rates / BOQ — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a project's priced tender BOQ (Open Nexus `.xlsx` export) into E-Site — import + reconcile against its own totals + a Main-Summary/drill-down viewer + inline supply/install rate editing — behind a new `COST_VIEW_ROLES`-gated **Rates** tab in project settings.

**Architecture:** A 3-table self-referencing tree in the `projects` schema (`boq_imports` → `boq_sections` → `boq_items`). A pure, AoA-based parser in `apps/web/src/lib/boq/` (web-only, keeps `xlsx`/SheetJS out of the mobile bundle) classifies sheets, maps the SUPPLY/INSTALL-vs-RATE column variants, and emits a section tree + a reconciliation report. Shared Zod schema/mappers/service in `packages/shared`. Rollups computed on read (no triggers). Re-import replaces (new `is_current` row, prior kept for audit).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase Postgres (RLS), `@esite/shared` (Zod + services), vitest, `xlsx` (SheetJS, NEW web-only dep), react-hook-form, the existing `Card`/`FormField` UI kit.

**Spec:** `docs/superpowers/specs/2026-06-08-project-rates-boq-design.md`

---

## Design conventions every task must follow

- **Migrations:** `apps/edge-functions/supabase/migrations/`; next number is **`00122`**. Adding tables to the existing `projects` schema needs only `NOTIFY pgrst, 'reload schema'` — **no PostgREST `db_schema` PATCH** (that's only for `CREATE/DROP SCHEMA`).
- **RBAC:** import `COST_VIEW_ROLES` / `ORG_WRITE_ROLES` from `@esite/shared`. Server actions: gate with `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)` after resolving the project's org. Route handlers: `requireRoleAPI(COST_VIEW_ROLES, projectOrgId)`. Pages: `requireEffectiveRole`. Never hardcode role arrays. Service-role (RLS-bypassing) writes MUST sit behind the app gate.
- **Profiles RLS trap:** any name/audit display of *other* users must resolve via `createServiceClient()` after the gate (the recurring `public.profiles` RLS lesson).
- **Service shape:** `packages/shared/src/services/<name>.service.ts` + `_<name>-mappers.ts` (snake_case ↔ camelCase). Schemas in `packages/shared/src/schemas/`.
- **Action result shape:** `Promise<{ data: T } | { error: string }>`.
- **Tests:** vitest. Shared: `pnpm --filter @esite/shared test`. Web: `pnpm --filter web test`. Type-check: `pnpm --filter web type-check` / `pnpm --filter @esite/shared type-check`. Use `vi.hoisted(() => ({...}))` for mocks in any web action test (the `next/cache` import-load hoisting TDZ trap).
- **Node-only test files** (anything importing `xlsx` / using `Buffer`) carry `// @vitest-environment node` at the top.
- **Commit** after each green step (Conventional Commits, e.g. `feat(boq): …`, `test(boq): …`).
- **Branch:** all code on `feat/project-rates-boq` (cut in Task 0).

---

## File structure (Phase 1)

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00122_project_boq_rates.sql` | 3 tables, CHECKs, FKs, RLS, triggers, `boq-imports` bucket |
| `scripts/db/smoke-test-project-boq.sh` | transactional, ROLLBACK-safe migration smoke test |
| `packages/shared/src/schemas/boq.schema.ts` | Zod schemas + enums + inferred domain types |
| `packages/shared/src/services/_boq-mappers.ts` | row ↔ domain mappers |
| `packages/shared/src/services/boq.service.ts` | `computeRollups` (pure) + client methods |
| `apps/web/src/lib/boq/types.ts` | parser I/O types |
| `apps/web/src/lib/boq/classify-sheet.ts` | pure: classify sheet + resolve column map (AoA in) |
| `apps/web/src/lib/boq/parse-sheet.ts` | pure: AoA → section tree + items for one bill sheet |
| `apps/web/src/lib/boq/parse-boq-xlsx.ts` | orchestrator: `xlsx.read` → AoA per sheet → `ParsedBoq` |
| `apps/web/src/lib/boq/reconcile.ts` | pure: recompute + compare to summary totals → report |
| `apps/web/src/actions/boq.actions.ts` | `importBoqAction` / `listBoqAction` / `updateBoqItemRateAction` / `deleteBoqImportAction` |
| `apps/web/src/app/api/projects/[id]/boq/import/route.ts` | upload → parse → reconcile (no persist) |
| `apps/web/src/app/(admin)/projects/[id]/settings/rates/page.tsx` | server page: gate + fetch + render |
| `.../settings/rates/_components/*.tsx` | master-detail UI |
| `.../settings/_components/SettingsTabs.tsx` | register the Rates tab (MODIFY) |
| `docs/rbac-matrix.md` | Rates rows (MODIFY) |

---

## Task 0: Branch + dependency

- [ ] **Step 1: Cut the feature branch**

```bash
git checkout -b feat/project-rates-boq
```

- [ ] **Step 2: Add the SheetJS dependency to the web app only**

```bash
pnpm --filter web add xlsx
```

- [ ] **Step 3: Verify it installed and is web-scoped**

Run: `pnpm --filter web list xlsx`
Expected: a version is printed under `web`. Confirm `apps/mobile/package.json` does NOT list `xlsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(boq): add xlsx (SheetJS) to web app"
```

---

## Task 1: Migration `00122` — schema, RLS, bucket

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00122_project_boq_rates.sql`
- Create: `scripts/db/smoke-test-project-boq.sh`

- [ ] **Step 1: Write the migration**

```sql
-- 00122_project_boq_rates.sql
-- Project Rates / BOQ (Phase 1): imported priced Bill of Quantities per project.
-- Adds 3 tables to the existing `projects` schema. No CREATE SCHEMA => no PostgREST PATCH needed.
BEGIN;

-- 1. boq_imports: one row per import (contract baseline + audit/version trail)
CREATE TABLE IF NOT EXISTS projects.boq_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  source_filename  text NOT NULL,
  storage_path     text,
  imported_by      uuid REFERENCES public.profiles(id),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  total_ex_vat     numeric(16,2),
  vat_amount       numeric(16,2),
  total_incl_vat   numeric(16,2),
  line_item_count  int NOT NULL DEFAULT 0,
  is_current       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS boq_imports_project_idx ON projects.boq_imports(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS boq_imports_one_current
  ON projects.boq_imports(project_id) WHERE is_current;

-- 2. boq_sections: bill/section/category tree (self-referencing)
CREATE TABLE IF NOT EXISTS projects.boq_sections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          uuid NOT NULL REFERENCES projects.boq_imports(id) ON DELETE CASCADE,
  parent_section_id  uuid,
  kind               text NOT NULL,
  code               text,
  title              text NOT NULL,
  sort_order         int NOT NULL DEFAULT 0,
  node_id            uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, id)
);
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_kind_check;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_kind_check
  CHECK (kind IN ('bill','section','category'));
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_no_self_parent;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_no_self_parent
  CHECK (parent_section_id IS NULL OR parent_section_id <> id);
-- same-import parent (composite FK; NO ACTION so a project cascade can tear the tree down)
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_parent_fk;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_parent_fk
  FOREIGN KEY (import_id, parent_section_id)
  REFERENCES projects.boq_sections(import_id, id) ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS boq_sections_import_idx ON projects.boq_sections(import_id);
CREATE INDEX IF NOT EXISTS boq_sections_parent_idx ON projects.boq_sections(parent_section_id);

-- 3. boq_items: priced leaf rows
CREATE TABLE IF NOT EXISTS projects.boq_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id     uuid NOT NULL REFERENCES projects.boq_sections(id) ON DELETE CASCADE,
  code           text,
  description    text NOT NULL,
  unit           text,
  quantity       numeric(14,3),
  quantity_mode  text NOT NULL DEFAULT 'measured',
  rate_model     text NOT NULL DEFAULT 'supply_install',
  supply_rate    numeric(14,4),
  install_rate   numeric(14,4),
  rate           numeric(14,4),
  amount         numeric(16,2),
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_quantity_mode_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_quantity_mode_check
  CHECK (quantity_mode IN ('measured','rate_only','lump_sum','provisional','pc_sum'));
ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_rate_model_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_rate_model_check
  CHECK (rate_model IN ('supply_install','single','amount_only'));
CREATE INDEX IF NOT EXISTS boq_items_section_idx ON projects.boq_items(section_id);

-- updated_at triggers (reuse the standard helper)
CREATE TRIGGER boq_imports_set_updated_at BEFORE UPDATE ON projects.boq_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER boq_sections_set_updated_at BEFORE UPDATE ON projects.boq_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER boq_items_set_updated_at BEFORE UPDATE ON projects.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: read = project access; write = owner/admin/PM. (App layer adds COST_VIEW_ROLES gating,
-- matching how contract_value is handled: DB read is project-wide, app narrows + hides.)
ALTER TABLE projects.boq_imports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.boq_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.boq_items    ENABLE ROW LEVEL SECURITY;

CREATE POLICY boq_imports_select ON projects.boq_imports FOR SELECT
  USING (public.user_has_project_access(project_id));
CREATE POLICY boq_imports_modify ON projects.boq_imports FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'));

CREATE POLICY boq_sections_select ON projects.boq_sections FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id AND public.user_has_project_access(i.project_id)));
CREATE POLICY boq_sections_modify ON projects.boq_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')));

CREATE POLICY boq_items_select ON projects.boq_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id AND public.user_has_project_access(i.project_id)));
CREATE POLICY boq_items_modify ON projects.boq_items FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')));

-- Storage bucket for the original .xlsx (private; org-scoped path {org}/{project}/{import}.xlsx)
INSERT INTO storage.buckets (id, name, public) VALUES ('boq-imports','boq-imports',false)
  ON CONFLICT (id) DO NOTHING;
CREATE POLICY boq_imports_storage_rw ON storage.objects FOR ALL
  USING (bucket_id = 'boq-imports'
         AND (storage.foldername(name))[1] IN (
            SELECT organisation_id::text FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (bucket_id = 'boq-imports'
         AND (storage.foldername(name))[1] IN (
            SELECT organisation_id::text FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active));

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 2: Write the smoke test** (transactional; rolls back; leaves no data)

```bash
#!/usr/bin/env bash
# scripts/db/smoke-test-project-boq.sh — verifies 00122 against the live DB, ROLLBACK-safe.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/mgmt-api.sh"

echo "1. tables exist + RLS enabled"
OUT="$(mgmt_query "SELECT relname, relrowsecurity FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname LIKE 'boq_%' ORDER BY 1;" || true)"
echo "$OUT" | grep -q 'boq_imports'  || { echo "FAIL: boq_imports missing"; exit 1; }
echo "$OUT" | grep -q 'boq_items'    || { echo "FAIL: boq_items missing"; exit 1; }
echo "$OUT" | grep -q 'boq_sections' || { echo "FAIL: boq_sections missing"; exit 1; }

echo "2. one-current partial unique + cascade (transactional, rolled back via RAISE)"
OUT="$(mgmt_query "DO \$\$
DECLARE p uuid; o uuid; imp uuid; sec uuid;
BEGIN
  SELECT id, organisation_id INTO p, o FROM projects.projects LIMIT 1;
  INSERT INTO projects.boq_imports(project_id,organisation_id,source_filename)
    VALUES (p,o,'smoke.xlsx') RETURNING id INTO imp;
  INSERT INTO projects.boq_sections(import_id,kind,title) VALUES (imp,'bill','SMOKE BILL') RETURNING id INTO sec;
  INSERT INTO projects.boq_items(section_id,description,amount) VALUES (sec,'smoke item',100.00);
  -- second current import for same project must fail the partial unique
  BEGIN
    INSERT INTO projects.boq_imports(project_id,organisation_id,source_filename)
      VALUES (p,o,'smoke2.xlsx');
    RAISE EXCEPTION 'FAIL: second is_current insert should have been rejected';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END \$\$;" || true)"
echo "$OUT" | grep -q 'SMOKE_OK_ROLLBACK' || { echo "FAIL: smoke asserts: $OUT"; exit 1; }
echo "ALL SMOKE TESTS PASSED (rolled back, no residue)"
```

- [ ] **Step 3: Apply the migration to the live DB** (Management API)

Run: `bash scripts/db/mgmt-api.sh` is sourced by the smoke test; to apply, use the project's apply helper:
`source scripts/db/mgmt-api.sh && mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00122_project_boq_rates.sql`
Then **record the ledger** (Management-API applies don't write `schema_migrations`): insert version `00122` per the deploy-workflow reconciliation note in CLAUDE.md, OR rely on the `deploy-migrations.yml` workflow when the branch merges (path-filtered to `migrations/**`). Expected: no API error JSON.

- [ ] **Step 4: Run the smoke test**

Run: `bash scripts/db/smoke-test-project-boq.sh`
Expected: `ALL SMOKE TESTS PASSED (rolled back, no residue)`

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00122_project_boq_rates.sql scripts/db/smoke-test-project-boq.sh
git commit -m "feat(boq): migration 00122 — boq_imports/sections/items + RLS + bucket"
```

---

## Task 2: Shared schema + enums — `boq.schema.ts`

**Files:**
- Create: `packages/shared/src/schemas/boq.schema.ts`
- Test: `packages/shared/src/schemas/boq.schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { boqItemSchema, boqItemRatePatchSchema, QUANTITY_MODES, RATE_MODELS } from './boq.schema'

describe('boq.schema', () => {
  it('accepts a valid supply/install line item', () => {
    const parsed = boqItemSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      sectionId: '00000000-0000-0000-0000-000000000002',
      code: 'C1.1', description: '4C x 185mm', unit: 'm',
      quantity: 2363, quantityMode: 'measured', rateModel: 'supply_install',
      supplyRate: 540.75, installRate: 18, rate: null, amount: 1320326.25, sortOrder: 0,
    })
    expect(parsed.amount).toBe(1320326.25)
  })
  it('rejects an unknown quantity_mode', () => {
    expect(() => boqItemSchema.parse({ quantityMode: 'bogus' } as never)).toThrow()
  })
  it('rate patch requires at least one rate field', () => {
    expect(() => boqItemRatePatchSchema.parse({})).toThrow()
    expect(boqItemRatePatchSchema.parse({ supplyRate: 10 }).supplyRate).toBe(10)
  })
  it('exposes the enum tuples', () => {
    expect(QUANTITY_MODES).toContain('rate_only')
    expect(RATE_MODELS).toContain('amount_only')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test boq.schema`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/schemas/boq.schema.ts
import { z } from 'zod'

export const QUANTITY_MODES = ['measured', 'rate_only', 'lump_sum', 'provisional', 'pc_sum'] as const
export const RATE_MODELS = ['supply_install', 'single', 'amount_only'] as const
export const SECTION_KINDS = ['bill', 'section', 'category'] as const

export const boqItemSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  quantityMode: z.enum(QUANTITY_MODES),
  rateModel: z.enum(RATE_MODELS),
  supplyRate: z.number().nullable(),
  installRate: z.number().nullable(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
  sortOrder: z.number().int(),
})

export const boqSectionSchema = z.object({
  id: z.string().uuid(),
  importId: z.string().uuid(),
  parentSectionId: z.string().uuid().nullable(),
  kind: z.enum(SECTION_KINDS),
  code: z.string().nullable(),
  title: z.string(),
  sortOrder: z.number().int(),
  nodeId: z.string().uuid().nullable(),
})

export const boqImportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  sourceFilename: z.string(),
  storagePath: z.string().nullable(),
  importedBy: z.string().uuid().nullable(),
  importedAt: z.string(),
  totalExVat: z.number().nullable(),
  vatAmount: z.number().nullable(),
  totalInclVat: z.number().nullable(),
  lineItemCount: z.number().int(),
  isCurrent: z.boolean(),
})

export const boqItemRatePatchSchema = z
  .object({
    supplyRate: z.number().nonnegative().nullable().optional(),
    installRate: z.number().nonnegative().nullable().optional(),
    rate: z.number().nonnegative().nullable().optional(),
  })
  .refine((p) => p.supplyRate !== undefined || p.installRate !== undefined || p.rate !== undefined, {
    message: 'At least one rate field is required',
  })

export type BoqItem = z.infer<typeof boqItemSchema>
export type BoqSection = z.infer<typeof boqSectionSchema>
export type BoqImport = z.infer<typeof boqImportSchema>
export type BoqItemRatePatch = z.infer<typeof boqItemRatePatchSchema>
export type QuantityMode = (typeof QUANTITY_MODES)[number]
export type RateModel = (typeof RATE_MODELS)[number]
export type SectionKind = (typeof SECTION_KINDS)[number]
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test boq.schema` → PASS. Then `pnpm --filter @esite/shared type-check` → clean.

- [ ] **Step 5: Export from the barrel + commit**

Add `export * from './schemas/boq.schema'` to `packages/shared/src/index.ts` (match the existing export style there).

```bash
git add packages/shared/src/schemas/boq.schema.ts packages/shared/src/schemas/boq.schema.test.ts packages/shared/src/index.ts
git commit -m "feat(boq): zod schema + enums for imports/sections/items"
```

---

## Task 3: Row ↔ domain mappers — `_boq-mappers.ts`

**Files:**
- Create: `packages/shared/src/services/_boq-mappers.ts`
- Test: `packages/shared/src/services/_boq-mappers.test.ts`

Mirror the existing `_project-settings-mappers.ts` style (snake_case row → camelCase domain; numeric coercion for `numeric` columns which PostgREST returns as strings).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { rowToBoqItem, boqItemToRow } from './_boq-mappers'

describe('_boq-mappers', () => {
  it('coerces PostgREST numeric strings to numbers', () => {
    const item = rowToBoqItem({
      id: 'i1', section_id: 's1', code: 'C1.1', description: '4C', unit: 'm',
      quantity: '2363', quantity_mode: 'measured', rate_model: 'supply_install',
      supply_rate: '540.75', install_rate: '18', rate: null, amount: '1320326.25', sort_order: 0,
    })
    expect(item.quantity).toBe(2363)
    expect(item.supplyRate).toBe(540.75)
    expect(item.amount).toBe(1320326.25)
  })
  it('round-trips a rate patch to snake_case row', () => {
    expect(boqItemToRow({ supplyRate: 10, amount: 200 })).toEqual({ supply_rate: 10, amount: 200 })
  })
  it('keeps nulls null (does not coerce to 0)', () => {
    const item = rowToBoqItem({ id: 'i', section_id: 's', description: 'x', quantity: null,
      quantity_mode: 'rate_only', rate_model: 'supply_install', amount: null, sort_order: 0 } as never)
    expect(item.quantity).toBeNull()
    expect(item.amount).toBeNull()
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @esite/shared test _boq-mappers`

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/services/_boq-mappers.ts
import type { BoqItem, BoqSection, BoqImport } from '../schemas/boq.schema'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function rowToBoqItem(r: Record<string, unknown>): BoqItem {
  return {
    id: r.id as string,
    sectionId: r.section_id as string,
    code: (r.code as string) ?? null,
    description: r.description as string,
    unit: (r.unit as string) ?? null,
    quantity: num(r.quantity),
    quantityMode: r.quantity_mode as BoqItem['quantityMode'],
    rateModel: r.rate_model as BoqItem['rateModel'],
    supplyRate: num(r.supply_rate),
    installRate: num(r.install_rate),
    rate: num(r.rate),
    amount: num(r.amount),
    sortOrder: Number(r.sort_order ?? 0),
  }
}

export function rowToBoqSection(r: Record<string, unknown>): BoqSection {
  return {
    id: r.id as string,
    importId: r.import_id as string,
    parentSectionId: (r.parent_section_id as string) ?? null,
    kind: r.kind as BoqSection['kind'],
    code: (r.code as string) ?? null,
    title: r.title as string,
    sortOrder: Number(r.sort_order ?? 0),
    nodeId: (r.node_id as string) ?? null,
  }
}

export function rowToBoqImport(r: Record<string, unknown>): BoqImport {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    organisationId: r.organisation_id as string,
    sourceFilename: r.source_filename as string,
    storagePath: (r.storage_path as string) ?? null,
    importedBy: (r.imported_by as string) ?? null,
    importedAt: r.imported_at as string,
    totalExVat: num(r.total_ex_vat),
    vatAmount: num(r.vat_amount),
    totalInclVat: num(r.total_incl_vat),
    lineItemCount: Number(r.line_item_count ?? 0),
    isCurrent: Boolean(r.is_current),
  }
}

// Partial domain → snake_case row (only defined keys), for rate-edit UPDATEs.
export function boqItemToRow(patch: Partial<BoqItem>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.supplyRate !== undefined) out.supply_rate = patch.supplyRate
  if (patch.installRate !== undefined) out.install_rate = patch.installRate
  if (patch.rate !== undefined) out.rate = patch.rate
  if (patch.amount !== undefined) out.amount = patch.amount
  return out
}
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @esite/shared test _boq-mappers` + type-check.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/_boq-mappers.ts packages/shared/src/services/_boq-mappers.test.ts
git commit -m "feat(boq): row<->domain mappers"
```

---

## Task 4: `computeRollups` (pure) — the displayed totals

**Files:**
- Create: `packages/shared/src/services/boq.service.ts` (start with the pure fn + amount helper)
- Test: `packages/shared/src/services/boq.service.test.ts`

`computeRollups(sections, items)` returns a `Map<sectionId, number>` of rolled-up amounts: a leaf section's total = sum of its items' amounts (null treated as 0); a parent's total = sum of its children's totals. Also export `computeItemAmount` (the single source of the amount rule).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeItemAmount, computeRollups } from './boq.service'
import type { BoqSection, BoqItem } from '../schemas/boq.schema'

const sec = (id: string, parent: string | null, kind: BoqSection['kind']): BoqSection =>
  ({ id, importId: 'imp', parentSectionId: parent, kind, code: null, title: id, sortOrder: 0, nodeId: null })
const item = (id: string, sectionId: string, over: Partial<BoqItem>): BoqItem =>
  ({ id, sectionId, code: null, description: 'x', unit: 'm', quantity: 0, quantityMode: 'measured',
     rateModel: 'supply_install', supplyRate: null, installRate: null, rate: null, amount: null, sortOrder: 0, ...over })

describe('computeItemAmount', () => {
  it('supply_install: qty x (supply+install), rounded to 2dp', () => {
    expect(computeItemAmount(item('i','s',{ quantity: 446, supplyRate: 628.3, installRate: 18 }))).toBe(288249.8)
  })
  it('single: qty x rate', () => {
    expect(computeItemAmount(item('i','s',{ rateModel: 'single', quantity: 2, rate: 50 }))).toBe(100)
  })
  it('rate_only => null', () => {
    expect(computeItemAmount(item('i','s',{ quantityMode: 'rate_only', quantity: null, supplyRate: 1122.7 }))).toBeNull()
  })
  it('amount_only: returns the stored amount untouched', () => {
    expect(computeItemAmount(item('i','s',{ rateModel: 'amount_only', amount: 399959.11 }))).toBe(399959.11)
  })
})

describe('computeRollups', () => {
  it('rolls leaf sums up the tree', () => {
    const sections = [sec('bill', null, 'bill'), sec('catA', 'bill', 'category'), sec('catB', 'bill', 'category')]
    const items = [
      item('1', 'catA', { amount: 100 }), item('2', 'catA', { amount: 50, quantityMode: 'rate_only', }),
      item('3', 'catB', { amount: 200 }),
    ]
    const totals = computeRollups(sections, items)
    expect(totals.get('catA')).toBe(150)   // null amount counts as 0; here 100 + 50
    expect(totals.get('catB')).toBe(200)
    expect(totals.get('bill')).toBe(350)
  })
})
```

(Note: in the catA case the second item has amount 50 stored even though rate_only — `computeRollups` sums stored `amount`, treating null as 0; `computeItemAmount` is the *write-time* rule. Keep these responsibilities distinct.)

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @esite/shared test boq.service`

- [ ] **Step 3: Implement (pure parts only)**

```ts
// packages/shared/src/services/boq.service.ts
import type { BoqItem, BoqSection } from '../schemas/boq.schema'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Write-time amount rule (single source of truth). */
export function computeItemAmount(item: BoqItem): number | null {
  if (item.quantityMode === 'rate_only') return null
  if (item.rateModel === 'amount_only') return item.amount ?? null
  if (item.quantity === null) return null
  if (item.rateModel === 'single') return round2(item.quantity * (item.rate ?? 0))
  return round2(item.quantity * ((item.supplyRate ?? 0) + (item.installRate ?? 0)))
}

/** Roll stored leaf `amount`s up the section tree. null amount => 0. */
export function computeRollups(sections: BoqSection[], items: BoqItem[]): Map<string, number> {
  const childrenOf = new Map<string, string[]>()
  for (const s of sections) {
    if (s.parentSectionId) (childrenOf.get(s.parentSectionId) ?? childrenOf.set(s.parentSectionId, []).get(s.parentSectionId)!).push(s.id)
  }
  const directItemSum = new Map<string, number>()
  for (const it of items) directItemSum.set(it.sectionId, (directItemSum.get(it.sectionId) ?? 0) + (it.amount ?? 0))

  const totals = new Map<string, number>()
  const visit = (id: string): number => {
    if (totals.has(id)) return totals.get(id)!
    let sum = directItemSum.get(id) ?? 0
    for (const c of childrenOf.get(id) ?? []) sum += visit(c)
    sum = round2(sum)
    totals.set(id, sum)
    return sum
  }
  for (const s of sections) visit(s.id)
  return totals
}
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @esite/shared test boq.service` + type-check.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/boq.service.ts packages/shared/src/services/boq.service.test.ts
git commit -m "feat(boq): computeItemAmount + computeRollups (pure)"
```

---

## Task 5: Service client methods — `boq.service.ts`

**Files:**
- Modify: `packages/shared/src/services/boq.service.ts`
- Test: `packages/shared/src/services/boq.service.client.test.ts`
- Modify: `packages/shared/src/index.ts` (export `boqService`)

Add a `boqService` object with client methods. Take a Supabase client (typed loosely, casting to the `projects` schema as the codebase does for non-generated schemas). Methods:
- `getCurrent(client, projectId): Promise<BoqImport | null>` — `is_current=true` row.
- `getTree(client, importId): Promise<{ sections: BoqSection[]; items: BoqItem[] }>`.
- `persistImport(client, args): Promise<BoqImport>` — flip prior current to `false`, insert import row, bulk-insert sections (parent refs resolved client-side via a temp-id→uuid map; insert roots first by depth), bulk-insert items.
- `updateItemRate(client, itemId, patch): Promise<BoqItem>` — apply `boqItemToRow`, recompute `amount` via `computeItemAmount`, write both, return mapped row.
- `setCurrent(client, importId): Promise<void>`.

- [ ] **Step 1: Write the failing test** (mocked client; assert the contract, not Supabase internals)

```ts
import { describe, it, expect, vi } from 'vitest'
import { boqService } from './boq.service'

function fakeClient(rows: Record<string, unknown>[]) {
  const api: Record<string, unknown> = {}
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain, is: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: undefined,
  }
  return { schema: () => ({ from: () => chain }), ...api } as never
}

describe('boqService.getCurrent', () => {
  it('returns the mapped current import or null', async () => {
    const out = await boqService.getCurrent(
      fakeClient([{ id: 'imp1', project_id: 'p', organisation_id: 'o', source_filename: 'f.xlsx',
        storage_path: null, imported_by: null, imported_at: '2026-06-08', total_ex_vat: '51064581.53',
        vat_amount: '7659687.23', total_incl_vat: '58724268.76', line_item_count: 2994, is_current: true }]),
      'p',
    )
    expect(out?.id).toBe('imp1')
    expect(out?.totalInclVat).toBe(58724268.76)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @esite/shared test boq.service.client`

- [ ] **Step 3: Implement the `boqService` methods.** Mirror `project-settings.service.ts` for client typing/casting and error handling (throw on `error`). Use `rowToBoqImport` / `rowToBoqSection` / `rowToBoqItem` from `_boq-mappers`. For `updateItemRate`: fetch the item, merge patch, `computeItemAmount`, write `{...boqItemToRow(patch), amount}`. For `persistImport`: build a `tempId→uuid` map, insert sections ordered by tree depth (roots first), then items.

(Full `persistImport` body — resolves parent ids client-side:)

```ts
async persistImport(client, args: {
  projectId: string; organisationId: string; sourceFilename: string; storagePath: string | null;
  importedBy: string | null; totals: { exVat: number | null; vat: number | null; inclVat: number | null };
  sections: Array<{ tempId: string; parentTempId: string | null; kind: SectionKind; code: string | null; title: string; sortOrder: number }>;
  items: Array<{ sectionTempId: string; code: string | null; description: string; unit: string | null;
    quantity: number | null; quantityMode: QuantityMode; rateModel: RateModel;
    supplyRate: number | null; installRate: number | null; rate: number | null; amount: number | null; sortOrder: number }>;
}): Promise<BoqImport> {
  const db = (client as AnyClient).schema('projects')
  // 1. demote prior current
  await db.from('boq_imports').update({ is_current: false }).eq('project_id', args.projectId).eq('is_current', true)
  // 2. insert import
  const { data: imp, error: ie } = await db.from('boq_imports').insert({
    project_id: args.projectId, organisation_id: args.organisationId, source_filename: args.sourceFilename,
    storage_path: args.storagePath, imported_by: args.importedBy, is_current: true,
    total_ex_vat: args.totals.exVat, vat_amount: args.totals.vat, total_incl_vat: args.totals.inclVat,
    line_item_count: args.items.length,
  }).select().single()
  if (ie) throw new Error(ie.message)
  // 3. sections by depth so parents exist first
  const idMap = new Map<string, string>()
  const depth = (t: string): number => { const s = args.sections.find(x => x.tempId === t)!; return s.parentTempId ? 1 + depth(s.parentTempId) : 0 }
  for (const s of [...args.sections].sort((a, b) => depth(a.tempId) - depth(b.tempId))) {
    const { data, error } = await db.from('boq_sections').insert({
      import_id: imp.id, parent_section_id: s.parentTempId ? idMap.get(s.parentTempId) : null,
      kind: s.kind, code: s.code, title: s.title, sort_order: s.sortOrder,
    }).select('id').single()
    if (error) throw new Error(error.message)
    idMap.set(s.tempId, data.id)
  }
  // 4. items (chunked insert)
  const rows = args.items.map(it => ({
    section_id: idMap.get(it.sectionTempId), code: it.code, description: it.description, unit: it.unit,
    quantity: it.quantity, quantity_mode: it.quantityMode, rate_model: it.rateModel,
    supply_rate: it.supplyRate, install_rate: it.installRate, rate: it.rate, amount: it.amount, sort_order: it.sortOrder,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('boq_items').insert(rows.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
  return rowToBoqImport(imp)
}
```

(`AnyClient` is the codebase's existing loose client type used for non-generated schemas — import it the same way `tenant-scope`/`equipment` services do, or define `type AnyClient = any` locally if there's no shared export.)

- [ ] **Step 4: Run → PASS** + type-check. Export `boqService` and the pure fns from the barrel.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/boq.service.ts packages/shared/src/services/boq.service.client.test.ts packages/shared/src/index.ts
git commit -m "feat(boq): boqService client methods (getCurrent/getTree/persistImport/updateItemRate)"
```

---

## Task 6: Parser — types + `classify-sheet` (pure, AoA in)

**Files:**
- Create: `apps/web/src/lib/boq/types.ts`
- Create: `apps/web/src/lib/boq/classify-sheet.ts`
- Test: `apps/web/src/lib/boq/classify-sheet.test.ts`

Pure functions operate on **AoA** (`(string|number|null)[][]`) + the sheet name — no `xlsx` dependency, so they're trivially testable. `classifySheet(name, rows)` returns `{ kind: 'bill'|'summary'|'prose', headerRowIndex, columns }` where `columns` maps logical fields to column indices, tolerating `SUPPLY/INSTALL` vs `RATE`, amount-only, and the `ITEA`/`SUPPLY RATE` noise.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { classifySheet } from './classify-sheet'

const HDR_SI = ['ITEM','DESCRIPTION','UNIT','QTY','SUPPLY','INSTALL','AMOUNT']
const HDR_SINGLE = ['ITEM','DESCRIPTION','UNIT','QTY','RATE','AMOUNT']

describe('classifySheet', () => {
  it('detects a supply/install bill sheet + column map', () => {
    const r = classifySheet('1.3 Low Voltage', [['KINGSWALK'], [], HDR_SI, ['C1.1','4C','m',446,628.3,18,288249.8]])
    expect(r.kind).toBe('bill'); expect(r.headerRowIndex).toBe(2)
    expect(r.columns).toMatchObject({ item: 0, description: 1, unit: 2, qty: 3, supply: 4, install: 5, amount: 6 })
    expect(r.rateModel).toBe('supply_install')
  })
  it('detects a single-rate bill sheet', () => {
    const r = classifySheet('P&G', [[], HDR_SINGLE, ['A1','x','Sum',null,null,1139424]])
    expect(r.kind).toBe('bill'); expect(r.rateModel).toBe('single'); expect(r.columns.rate).toBe(4)
  })
  it('tolerates the ITEA typo and SUPPLY RATE label', () => {
    const r = classifySheet('20-93 Cashbuild', [['ITEA','DESCRIPTION','UNIT','QTY','SUPPLY RATE','INSTALL RATE','AMOUNT']])
    expect(r.kind).toBe('bill'); expect(r.columns.supply).toBe(4); expect(r.columns.install).toBe(5)
  })
  it('classifies summary + prose sheets', () => {
    expect(classifySheet('Main Summary', [['ITEM','DESCRIPTION'],['1','MALL',null,null,null,37184510.62]]).kind).toBe('summary')
    expect(classifySheet('NOTES TO TENDERER', [['(643) KINGSWALK'],['NOTES TO TENDERER']]).kind).toBe('prose')
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter web test classify-sheet`

- [ ] **Step 3: Implement** `types.ts` + `classify-sheet.ts`.

`types.ts` defines `Aoa`, `SheetClassification`, `ColumnMap`, `ParsedItem`, `ParsedSection`, `ParsedBill`, `ParsedBoq`, `ReconciliationReport` (exact shapes used downstream — see Tasks 7-8). `classify-sheet.ts`: prose sheet names (`/NOTES TO TENDERER|QUALIFICATIONS/i`) → prose; summary names (`/MAIN SUMMARY|MALL SUMMARY/i`) → summary; else find the header row (row containing a cell `≈ 'DESCRIPTION'`), normalise headers (uppercase, trim, `ITEA→ITEM`, `SUPPLY RATE→SUPPLY`, `INSTALL RATE→INSTALL`), map columns, and set `rateModel` = `supply_install` if both SUPPLY+INSTALL present, `single` if RATE present, `amount_only` if neither but AMOUNT present.

- [ ] **Step 4: Run → PASS** + `pnpm --filter web type-check`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/boq/types.ts apps/web/src/lib/boq/classify-sheet.ts apps/web/src/lib/boq/classify-sheet.test.ts
git commit -m "feat(boq): parser types + sheet classification (pure)"
```

---

## Task 7: Parser — `parse-sheet` (AoA → tree + items)

**Files:**
- Create: `apps/web/src/lib/boq/parse-sheet.ts`
- Test: `apps/web/src/lib/boq/parse-sheet.test.ts`

`parseSheet(name, rows, classification)` walks data rows under the header and returns `{ sections: ParsedSection[]; items: ParsedItem[] }` (temp-id'd tree for one bill). Rules:
- A row whose `item` cell matches `^[A-Z]+\d+$` (e.g. `C1`, `B2`) and has no qty/rate → **category** section.
- A row whose `item` matches `^[A-Z]+\d+\.\d+` (e.g. `C1.1`) → **line item**.
- A row with text in `description` but no `item` code → a rate-note; attach to the current item/category as note context or skip.
- `QTY === 'RATE ONLY'` (case-insensitive) → `quantityMode='rate_only'`, `quantity=null`; numeric → `measured`; unit `Sum` with no qty → `lump_sum`; description containing `PROVISIONAL`/`P.C`/`PRIME COST` → `provisional`/`pc_sum`.
- `rateModel` from the classification; pull supply/install/rate/amount from the mapped columns; coerce numeric.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { classifySheet } from './classify-sheet'
import { parseSheet } from './parse-sheet'

const HDR = ['ITEM','DESCRIPTION','UNIT','QTY','SUPPLY','INSTALL','AMOUNT']
const rows = [
  ['KINGSWALK'], [], HDR,
  ['C1','LV CABLE LAID IN GROUND'],            // category
  [null,'Rates to include for supply...'],     // rate note
  ['C1.1','4C x 240mm','m',446,628.3,18,288249.8],
  ['C1.2','4C x 185mm','m','RATE ONLY',540.75,18,null],
]

it('builds a category with two items, tagging RATE ONLY', () => {
  const cls = classifySheet('1.3 Low Voltage', rows)
  const { sections, items } = parseSheet('1.3 Low Voltage', rows, cls)
  const cat = sections.find(s => s.code === 'C1')!
  expect(cat.kind).toBe('category')
  expect(items.filter(i => i.sectionTempId === cat.tempId)).toHaveLength(2)
  const rateOnly = items.find(i => i.code === 'C1.2')!
  expect(rateOnly.quantityMode).toBe('rate_only')
  expect(rateOnly.quantity).toBeNull()
  expect(rateOnly.supplyRate).toBe(540.75)
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter web test parse-sheet`

- [ ] **Step 3: Implement `parse-sheet.ts`** per the rules above (assign stable `tempId`s like `${name}#${rowIndex}`).

- [ ] **Step 4: Run → PASS** + type-check.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/boq/parse-sheet.ts apps/web/src/lib/boq/parse-sheet.test.ts
git commit -m "feat(boq): parse a single bill sheet into a section tree (pure)"
```

---

## Task 8: Parser orchestrator + reconciliation

**Files:**
- Create: `apps/web/src/lib/boq/parse-boq-xlsx.ts`
- Create: `apps/web/src/lib/boq/reconcile.ts`
- Test: `apps/web/src/lib/boq/reconcile.test.ts`
- Test: `apps/web/src/lib/boq/parse-boq-xlsx.test.ts` (`// @vitest-environment node`)

`parseBoqXlsx(buffer)`: `xlsx.read(buffer,{type:'buffer'})` → for each sheet `xlsx.utils.sheet_to_json(ws,{header:1,blankrows:false,defval:null})` → AoA → `classifySheet` → for bills `parseSheet`; group `1.x` sheets under a synthetic `MALL PORTION` bill, `N-NN Name` sheets each as their own bill (order from `Main Summary`); read the `Main Summary` totals + VAT line. Returns `ParsedBoq` (bills with temp-id trees + items + the expected per-bill/grand totals).

`reconcile(parsed)`: recompute each item amount (`computeItemAmount`-equivalent) + roll up; compare computed bill totals to the `Main Summary` expected, and the grand total; tolerance `Math.max(1, expected*0.005)`. Returns `ReconciliationReport { grandTotalComputed, grandTotalExpected, matched, billResults[], warnings[], skippedSheets[] }`.

- [ ] **Step 1: Write the failing reconcile test** (synthetic, deterministic)

```ts
import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'
import type { ParsedBoq } from './types'

const parsed: ParsedBoq = {
  grandTotalExpected: 350, totalExVatExpected: 350, vatExpected: 52.5, totalInclVatExpected: 402.5,
  bills: [{ tempId: 'b1', code: '1', title: 'MALL', expectedTotal: 350,
    sections: [{ tempId: 'c1', parentTempId: 'b1', kind: 'category', code: 'C1', title: 'cat', sortOrder: 0 }],
    items: [
      { sectionTempId: 'c1', code: 'C1.1', description: 'x', unit: 'm', quantity: 1, quantityMode: 'measured',
        rateModel: 'supply_install', supplyRate: 100, installRate: 50, rate: null, amount: 150, sortOrder: 0 },
      { sectionTempId: 'c1', code: 'C1.2', description: 'y', unit: 'm', quantity: 2, quantityMode: 'measured',
        rateModel: 'supply_install', supplyRate: 100, installRate: 0, rate: null, amount: 200, sortOrder: 1 },
    ] }],
  skippedSheets: ['NOTES TO TENDERER'],
}

it('matches when computed totals equal expected', () => {
  const r = reconcile(parsed)
  expect(r.matched).toBe(true)
  expect(r.grandTotalComputed).toBe(350)
})
it('flags a bill whose items do not sum to its expected total', () => {
  const bad = structuredClone(parsed); bad.bills[0].expectedTotal = 999
  const r = reconcile(bad)
  expect(r.matched).toBe(false)
  expect(r.billResults.find(b => b.tempId === 'b1')!.matched).toBe(false)
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter web test reconcile`

- [ ] **Step 3: Implement `reconcile.ts` then `parse-boq-xlsx.ts`.**

- [ ] **Step 4: Add an orchestrator test on a tiny in-code workbook** (build a 2-sheet workbook with `xlsx.utils.aoa_to_sheet` + `book_append_sheet`, `xlsx.write` to a buffer, feed to `parseBoqXlsx`, assert bill count + a known amount). `// @vitest-environment node` at the top.

- [ ] **Step 5: Run → PASS** + type-check. **Commit**

```bash
git add apps/web/src/lib/boq/parse-boq-xlsx.ts apps/web/src/lib/boq/reconcile.ts apps/web/src/lib/boq/*.test.ts
git commit -m "feat(boq): xlsx orchestrator + reconciliation report (pure core)"
```

---

## Task 9: Server actions — `boq.actions.ts`

**Files:**
- Create: `apps/web/src/actions/boq.actions.ts`
- Test: `apps/web/src/actions/boq.actions.test.ts`

Mirror `apps/web/src/actions/project-settings.actions.ts` exactly for: `createClient()`, resolving the project's org, `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)`, the `{ data } | { error }` result, and `revalidatePath`. Actions:

- `listBoqAction(projectId)` → gate (COST_VIEW_ROLES) → `boqService.getCurrent` + `getTree` + `computeRollups`; resolve `importedBy` display name via `createServiceClient()` (profiles-RLS lesson). Returns `{ data: { import, sections, items, totals } }`.
- `importBoqAction(projectId, parsed, sourceFilename, storagePath)` → gate → `boqService.persistImport` (writes via service client, gated) → revalidate. Returns `{ data: { import } }`.
- `updateBoqItemRateAction(projectId, itemId, patch)` → gate → **cross-project guard**: load the item's `section → import.project_id`; if `!== projectId` return `{ error: 'Not found' }` → `boqService.updateItemRate` → revalidate. Returns `{ data: { item } }`.
- `deleteBoqImportAction(projectId, importId)` → gate `ORG_WRITE_ROLES` → refuse if `is_current` → delete → revalidate.

- [ ] **Step 1: Write the failing test** (use `vi.hoisted` for the mocks — the `next/cache` TDZ trap)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  requireEffectiveRole: vi.fn(), getCurrent: vi.fn(), getTree: vi.fn(), updateItemRate: vi.fn(),
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig()), boqService: {
  getCurrent: h.getCurrent, getTree: h.getTree, updateItemRate: h.updateItemRate, computeRollups: () => new Map() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
// ...mock createClient/createServiceClient to return a fake project->org resolver

import { updateBoqItemRateAction } from './boq.actions'

beforeEach(() => { h.requireEffectiveRole.mockResolvedValue({ ok: true }) })

it('refuses a rate edit when the item belongs to another project', async () => {
  // arrange: the item resolves to project 'OTHER', action called with 'THIS'
  const res = await updateBoqItemRateAction('THIS', 'item-1', { supplyRate: 10 })
  expect('error' in res).toBe(true)
  expect(h.updateItemRate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter web test boq.actions`
- [ ] **Step 3: Implement** the four actions.
- [ ] **Step 4: Run → PASS** + type-check.
- [ ] **Step 5: Commit** `feat(boq): server actions (import/list/update-rate/delete) + RBAC + cross-project guard`

---

## Task 10: Import API route

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/boq/import/route.ts`

Mirror `apps/web/src/app/api/projects/[id]/branding-preview/route.ts` for runtime + `requireRoleAPI` usage. `export const runtime = 'nodejs'`. `POST`: `requireRoleAPI(COST_VIEW_ROLES, projectOrgId)` → read multipart `file` → `await file.arrayBuffer()` → `parseBoqXlsx(Buffer.from(...))` → `reconcile(parsed)` → return `{ parsed, report }` as JSON (no persist). Errors → 400/403 with `{ error }`.

- [ ] **Step 1:** Implement the route.
- [ ] **Step 2:** Manual verify with the dev server (covered in Task 13).
- [ ] **Step 3: Commit** `feat(boq): POST import route — parse + reconcile (no persist)`

---

## Task 11: Tab registration + page + RBAC matrix

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/_components/SettingsTabs.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/settings/rates/page.tsx`
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Register the tab.** In `SettingsTabs.tsx`: add `'rates'` to the `Slug` union and add to `TABS` (place after `contract`, since both are cost):

```ts
{ slug: 'rates', label: 'Rates', viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES },
```
Ensure `COST_VIEW_ROLES` is imported from `@esite/shared` in that file.

- [ ] **Step 2: Create `page.tsx`** (server). Mirror `settings/operational/page.tsx`: resolve project via `projectService.getById` (`notFound()` if missing) → `requireEffectiveRole(supabase, id, COST_VIEW_ROLES)`; redirect to `/projects/${id}` if `!ok` → `const res = await listBoqAction(id)` → render `<RatesTab projectId={id} initial={'data' in res ? res.data : null} />`.

- [ ] **Step 3: Update `docs/rbac-matrix.md`** — add the two Rates rows (page + import route) from spec §6.

- [ ] **Step 4: Verify** `pnpm --filter web type-check` clean; the tab appears for owner/admin/PM and is absent for other roles (component test optional here; covered by Task 13 manual check).

- [ ] **Step 5: Commit** `feat(boq): register Rates settings tab + page + rbac-matrix`

---

## Task 12: UI components (use `frontend-design`)

**Files (create in `.../settings/rates/_components/`):**
`RatesTab.tsx`, `BoqMainSummary.tsx`, `BoqSectionTree.tsx`, `BoqLineItemTable.tsx`, `RateCell.tsx`, `BoqImportDialog.tsx`, `BoqReconciliationReport.tsx`.

> **Invoke `frontend-design:frontend-design` for this task.** Use the existing Equipment & Materials tab (`/projects/[id]/equipment-materials`) as the master-detail reference. Kit: `Card/CardHeader/CardBody`, badge variants (`info` for RATE ONLY, `warning` for provisional/PC), CSS-var styling, `natural-compare.ts` for sorting, `file-open.ts` `previewViaSignedUrl` for the stored source.

Responsibilities:
- **`RatesTab.tsx`** — client shell; empty state ("Import your tender BOQ") with the Import button when `initial == null`; otherwise renders `BoqMainSummary` + drill-down.
- **`BoqMainSummary.tsx`** — bill list + per-bill totals + grand total ex/incl VAT.
- **`BoqSectionTree.tsx`** — expandable bill → section → category.
- **`BoqLineItemTable.tsx`** — `code · desc · unit · qty · supply · install · amount`, badges, natural-sorted; uses `RateCell` for editable rate cells (only for `COST_VIEW_ROLES`, passed as a `canEdit` prop from the server page).
- **`RateCell.tsx`** — inline edit → `updateBoqItemRateAction`; optimistic amount recompute via the shared `computeItemAmount`.
- **`BoqImportDialog.tsx`** — file picker → `POST /api/projects/[id]/boq/import` → render `BoqReconciliationReport`; on confirm → `importBoqAction(projectId, parsed, filename, null)`.
- **`BoqReconciliationReport.tsx`** — grand-total-vs-expected banner (green/amber), per-bill match table, warnings + skipped sheets.

- [ ] **Step 1–4:** build components; add a render/smoke test for `BoqReconciliationReport` (matched vs mismatched states) and `RatesTab` empty state.
- [ ] **Step 5: Commit** `feat(boq): Rates tab UI — main summary, drill-down, inline rate edit, import dialog`

---

## Task 13: Whole-feature verification

- [ ] **Step 1: Full type-check + tests**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter @esite/shared type-check && pnpm --filter web type-check`
Expected: all green.

- [ ] **Step 2: Real-file reconciliation (dev, manual).** With the dev server running, sign in as an owner/admin/PM on KINGSWALK, open Settings → Rates → Import, choose the real `AEEC - KIGSWALK ELECTRICAL BOQ -F - Tender.xlsx`. **Expected:** the reconciliation report shows grand total ≈ **R58,724,268.76 incl-VAT** (Mall portion ≈ **R37,184,510.62**), `matched = true`, ~2,994 items, and lists the prose sheets as skipped. Confirm → the Main Summary renders the 19 bills + grand total.

- [ ] **Step 3: Edit + RBAC spot-checks.** Edit a supply rate → amount + section/bill rollups update. Confirm the tab is absent for a `contractor`/`client_viewer` (use the RBAC fixture pattern) and that `updateBoqItemRateAction` rejects a cross-project item id.

- [ ] **Step 4: Migration on prod path.** Confirm `00122` is applied + ledger-recorded (or that `deploy-migrations.yml` will apply it on merge), and `bash scripts/db/smoke-test-project-boq.sh` is green against prod.

- [ ] **Step 5: Finish the branch** via `superpowers:finishing-a-development-branch` (PR or merge per Arno's call). ⚠ Preview shares the prod DB — only import against a throwaway/known project, and a real import WRITES rows.

---

## Self-review (author check against the spec)

- **Spec coverage:** §5.1 data model → T1; §5.2 parser → T6–T8; §5.3 import flow → T8/T10/T12; §5.4 actions → T9; §5.5 service/schema/mappers → T2–T5; §5.6 UI → T12; §5.7 tab+matrix → T11; §6 RBAC → T9/T11; §7 testing → every task + T13; D4 replace semantics → T5 `persistImport` + T1 partial-unique. ✅ All sections mapped.
- **Placeholders:** none — DB/schema/mappers/rollups/classify/parse/reconcile carry full code; convention-following tasks (T9–T12) name the exact file to mirror + the precise logic, signatures, and test assertions.
- **Type consistency:** `computeItemAmount`/`computeRollups`, `boqService.{getCurrent,getTree,persistImport,updateItemRate,setCurrent}`, the `{data}|{error}` result, and the `ParsedBoq`/`ReconciliationReport` shapes are used identically across tasks. Mapper field names match the schema (`supplyRate`/`installRate`/`quantityMode`/`rateModel`).
- **Scope:** Phase 1 only; Phases 2–4 untouched (no variations/valuations/node linking).
