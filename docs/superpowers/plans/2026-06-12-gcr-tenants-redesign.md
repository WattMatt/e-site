# GCR Tenants Tab Redesign + Report Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Generator Cost Recovery Tenants tab lose zero data (transactional bulk saves with visible per-row status), make assignment fast (selection + bulk bar + filters + coverage), and make the report PDF properly formatted and paginated.

**Architecture:** Phase A replaces the fork-once optimistic row state with "server truth + pending-patch overlay" driven by one transactional Postgres function called through a single server action (used by both single-cell and bulk edits). Phase B adds opt-in pagination primitives (repeating table headers, unbreakable rows, keep-with-next headings) to the shared react-pdf components and restructures the generator report into cover + content pages with running header/footer.

**Tech Stack:** Next.js App Router server actions, Supabase (Postgres RPC, RLS `SECURITY INVOKER`), Zod, React 18, Vitest + Testing Library, `@react-pdf/renderer`.

**Spec:** `docs/superpowers/specs/2026-06-12-gcr-tenants-design.md`

**Repo facts you need:**
- Monorepo: web app at `apps/web`, migrations at `apps/edge-functions/supabase/migrations/` (numbered `00134` next).
- Local stack: `cd apps/edge-functions && supabase start` (db on port 54322, user `postgres`/`postgres`). Web: `cd apps/web && pnpm dev` (:3000). Smoke login: `demo.owner@wmeng.co.za` / `Demo@esite2025!`; smoke project id `b0000000-0000-4000-8000-000000000001` already has 60 seeded tenant shops.
- Tests: `cd apps/web && npx vitest run <path>`. Typecheck: `cd apps/web && npx tsc --noEmit -p tsconfig.json`.
- PR #76 (`fix/table-scroll-x-shared`) edits `TenantsPanel.tsx` (wrapper swap to `<TableScrollX>`). If it has merged, branch from updated main and keep its import; if not, expect a trivial rebase conflict in the table wrapper only.

---

## Phase A — Tenants tab

### Task 1: Branch + commit the spec

**Files:** none (git only)

- [ ] **Step 1: Create the branch from up-to-date main**

```bash
cd ~/dev/e-site
git fetch origin && git checkout main && git pull --ff-only
git checkout -b feat/gcr-tenants-redesign
```

- [ ] **Step 2: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-06-12-gcr-tenants-design.md docs/superpowers/plans/2026-06-12-gcr-tenants-redesign.md
git commit -m "docs(gcr): tenants-tab redesign spec + implementation plan"
```

### Task 2: Migration — transactional bulk save function

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00134_gcr_bulk_save_tenant_assignments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00134_gcr_bulk_save_tenant_assignments.sql
-- One transactional entry point for saving tenant assignment facets in bulk.
-- SECURITY INVOKER: RLS on gcr.tenant_assignments and structure.nodes applies
-- to the calling user unchanged. "Not provided" vs "set to NULL" is carried by
-- the paired p_set_<field> booleans.

CREATE OR REPLACE FUNCTION gcr.bulk_save_tenant_assignments(
  p_project_id        UUID,
  p_node_ids          UUID[],
  p_set_zone          BOOLEAN DEFAULT FALSE,
  p_zone_id           UUID    DEFAULT NULL,
  p_set_participation BOOLEAN DEFAULT FALSE,
  p_participation     TEXT    DEFAULT NULL,
  p_set_category      BOOLEAN DEFAULT FALSE,
  p_shop_category     TEXT    DEFAULT NULL,
  p_set_manual_kw     BOOLEAN DEFAULT FALSE,
  p_manual_kw         NUMERIC DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_expected INT := COALESCE(array_length(p_node_ids, 1), 0);
  v_count    INT;
BEGIN
  IF v_expected = 0 THEN
    RAISE EXCEPTION 'No tenants supplied';
  END IF;
  IF NOT (p_set_zone OR p_set_participation OR p_set_category OR p_set_manual_kw) THEN
    RAISE EXCEPTION 'Nothing to save';
  END IF;
  IF p_set_participation AND p_participation NOT IN ('shared','own','none') THEN
    RAISE EXCEPTION 'Invalid participation';
  END IF;
  IF p_set_category AND p_shop_category IS NOT NULL
     AND p_shop_category NOT IN ('standard','fast_food','restaurant','national','other') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  -- Every node must be a live tenant_db node of this project.
  SELECT count(*) INTO v_count
  FROM structure.nodes n
  WHERE n.id = ANY(p_node_ids)
    AND n.project_id = p_project_id
    AND n.kind = 'tenant_db'
    AND n.deleted_at IS NULL;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'One or more shops do not belong to this project';
  END IF;

  IF p_set_zone OR p_set_manual_kw THEN
    INSERT INTO gcr.tenant_assignments (node_id, project_id, organisation_id, zone_id, manual_kw_override)
    SELECT n.id, p_project_id, n.organisation_id,
           CASE WHEN p_set_zone      THEN p_zone_id   ELSE NULL END,
           CASE WHEN p_set_manual_kw THEN p_manual_kw ELSE NULL END
    FROM structure.nodes n
    WHERE n.id = ANY(p_node_ids)
    ON CONFLICT (node_id) DO UPDATE SET
      zone_id            = CASE WHEN p_set_zone      THEN EXCLUDED.zone_id            ELSE gcr.tenant_assignments.zone_id END,
      manual_kw_override = CASE WHEN p_set_manual_kw THEN EXCLUDED.manual_kw_override ELSE gcr.tenant_assignments.manual_kw_override END;
  END IF;

  IF p_set_participation OR p_set_category THEN
    UPDATE structure.nodes SET
      generator_participation = CASE WHEN p_set_participation THEN p_participation ELSE generator_participation END,
      shop_category           = CASE WHEN p_set_category      THEN p_shop_category ELSE shop_category END
    WHERE id = ANY(p_node_ids);
  END IF;

  RETURN v_expected;
END;
$$;

GRANT EXECUTE ON FUNCTION gcr.bulk_save_tenant_assignments TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to the local stack and smoke it via psql**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f apps/edge-functions/supabase/migrations/00134_gcr_bulk_save_tenant_assignments.sql
```

Then verify behaviour (runs as superuser — RLS is bypassed here; this checks the SQL logic only):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres <<'SQL'
-- happy path: set category on two seeded smoke shops
SELECT gcr.bulk_save_tenant_assignments(
  'b0000000-0000-4000-8000-000000000001',
  ARRAY['d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002']::uuid[],
  p_set_category => true, p_shop_category => 'fast_food');
SELECT id, shop_category FROM structure.nodes WHERE id IN ('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
-- wrong-project node must raise
DO $$ BEGIN
  PERFORM gcr.bulk_save_tenant_assignments(
    'b0000000-0000-4000-8000-000000000001',
    ARRAY['00000000-0000-0000-0000-000000000001']::uuid[],
    p_set_category => true, p_shop_category => 'standard');
  RAISE EXCEPTION 'should not reach';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%do not belong%' THEN RAISE; END IF;
END $$;
SQL
```

Expected: first SELECT returns 2; the two rows show `fast_food`; the DO block completes without "should not reach".

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00134_gcr_bulk_save_tenant_assignments.sql
git commit -m "feat(gcr): transactional bulk_save_tenant_assignments function"
```

### Task 3: Exclude recycled/decommissioned shops from GCR data

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts` (the tenants query inside `loadGcrConfigAction`)
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Follow the file's existing mock style (`createClientMock`, `requireEffectiveRoleMock`). Add:

```ts
describe('loadGcrConfigAction — tenant query filters', () => {
  it('excludes soft-deleted and decommissioned shops', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true })
    const calls: Record<string, unknown[][]> = { eq: [], is: [], neq: [] }
    // chainable query stub that records filter calls and resolves to empty data
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn((...a: unknown[]) => { calls.eq.push(a); return chain }),
      is: vi.fn((...a: unknown[]) => { calls.is.push(a); return chain }),
      neq: vi.fn((...a: unknown[]) => { calls.neq.push(a); return chain }),
      order: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    createClientMock.mockResolvedValue({ schema: vi.fn(() => ({ from: vi.fn(() => chain) })) })

    const { loadGcrConfigAction } = await import('./gcr.actions')
    await loadGcrConfigAction(PROJECT_ID)

    expect(calls.is).toContainEqual(['deleted_at', null])
    expect(calls.neq).toContainEqual(['status', 'decommissioned'])
  })
})
```

- [ ] **Step 2: Run it — must fail**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts" -t "excludes soft-deleted"
```

Expected: FAIL (`calls.is` empty).

- [ ] **Step 3: Implement**

In `loadGcrConfigAction`, change the tenants query:

```ts
      (supabase as any)
        .schema('structure')
        .from('nodes')
        .select('id, shop_number, shop_name, shop_area_m2, shop_category, generator_participation')
        .eq('project_id', projectId)
        .eq('kind', 'tenant_db')
        .is('deleted_at', null)
        .neq('status', 'decommissioned'),
```

- [ ] **Step 4: Run the test file — all green**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts"
git commit -m "fix(gcr): exclude recycled and decommissioned shops from tenant data"
```

### Task 4: Bulk schema + server action (replaces saveTenantAssignmentAction)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.schemas.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts`
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts`

- [ ] **Step 1: Add the schema (gcr.schemas.ts)** — replace the existing `gcrAssignmentSchema` block with:

```ts
// ─── Tenant assignment (bulk patch) ───────────────────────────────────────────

export const gcrAssignmentPatchSchema = z
  .object({
    zone_id:            z.string().uuid().nullable().optional(),
    participation:      z.enum(['shared', 'own', 'none']).optional(),
    shop_category:      z.enum(['standard', 'fast_food', 'restaurant', 'national', 'other']).nullable().optional(),
    manual_kw_override: z.coerce.number().nullable().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Nothing to save' })

export const gcrBulkAssignmentSchema = z.object({
  nodeIds: z.array(z.string().uuid()).min(1).max(500),
  patch:   gcrAssignmentPatchSchema,
})

export type GcrAssignmentPatch = z.infer<typeof gcrAssignmentPatchSchema>
```

Delete `gcrAssignmentSchema` and `GcrAssignmentInput` (their only consumer is removed in this task).

- [ ] **Step 2: Write the failing action tests** — in `gcr.actions.test.ts`, add (reuse the file's `makeProjectSchemaChain` style; the rpc chain is new):

```ts
function makeRpcSchemaChain(orgId: string, rpcResult: { data: unknown; error: null | { message: string } }) {
  const maybeSingle  = vi.fn().mockResolvedValue({ data: { organisation_id: orgId }, error: null })
  const eqId         = vi.fn().mockReturnValue({ maybeSingle })
  const select       = vi.fn().mockReturnValue({ eq: eqId })
  const fromProjects = vi.fn().mockReturnValue({ select })
  const rpc          = vi.fn().mockResolvedValue(rpcResult)
  const schema = vi.fn((name: string) =>
    name === 'projects' ? { from: fromProjects } : { rpc },
  )
  return { schema, rpc }
}

describe('bulkSaveTenantAssignmentsAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty patch', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: 1, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], {})
    expect(res).toEqual({ error: 'Nothing to save' })
  })

  it('maps the patch to set-flag rpc params (null zone = explicit clear)', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema, rpc } = makeRpcSchemaChain(ORG_ID, { data: 2, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID, ZONE_ID], { zone_id: null, participation: 'own' })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', {
      p_project_id: PROJECT_ID,
      p_node_ids: [NODE_ID, ZONE_ID],
      p_set_zone: true,
      p_zone_id: null,
      p_set_participation: true,
      p_participation: 'own',
      p_set_category: false,
      p_shop_category: null,
      p_set_manual_kw: false,
      p_manual_kw: null,
    })
    expect(res).toEqual({ ok: true, updated: 2 })
  })

  it('returns the rpc error message on failure', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: null, error: { message: 'One or more shops do not belong to this project' } })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], { participation: 'none' })
    expect(res).toEqual({ error: 'One or more shops do not belong to this project' })
  })

  it('gates on role', async () => {
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: 1, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], { participation: 'none' })
    expect(res).toEqual({ error: 'Forbidden' })
  })
})
```

Also delete the existing `saveTenantAssignmentAction` describe block.

- [ ] **Step 3: Run — must fail** (action doesn't exist yet)

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts" -t "bulkSaveTenantAssignmentsAction"
```

- [ ] **Step 4: Implement the action (gcr.actions.ts)** — replace the whole `saveTenantAssignmentAction` function with:

```ts
// ─── bulkSaveTenantAssignmentsAction ─────────────────────────────────────────

/**
 * One save path for single-cell edits AND bulk-bar applies.
 * Transactional via gcr.bulk_save_tenant_assignments (SECURITY INVOKER — RLS
 * applies to the caller). Patch fields absent = untouched; null = cleared.
 */
export async function bulkSaveTenantAssignmentsAction(
  projectId: string,
  nodeIds: string[],
  patch: GcrAssignmentPatch,
): Promise<{ ok: true; updated: number } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrBulkAssignmentSchema.safeParse({ nodeIds, patch })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const p = parsed.data.patch

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .rpc('bulk_save_tenant_assignments', {
      p_project_id:        projectId,
      p_node_ids:          parsed.data.nodeIds,
      p_set_zone:          p.zone_id !== undefined,
      p_zone_id:           p.zone_id ?? null,
      p_set_participation: p.participation !== undefined,
      p_participation:     p.participation ?? null,
      p_set_category:      p.shop_category !== undefined,
      p_shop_category:     p.shop_category ?? null,
      p_set_manual_kw:     p.manual_kw_override !== undefined,
      p_manual_kw:         p.manual_kw_override ?? null,
    })

  if (error) {
    console.error('[gcr-bulk-save] failed', {
      projectId, nodeCount: parsed.data.nodeIds.length, patch: p, error: error.message,
    })
    return { error: error.message ?? 'Failed to save tenant assignments' }
  }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true, updated: (data as number | null) ?? parsed.data.nodeIds.length }
}
```

Update imports: add `gcrBulkAssignmentSchema, type GcrAssignmentPatch` to the `./gcr.schemas` import; remove `gcrAssignmentSchema, type GcrAssignmentInput`.

Note: `TenantsPanel.tsx` still imports `saveTenantAssignmentAction` — it breaks the typecheck until Task 6 rewrites it. That is fine inside this branch; run only the action test file here.

- [ ] **Step 5: Run the action tests — green**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.schemas.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.test.ts"
git commit -m "feat(gcr): bulkSaveTenantAssignmentsAction — one transactional save path"
```

### Task 5: Pure display/filter/coverage helpers

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.ts`
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  toDisplayTenant, matchesFilter, filterCounts, needsSetup, isConfigured, zoneCoverage,
  type DisplayTenant, type TenantFilter,
} from './tenant-display'
import { DEFAULT_GENERATOR_SETTINGS } from '@esite/shared'

const base: DisplayTenant = {
  id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100,
  category: 'standard', participation: 'shared', zoneId: 'z1', manualKwOverride: null,
}

describe('toDisplayTenant', () => {
  it('overlays a pending patch on server truth', () => {
    const t = toDisplayTenant(
      { id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100, shop_category: 'standard', generator_participation: 'shared' },
      { node_id: 't1', zone_id: 'z1', manual_kw_override: null },
      { zone_id: null, participation: 'own' },
    )
    expect(t.zoneId).toBeNull()          // patched
    expect(t.participation).toBe('own')  // patched
    expect(t.category).toBe('standard')  // server
  })
})

describe('matchesFilter / filterCounts', () => {
  const tenants: DisplayTenant[] = [
    base,
    { ...base, id: 't2', zoneId: null },
    { ...base, id: 't3', category: null },
    { ...base, id: 't4', participation: 'own', zoneId: null },
  ]
  it('no_zone counts only participating shops without a zone', () => {
    expect(tenants.filter((t) => matchesFilter(t, 'no_zone')).map((t) => t.id)).toEqual(['t2'])
  })
  it('uncategorized / opted_out / zone filters', () => {
    expect(tenants.filter((t) => matchesFilter(t, 'uncategorized')).map((t) => t.id)).toEqual(['t3'])
    expect(tenants.filter((t) => matchesFilter(t, 'opted_out')).map((t) => t.id)).toEqual(['t4'])
    expect(tenants.filter((t) => matchesFilter(t, { zoneId: 'z1' })).map((t) => t.id)).toEqual(['t1', 't3'])
  })
  it('counts agree with predicates', () => {
    const c = filterCounts(tenants)
    expect(c).toEqual({ all: 4, no_zone: 1, uncategorized: 1, opted_out: 1, byZone: { z1: 2 } })
  })
})

describe('needsSetup / isConfigured', () => {
  it('shared shop without zone or category needs setup', () => {
    expect(needsSetup({ ...base, zoneId: null })).toBe(true)
    expect(needsSetup({ ...base, category: null })).toBe(true)
    expect(needsSetup(base)).toBe(false)
    expect(needsSetup({ ...base, participation: 'none', zoneId: null })).toBe(false)
  })
  it('configured = categorised AND (zoned OR opted out)', () => {
    expect(isConfigured(base)).toBe(true)
    expect(isConfigured({ ...base, zoneId: null })).toBe(false)
    expect(isConfigured({ ...base, zoneId: null, participation: 'own' })).toBe(true)
    expect(isConfigured({ ...base, category: null })).toBe(false)
  })
})

describe('zoneCoverage', () => {
  it('sums kW per zone and parses capacity only when every size parses', () => {
    const zones = [{ id: 'z1', zone_name: 'North', zone_number: 1 }] as never
    const gens  = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: '250', generator_cost: 0 }] as never
    const cov = zoneCoverage([base, { ...base, id: 't2', shop_area_m2: 200 }], zones, gens, DEFAULT_GENERATOR_SETTINGS)
    expect(cov.perZone).toHaveLength(1)
    expect(cov.perZone[0].shopCount).toBe(2)
    expect(cov.perZone[0].totalKw).toBeGreaterThan(0)
    expect(cov.perZone[0].installedKva).toBe(250)
    expect(cov.configured).toBe(2)
    expect(cov.total).toBe(2)
  })
  it('omits capacity when a size does not parse', () => {
    const zones = [{ id: 'z1', zone_name: 'North', zone_number: 1 }] as never
    const gens  = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: 'two-fifty', generator_cost: 0 }] as never
    const cov = zoneCoverage([base], zones, gens, DEFAULT_GENERATOR_SETTINGS)
    expect(cov.perZone[0].installedKva).toBeNull()
  })
})
```

- [ ] **Step 2: Run — must fail** (module missing)

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.test.ts"
```

- [ ] **Step 3: Implement `tenant-display.ts`**

```ts
/**
 * Pure display-model helpers for the GCR Tenants tab.
 * Display value = server truth + pending patch overlay; everything downstream
 * (filters, counts, coverage) computes off the display value so the UI is
 * always self-consistent.
 */
import {
  calculateTenantLoadingKw,
  type GeneratorSettings,
  type GeneratorParticipation,
  type ShopCategory,
  type TenantNodeRow,
  type GcrTenantAssignmentRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
} from '@esite/shared'
import type { GcrAssignmentPatch } from './gcr.schemas'

export interface DisplayTenant {
  id: string
  shop_number: string | null
  shop_name: string | null
  shop_area_m2: number | null
  category: ShopCategory | null
  participation: GeneratorParticipation
  zoneId: string | null
  manualKwOverride: number | null
}

const VALID_CATEGORIES = new Set(['standard', 'fast_food', 'restaurant', 'national', 'other'])

export function toDisplayTenant(
  node: TenantNodeRow,
  assignment: GcrTenantAssignmentRow | undefined,
  patch: GcrAssignmentPatch | undefined,
): DisplayTenant {
  const rawCat = node.shop_category
  const serverCategory = rawCat && VALID_CATEGORIES.has(rawCat) ? (rawCat as ShopCategory) : null
  return {
    id: node.id,
    shop_number: node.shop_number,
    shop_name: node.shop_name,
    shop_area_m2: node.shop_area_m2,
    category:          patch?.shop_category      !== undefined ? patch.shop_category      : serverCategory,
    participation:     patch?.participation      !== undefined ? patch.participation      : node.generator_participation,
    zoneId:            patch?.zone_id            !== undefined ? patch.zone_id            : assignment?.zone_id ?? null,
    manualKwOverride:  patch?.manual_kw_override !== undefined ? patch.manual_kw_override : assignment?.manual_kw_override ?? null,
  }
}

export type TenantFilter = 'all' | 'no_zone' | 'uncategorized' | 'opted_out' | { zoneId: string }

export function matchesFilter(t: DisplayTenant, f: TenantFilter): boolean {
  if (f === 'all') return true
  if (f === 'no_zone') return t.participation === 'shared' && t.zoneId === null
  if (f === 'uncategorized') return t.category === null
  if (f === 'opted_out') return t.participation !== 'shared'
  return t.zoneId === f.zoneId
}

export function filterCounts(tenants: DisplayTenant[]) {
  const byZone: Record<string, number> = {}
  let no_zone = 0, uncategorized = 0, opted_out = 0
  for (const t of tenants) {
    if (matchesFilter(t, 'no_zone')) no_zone++
    if (matchesFilter(t, 'uncategorized')) uncategorized++
    if (matchesFilter(t, 'opted_out')) opted_out++
    if (t.zoneId) byZone[t.zoneId] = (byZone[t.zoneId] ?? 0) + 1
  }
  return { all: tenants.length, no_zone, uncategorized, opted_out, byZone }
}

/** Shared shop missing zone or category — the "needs setup" bucket. */
export function needsSetup(t: DisplayTenant): boolean {
  return t.participation === 'shared' && (t.zoneId === null || t.category === null)
}

/** Configured = categorised AND (zoned OR explicitly opted out). */
export function isConfigured(t: DisplayTenant): boolean {
  return t.category !== null && (t.zoneId !== null || t.participation !== 'shared')
}

export interface ZoneCoverage {
  zoneId: string
  zoneName: string
  shopCount: number
  totalKw: number
  /** Sum of parseable generator sizes; null when any size fails parseFloat. */
  installedKva: number | null
}

export function zoneCoverage(
  tenants: DisplayTenant[],
  zones: GcrZoneRow[],
  generators: GcrZoneGeneratorRow[],
  settings: GeneratorSettings,
): { perZone: ZoneCoverage[]; configured: number; total: number } {
  const perZone = zones.map((z) => {
    const inZone = tenants.filter((t) => t.zoneId === z.id && t.participation === 'shared')
    const totalKw = inZone.reduce(
      (sum, t) =>
        sum +
        calculateTenantLoadingKw(
          {
            shopNumber: t.shop_number ?? '',
            shopName: t.shop_name ?? '',
            areaM2: t.shop_area_m2 ?? 0,
            category: t.category ?? 'standard',
            participation: t.participation,
            manualKwOverride: t.manualKwOverride,
          },
          settings,
        ),
      0,
    )
    const sizes = generators.filter((g) => g.zone_id === z.id).map((g) => parseFloat(g.generator_size ?? ''))
    const installedKva = sizes.length > 0 && sizes.every((n) => Number.isFinite(n))
      ? sizes.reduce((a, b) => a + b, 0)
      : null
    return { zoneId: z.id, zoneName: z.zone_name, shopCount: inZone.length, totalKw, installedKva }
  })
  return {
    perZone,
    configured: tenants.filter(isConfigured).length,
    total: tenants.length,
  }
}
```

- [ ] **Step 4: Run — green**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/tenant-display.test.ts"
git commit -m "feat(gcr): pure display/filter/coverage helpers for tenants tab"
```

### Task 6: Rewrite TenantsPanel — overlay state, commit-on-change, per-row status

This is the core task. The panel is rewritten around `useAssignmentSaves` (new hook, same folder). Selection/bulk bar/filters/coverage are Tasks 7–9 — this task ships the persistence model with the existing columns.

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/useAssignmentSaves.ts`
- Rewrite: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { bulkSaveTenantAssignmentsAction } from './gcr.actions'
import type { GcrAssignmentPatch } from './gcr.schemas'

export type SaveStatus =
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string; patch: GcrAssignmentPatch }

const SAVED_FLASH_MS = 1500

/**
 * Save queue for tenant assignments.
 * - `pending` is the optimistic overlay (display = server + pending).
 * - Saves for a node already in flight coalesce into one follow-up save.
 * - Success: status flashes 'saved', router.refresh() pulls server truth;
 *   the overlay entry is dropped by reconcile() once props match it.
 * - Failure: overlay dropped immediately (cells snap back), status carries
 *   the message and the failed patch for retry.
 */
export function useAssignmentSaves(projectId: string) {
  const router = useRouter()
  const [pending, setPending] = useState<Record<string, GcrAssignmentPatch>>({})
  const [status, setStatus] = useState<Record<string, SaveStatus>>({})
  const inFlight = useRef<Set<string>>(new Set())
  const queued = useRef<Map<string, GcrAssignmentPatch>>(new Map())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  function patchState<T>(setter: React.Dispatch<React.SetStateAction<Record<string, T>>>, ids: string[], value: T | undefined) {
    setter((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        if (value === undefined) delete next[id]
        else next[id] = value
      }
      return next
    })
  }

  async function commitWithResult(
    nodeIds: string[],
    patch: GcrAssignmentPatch,
  ): Promise<{ ok: true; updated: number } | { error: string }> {
    const now: string[] = []
    for (const id of nodeIds) {
      if (inFlight.current.has(id)) {
        queued.current.set(id, { ...queued.current.get(id), ...patch })
      } else {
        now.push(id)
        inFlight.current.add(id)
      }
    }
    if (now.length === 0) return { ok: true, updated: 0 } // everything coalesced into queued follow-ups

    setPending((prev) => {
      const next = { ...prev }
      for (const id of now) next[id] = { ...next[id], ...patch }
      return next
    })
    patchState(setStatus, now, { state: 'saving' } as SaveStatus)

    let res: Awaited<ReturnType<typeof bulkSaveTenantAssignmentsAction>>
    try {
      res = await bulkSaveTenantAssignmentsAction(projectId, now, patch)
    } catch (e) {
      res = { error: e instanceof Error ? e.message : 'Save failed — check your connection' }
    }

    for (const id of now) inFlight.current.delete(id)

    if ('error' in res) {
      console.error('[gcr-tenants] save failed', { nodeIds: now, patch, error: res.error })
      patchState(setPending, now, undefined)
      patchState(setStatus, now, { state: 'error', message: res.error, patch } as SaveStatus)
    } else {
      patchState(setStatus, now, { state: 'saved' } as SaveStatus)
      for (const id of now) {
        const existing = timers.current.get(id)
        if (existing) clearTimeout(existing)
        timers.current.set(id, setTimeout(() => {
          setStatus((prev) => (prev[id]?.state === 'saved' ? (({ [id]: _, ...rest }) => rest)(prev) : prev))
        }, SAVED_FLASH_MS))
      }
      router.refresh()
    }

    // Follow-ups queued while this save was in flight
    for (const id of now) {
      const q = queued.current.get(id)
      if (q) {
        queued.current.delete(id)
        void commitWithResult([id], q)
      }
    }
    return res
  }

  /** Fire-and-track save — per-row UI feedback only, no caller result needed. */
  function commit(nodeIds: string[], patch: GcrAssignmentPatch) {
    void commitWithResult(nodeIds, patch)
  }

  function retry(nodeId: string) {
    const st = status[nodeId]
    if (st?.state === 'error') commit([nodeId], st.patch)
  }

  /** Drop pending overlays the server now agrees with (call when props change). */
  function reconcile(serverMatches: (nodeId: string, patch: GcrAssignmentPatch) => boolean) {
    setPending((prev) => {
      let changed = false
      const next: typeof prev = {}
      for (const [id, patch] of Object.entries(prev)) {
        if (!inFlight.current.has(id) && serverMatches(id, patch)) { changed = true; continue }
        next[id] = patch
      }
      return changed ? next : prev
    })
  }

  return { pending, status, commit, commitWithResult, retry, reconcile }
}
```

- [ ] **Step 2: Write the failing component tests**

Replace the `saveTenantAssignmentAction` mock in `TenantsPanel.test.tsx` with `bulkSaveTenantAssignmentsAction` (keep `bulkSetUncategorizedTenantsAction`):

```ts
const bulkSaveMock = vi.fn()
const bulkMock = vi.fn()
vi.mock('./gcr.actions', () => ({
  bulkSaveTenantAssignmentsAction: (...args: unknown[]) => bulkSaveMock(...args),
  bulkSetUncategorizedTenantsAction: (...args: unknown[]) => bulkMock(...args),
}))
```

Add the new persistence tests:

```ts
describe('TenantsPanel — instant save with per-row status', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zone select commits on change (no blur needed) with a single-node bulk call', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const zoneSelects = screen.getAllByLabelText(/zone for/i)
    await user.selectOptions(zoneSelects[0], 'z1')
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1'], { zone_id: 'z1' }),
    )
    expect(refreshMock).toHaveBeenCalled()
  })

  it('participation click failure reverts the cell and shows a retry affordance', async () => {
    bulkSaveMock.mockResolvedValue({ error: 'Forbidden' })
    const user = userEvent.setup()
    await renderPanel()
    // t1 starts 'shared'; click 'Own generator' on its row
    const row = screen.getByText('Alpha').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Own generator' }))
    // error surfaced with retry; the segmented control is back on Shared
    await waitFor(() => expect(within(row).getByRole('button', { name: /retry/i })).toBeInTheDocument())
    expect(within(row).getByRole('button', { name: 'Shared' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(row).getByText('Forbidden')).toBeInTheDocument()
  })

  it('retry re-sends the failed patch', async () => {
    bulkSaveMock.mockResolvedValueOnce({ error: 'boom' }).mockResolvedValueOnce({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const row = screen.getByText('Alpha').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Own generator' }))
    await user.click(await within(row).findByRole('button', { name: /retry/i }))
    await waitFor(() => expect(bulkSaveMock).toHaveBeenLastCalledWith(PROJECT_ID, ['t1'], { participation: 'own' }))
  })

  it('kW override commits on Enter', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 })
    const user = userEvent.setup()
    await renderPanel()
    const kwInputs = screen.getAllByLabelText(/manual kw for/i)
    await user.type(kwInputs[0], '12.5{Enter}')
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1'], { manual_kw_override: 12.5 }),
    )
  })

  it('a row save does NOT disable other rows', async () => {
    let resolve!: (v: unknown) => void
    bulkSaveMock.mockReturnValue(new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    await renderPanel()
    const rows = screen.getAllByRole('row')
    await user.click(within(rows[1]).getByRole('button', { name: 'Own generator' }))
    // While t1 is saving, t2's controls remain enabled
    expect(within(rows[2]).getByRole('button', { name: 'Shared' })).toBeEnabled()
    resolve({ ok: true, updated: 1 })
  })
})
```

Add `within` to the testing-library import. Update any existing tests that asserted the old onBlur/save behaviour to the new expectations (the bulk-categorize tests remain valid).

- [ ] **Step 3: Run — must fail**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx"
```

- [ ] **Step 4: Rewrite TenantsPanel.tsx**

Keep: props interface, `settingsToEngine`, readiness card, bulk-categorize button, empty state, table wrapper (`<TableScrollX>` if PR #76 merged, else the existing div), `TH/TD/SELECT_STYLE` constants. Replace all row-state machinery:

```tsx
'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
// ...existing imports (Card, Button, shared types, calculateTenantLoadingKw, checkReadiness)...
import { bulkSetUncategorizedTenantsAction } from './gcr.actions'
import { useAssignmentSaves } from './useAssignmentSaves'
import { toDisplayTenant, type DisplayTenant } from './tenant-display'
import type { GcrAssignmentPatch } from './gcr.schemas'

export function TenantsPanel({ projectId, settings, zones, generators, tenants, assignments, onNavigateToReports }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition() // bulk-categorize only
  const engineSettings = useMemo(() => settingsToEngine(settings), [settings])

  const { pending, status, commit, retry, reconcile } = useAssignmentSaves(projectId)

  // kW drafts: text being typed, committed on Enter/blur
  const [kwDrafts, setKwDrafts] = useState<Record<string, string>>({})

  const assignmentsByNode = useMemo(() => {
    const m = new Map<string, GcrTenantAssignmentRow>()
    for (const a of assignments) m.set(a.node_id, a)
    return m
  }, [assignments])

  // Display model: server truth + pending overlay (recomputed every render —
  // router.refresh() therefore reconciles the screen automatically).
  const displayed: DisplayTenant[] = useMemo(
    () => tenants.map((t) => toDisplayTenant(t, assignmentsByNode.get(t.id), pending[t.id])),
    [tenants, assignmentsByNode, pending],
  )

  // Drop pending entries the server has caught up with.
  useEffect(() => {
    reconcile((nodeId, patch) => {
      const node = tenants.find((t) => t.id === nodeId)
      if (!node) return true
      const server = toDisplayTenant(node, assignmentsByNode.get(nodeId), undefined)
      return (
        (patch.zone_id === undefined || server.zoneId === patch.zone_id) &&
        (patch.participation === undefined || server.participation === patch.participation) &&
        (patch.shop_category === undefined || server.category === patch.shop_category) &&
        (patch.manual_kw_override === undefined || server.manualKwOverride === patch.manual_kw_override)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, assignmentsByNode])

  function commitKw(t: DisplayTenant) {
    const draft = kwDrafts[t.id]
    if (draft === undefined) return
    const trimmed = draft.trim()
    const value = trimmed === '' ? null : parseFloat(trimmed)
    if (value !== null && Number.isNaN(value)) return // leave draft + pending dot; no save
    setKwDrafts((prev) => { const n = { ...prev }; delete n[t.id]; return n })
    if (value !== t.manualKwOverride) void commit([t.id], { manual_kw_override: value })
  }

  // ...sorted, readiness (computed from `displayed` now), bulk-categorize as before...
```

Row rendering changes (inside `sorted.map` — now mapping over `displayed` sorted by shop number):

```tsx
{/* Category — commits on change */}
<td style={TD}>
  <select
    aria-label={`Category for ${t.shop_number ?? t.id}`}
    value={t.category ?? ''}
    onChange={(e) => void commit([t.id], { shop_category: (e.target.value || null) as ShopCategory | null })}
    style={/* unchanged styling incl. amber empty state */}
  >
    {t.category === null && <option value="" disabled>— set category —</option>}
    {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
      <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
    ))}
  </select>
</td>

{/* Participation — segmented control, commits on click, aria-pressed reflects display value */}
<td style={TD}>
  <div style={{ display: 'flex', gap: 2 }}>
    {PARTICIPATION_OPTIONS.map((opt) => (
      <button
        key={opt.value}
        type="button"
        aria-pressed={t.participation === opt.value}
        onClick={() => { if (t.participation !== opt.value) void commit([t.id], { participation: opt.value }) }}
        style={/* unchanged segmented styling keyed off t.participation */}
      >
        {opt.label}
      </button>
    ))}
  </div>
</td>

{/* Zone — commits on change */}
<td style={TD}>
  <select
    aria-label={`Zone for ${t.shop_number ?? t.id}`}
    value={t.zoneId ?? ''}
    onChange={(e) => void commit([t.id], { zone_id: e.target.value || null })}
    style={SELECT_STYLE}
  >
    <option value="">—</option>
    {zones.map((z) => <option key={z.id} value={z.id}>{z.zone_name}</option>)}
  </select>
</td>

{/* Manual kW — draft → Enter/blur commit; dot while draft differs */}
<td style={{ ...TD, textAlign: 'right' }}>
  <input
    aria-label={`Manual kW for ${t.shop_number ?? t.id}`}
    type="number" step="0.01" min={0}
    value={kwDrafts[t.id] ?? (t.manualKwOverride != null ? String(t.manualKwOverride) : '')}
    onChange={(e) => setKwDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
    onKeyDown={(e) => { if (e.key === 'Enter') commitKw(t) }}
    onBlur={() => commitKw(t)}
    placeholder="—"
    style={{ ...SELECT_STYLE, width: 90, textAlign: 'right' }}
  />
  {kwDrafts[t.id] !== undefined && <span title="Not saved yet — press Enter" style={{ color: 'var(--c-amber)' }}> ●</span>}
</td>

{/* Row status cell */}
<td style={{ ...TD, width: 90 }}>
  {status[t.id]?.state === 'saving' && <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Saving…</span>}
  {status[t.id]?.state === 'saved' && <span style={{ fontSize: 11, color: 'var(--c-green, #16a34a)' }}>✓ Saved</span>}
  {status[t.id]?.state === 'error' && (
    <span style={{ fontSize: 11, color: 'var(--c-red)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span title={(status[t.id] as { message: string }).message}>⚠ {(status[t.id] as { message: string }).message}</span>
      <button type="button" onClick={() => retry(t.id)} style={{ fontSize: 11, textDecoration: 'underline', background: 'none', border: 'none', color: 'var(--c-red)', cursor: 'pointer' }}>
        Retry
      </button>
    </span>
  )}
</td>
```

Delete: `RowState`, `initRowState`, `rows` state, `rowErrors`, `updateRow`, `saveRow`, the participation `startTransition` save, every `disabled={busy}` on row controls (`busy` remains only on the bulk-categorize button via `isPending`). Loading-kW and readiness computations now read from `displayed`.

- [ ] **Step 5: Run the component tests — green**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx"
```

- [ ] **Step 6: Typecheck (whole app must compile again now)**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/"
git commit -m "feat(gcr): instant per-row saves with visible status — no more silent data loss"
```

### Task 7: Selection + bulk bar

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/BulkBar.tsx`
- Modify: `TenantsPanel.tsx` (checkbox column, selection state, bar mount)
- Test: `TenantsPanel.test.tsx`

- [ ] **Step 1: Failing tests**

```ts
describe('TenantsPanel — selection + bulk bar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('select-all + bulk zone apply sends one call with all visible ids', async () => {
    bulkSaveMock.mockResolvedValue({ ok: true, updated: 3 })
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    await user.selectOptions(screen.getByLabelText(/bulk assign zone/i), 'z1')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() =>
      expect(bulkSaveMock).toHaveBeenCalledWith(PROJECT_ID, ['t1', 't2', 't3'], { zone_id: 'z1' }),
    )
    expect(await screen.findByText(/applied to 3 shops/i)).toBeInTheDocument()
  })

  it('bulk failure shows the error and a retry', async () => {
    bulkSaveMock.mockResolvedValueOnce({ error: 'Forbidden' }).mockResolvedValueOnce({ ok: true, updated: 3 })
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    await user.selectOptions(screen.getByLabelText(/bulk assign zone/i), 'z1')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(bulkSaveMock).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run — fail.** Same vitest command as Task 6.

- [ ] **Step 3: Implement `BulkBar.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { GcrZoneRow, ShopCategory, GeneratorParticipation } from '@esite/shared'
import type { GcrAssignmentPatch } from './gcr.schemas'

interface Props {
  selectedCount: number
  zones: GcrZoneRow[]
  onApply: (patch: GcrAssignmentPatch) => Promise<{ ok: true; updated: number } | { error: string }>
  onClear: () => void
}

const CATEGORY_OPTIONS: { value: ShopCategory; label: string }[] = [
  { value: 'standard', label: 'Standard' }, { value: 'fast_food', label: 'Fast food' },
  { value: 'restaurant', label: 'Restaurant' }, { value: 'national', label: 'National' },
  { value: 'other', label: 'Other' },
]
const PARTICIPATION_OPTIONS: { value: GeneratorParticipation; label: string }[] = [
  { value: 'shared', label: 'Shared' }, { value: 'own', label: 'Own generator' }, { value: 'none', label: 'Not on generator' },
]

export function BulkBar({ selectedCount, zones, onApply, onClear }: Props) {
  const [zoneId, setZoneId] = useState('')
  const [participation, setParticipation] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok'; n: number } | { kind: 'error'; message: string; patch: GcrAssignmentPatch } | null>(null)

  function buildPatch(): GcrAssignmentPatch {
    const patch: GcrAssignmentPatch = {}
    if (zoneId !== '') patch.zone_id = zoneId === '__clear__' ? null : zoneId
    if (participation !== '') patch.participation = participation as GeneratorParticipation
    if (category !== '') patch.shop_category = category as ShopCategory
    return patch
  }

  async function apply(patch: GcrAssignmentPatch) {
    if (Object.keys(patch).length === 0) return
    setBusy(true); setResult(null)
    const res = await onApply(patch)
    setBusy(false)
    setResult('error' in res ? { kind: 'error', message: res.error, patch } : { kind: 'ok', n: res.updated })
  }

  if (selectedCount === 0) return null
  return (
    <div role="toolbar" aria-label="Bulk actions" style={{
      position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 14px', background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8,
    }}>
      <strong style={{ fontSize: 13 }}>{selectedCount} selected</strong>
      <select aria-label="Bulk assign zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={busy}>
        <option value="">Zone…</option>
        <option value="__clear__">— no zone —</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.zone_name}</option>)}
      </select>
      <select aria-label="Bulk set participation" value={participation} onChange={(e) => setParticipation(e.target.value)} disabled={busy}>
        <option value="">Participation…</option>
        {PARTICIPATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select aria-label="Bulk set category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
        <option value="">Category…</option>
        {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Button size="sm" variant="primary" disabled={busy || Object.keys(buildPatch()).length === 0} onClick={() => void apply(buildPatch())}>
        Apply
      </Button>
      <Button size="sm" variant="secondary" onClick={onClear} disabled={busy}>Clear</Button>
      {result?.kind === 'ok' && <span style={{ fontSize: 12, color: 'var(--c-green, #16a34a)' }}>Applied to {result.n} shops</span>}
      {result?.kind === 'error' && (
        <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)', display: 'inline-flex', gap: 8 }}>
          {result.message}
          <button type="button" onClick={() => void apply(result.patch)} style={{ textDecoration: 'underline', background: 'none', border: 'none', color: 'var(--c-red)', cursor: 'pointer', fontSize: 12 }}>
            Retry
          </button>
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire into TenantsPanel**

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set())
const visible = displayedSorted // after filtering in Task 8; for now all sorted rows

function toggleAll(checked: boolean) {
  setSelected(checked ? new Set(visible.map((t) => t.id)) : new Set())
}
function toggleOne(id: string, checked: boolean) {
  setSelected((prev) => { const n = new Set(prev); if (checked) n.add(id); else n.delete(id); return n })
}

// BulkBar reuses the same save queue (per-row statuses animate) AND gets the
// action result back for its own success/error feedback:
// <BulkBar onApply={(patch) => commitWithResult([...selected], patch)} ... />
```

Table header gains the checkbox column:

```tsx
<th style={{ ...TH, width: 34 }}>
  <input type="checkbox" aria-label="Select all visible shops"
    checked={visible.length > 0 && selected.size === visible.length}
    onChange={(e) => toggleAll(e.target.checked)} />
</th>
```

Each row:

```tsx
<td style={TD}>
  <input type="checkbox" aria-label={`Select ${t.shop_number ?? t.id}`}
    checked={selected.has(t.id)} onChange={(e) => toggleOne(t.id, e.target.checked)} />
</td>
```

Mount above the table: `<BulkBar selectedCount={selected.size} zones={zones} onApply={(p) => commitWithResult([...selected], p)} onClear={() => setSelected(new Set())} />`

- [ ] **Step 5: Run tests — green; typecheck; commit**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx" && npx tsc --noEmit -p tsconfig.json
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/"
git commit -m "feat(gcr): row selection + bulk assignment bar"
```

### Task 8: Filter chips + needs-setup banner

**Files:**
- Modify: `TenantsPanel.tsx`
- Test: `TenantsPanel.test.tsx`

- [ ] **Step 1: Failing tests**

```ts
describe('TenantsPanel — filters + setup banner', () => {
  beforeEach(() => { vi.clearAllMocks(); bulkSaveMock.mockResolvedValue({ ok: true, updated: 1 }) })

  it('banner reports shops needing setup and applies the no-zone filter', async () => {
    const user = userEvent.setup()
    await renderPanel() // fixtures: t1..t3 all shared, no zone assignments → all need setup
    expect(screen.getByText(/3 shops need setup/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show/i }))
    // Filter chip becomes active; table shows only matching rows (all 3 here)
    expect(screen.getByRole('button', { name: /no zone \(3\)/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('zone chip filters rows and select-all selects only the filtered set', async () => {
    const user = userEvent.setup()
    const assignments = [{ node_id: 't1', zone_id: 'z1', manual_kw_override: null }]
    const { TenantsPanel } = await import('./TenantsPanel')
    render(<TenantsPanel projectId={PROJECT_ID} settings={SETTINGS} zones={ZONES} generators={GENERATORS}
      tenants={TENANTS} assignments={assignments} onNavigateToReports={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /north \(1\)/i }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
  })

  it('changing filter clears the selection', async () => {
    const user = userEvent.setup()
    await renderPanel()
    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /uncategorized/i }))
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement in TenantsPanel**

```tsx
const [filter, setFilter] = useState<TenantFilter>('all')
const counts = useMemo(() => filterCounts(displayed), [displayed])
const setupCount = useMemo(() => displayed.filter(needsSetup).length, [displayed])

const displayedSorted = useMemo(
  () => [...displayed]
    .filter((t) => matchesFilter(t, filter))
    .sort((a, b) => (a.shop_number ?? '').localeCompare(b.shop_number ?? '', undefined, { numeric: true, sensitivity: 'base' })),
  [displayed, filter],
)

function applyFilter(f: TenantFilter) {
  setFilter(f)
  setSelected(new Set()) // predictable: selection clears on filter change
}
```

Chips row (above the table, below the bulk bar):

```tsx
<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
  {([
    { key: 'all' as const, label: `All (${counts.all})` },
    { key: 'no_zone' as const, label: `No zone (${counts.no_zone})` },
    { key: 'uncategorized' as const, label: `Uncategorized (${counts.uncategorized})` },
    { key: 'opted_out' as const, label: `Opted out (${counts.opted_out})` },
  ]).map((c) => (
    <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => applyFilter(c.key)} style={chipStyle(filter === c.key)}>
      {c.label}
    </button>
  ))}
  {zones.map((z) => (
    <button key={z.id} type="button"
      aria-pressed={typeof filter === 'object' && filter.zoneId === z.id}
      onClick={() => applyFilter({ zoneId: z.id })}
      style={chipStyle(typeof filter === 'object' && filter.zoneId === z.id)}>
      {z.zone_name} ({counts.byZone[z.id] ?? 0})
    </button>
  ))}
</div>
```

```tsx
function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    border: '1px solid var(--c-border)',
    background: active ? 'var(--c-amber)' : 'var(--c-panel)',
    color: active ? 'var(--c-text-on-amber, #0D0B09)' : 'var(--c-text-mid)',
    fontWeight: active ? 600 : 400,
  }
}
```

Banner (inside the readiness card body, above the bulk-categorize button):

```tsx
{setupCount > 0 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
    <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{setupCount} shops need setup (zone or category missing).</span>
    <Button size="sm" variant="secondary" onClick={() => applyFilter('no_zone')}>Show</Button>
  </div>
)}
```

The table body maps over `displayedSorted`; `visible` for select-all is `displayedSorted`.

- [ ] **Step 4: Run tests — green; commit**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx"
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/"
git commit -m "feat(gcr): filter chips + needs-setup banner on tenants tab"
```

### Task 9: Coverage strip

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/CoverageStrip.tsx`
- Modify: `TenantsPanel.tsx`
- Test: `TenantsPanel.test.tsx`

- [ ] **Step 1: Failing test**

```ts
describe('TenantsPanel — coverage strip', () => {
  it('shows per-zone kW, capacity when parseable, and the configured count', async () => {
    const assignments = [{ node_id: 't1', zone_id: 'z1', manual_kw_override: null }]
    const { TenantsPanel } = await import('./TenantsPanel')
    render(<TenantsPanel projectId={PROJECT_ID} settings={SETTINGS} zones={ZONES} generators={GENERATORS}
      tenants={TENANTS} assignments={assignments} onNavigateToReports={vi.fn()} />)
    const strip = screen.getByLabelText(/coverage/i)
    expect(within(strip).getByText('North')).toBeInTheDocument()
    expect(within(strip).getByText(/1 shop/)).toBeInTheDocument()
    expect(within(strip).getByText(/250 kVA/)).toBeInTheDocument()    // '250 kVA' parses via parseFloat
    expect(within(strip).getByText(/1 of 3 configured/i)).toBeInTheDocument() // only t1 has category+zone
  })
})
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement `CoverageStrip.tsx`**

```tsx
'use client'

import type { ZoneCoverage } from './tenant-display'

interface Props {
  perZone: ZoneCoverage[]
  configured: number
  total: number
}

export function CoverageStrip({ perZone, configured, total }: Props) {
  return (
    <div aria-label="Coverage" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={cardStyle}>
        <div style={labelStyle}>Configured</div>
        <div style={valueStyle}>{configured} of {total} configured</div>
      </div>
      {perZone.map((z) => (
        <div key={z.zoneId} style={cardStyle}>
          <div style={labelStyle}>{z.zoneName}</div>
          <div style={valueStyle}>{z.shopCount} shop{z.shopCount === 1 ? '' : 's'} · {z.totalKw.toFixed(1)} kW</div>
          {z.installedKva !== null && (
            <div style={{ ...labelStyle, marginTop: 2 }}>
              {z.installedKva.toFixed(0)} kVA installed
              {z.totalKw > 0 && ` · ${Math.round((z.totalKw / z.installedKva) * 100)}% utilised`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-panel)', minWidth: 140,
}
const labelStyle: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--c-text-dim)', fontWeight: 600,
}
const valueStyle: React.CSSProperties = { fontSize: 13, color: 'var(--c-text)', marginTop: 2 }
```

Wire in TenantsPanel (above the filter chips):

```tsx
const coverage = useMemo(
  () => zoneCoverage(displayed, zones, generators, engineSettings),
  [displayed, zones, generators, engineSettings],
)
// in render:
<CoverageStrip perZone={coverage.perZone} configured={coverage.configured} total={coverage.total} />
```

(`zoneCoverage`'s utilisation note: `installedKva` is kVA and `totalKw` is kW — the strip labels them distinctly and the % is indicative; the report's sizing table applies the power factor properly.)

- [ ] **Step 4: Run full panel tests + typecheck — green; commit**

```bash
cd apps/web && npx vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/" && npx tsc --noEmit -p tsconfig.json
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/"
git commit -m "feat(gcr): per-zone coverage strip on tenants tab"
```

### Task 10: Phase A gates, live verification, PR

- [ ] **Step 1: Full quality gates**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx next lint --file "src/app/(admin)/projects/[id]/generator-cost-recovery"
```

Expected: all green (full vitest may take a few minutes).

- [ ] **Step 2: Seed minimal GCR config on the smoke project (local stack running)**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres <<'SQL'
INSERT INTO gcr.zones (id, project_id, organisation_id, zone_name, zone_number)
VALUES
 ('f1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Zone 1',1),
 ('f1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Zone 2',2)
ON CONFLICT DO NOTHING;
INSERT INTO gcr.zone_generators (id, zone_id, organisation_id, generator_number, generator_size, generator_cost)
VALUES ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',1,'500',1250000)
ON CONFLICT DO NOTHING;
SQL
```

- [ ] **Step 3: Live verification script (real browser at localhost:3000, demo.owner login)**

On `/projects/b0000000-0000-4000-8000-000000000001/generator-cost-recovery` → Tenants tab, verify each:

1. Change one shop's category → "Saving… → ✓ Saved" appears on that row; other rows stay enabled; reload the page → value persisted.
2. Rapid-fire: change category on row 1, immediately participation on row 2, zone on row 3 → all three show ✓ and persist after reload (the old bug's exact scenario).
3. Select-all (with "No zone" filter) → bulk assign Zone 1 → "Applied to N shops"; reload → zones persisted; coverage card counts match.
4. Failure path: in DevTools set network offline → change a value → row shows ⚠ with message + Retry; cell snapped back to the previous value; go online → Retry → ✓.
5. Recycle a shop on the Tenant Schedule page → it disappears from the GCR Tenants tab and counts.

- [ ] **Step 4: PR**

```bash
git push -u origin feat/gcr-tenants-redesign
gh pr create --title "feat(gcr): tenants tab — transactional saves, bulk assignment, filters & coverage" --body "<summarise: root cause, fix model, bulk workflow, lifecycle, coverage, verification evidence. End with the Claude Code attribution.>"
```

Wait for CI green; squash-merge (repo convention); verify Vercel production deploy completes.

---

## Phase B — Report PDF formatting + pagination

Branch: `fix/gcr-report-pagination` from main after Phase A merges.

### Task 11: Pagination primitives in shared report components (additive, opt-in)

**Files:**
- Modify: `apps/web/src/lib/reports/interior.tsx` (Table at ~line 488, Section at ~line 393)
- Test: `apps/web/src/lib/reports/interior.test.tsx`

`interior.tsx` is shared with `inspection-report.tsx` — every change here is **opt-in via new props with unchanged defaults**, except `minPresenceAhead` on Section headings which is a safe universal improvement (prevents orphaned headings; layout otherwise identical).

- [ ] **Step 1: Failing tests** (follow the existing render-to-tree pattern in `interior.test.tsx`; if it asserts via `react-test-renderer`, mirror that)

```tsx
describe('Table pagination props', () => {
  it('marks the header row fixed when repeatHeader is set', () => {
    const tree = renderTree(<Table columns={['A']} rows={[['1']]} repeatHeader />)
    const headerRow = findFirstWithStyle(tree, 'tableHeaderRow')
    expect(headerRow.props.fixed).toBe(true)
  })
  it('marks body rows unbreakable when unbreakableRows is set', () => {
    const tree = renderTree(<Table columns={['A']} rows={[['1']]} unbreakableRows />)
    const bodyRow = findFirstWithStyle(tree, 'tableBodyRow')
    expect(bodyRow.props.wrap).toBe(false)
  })
  it('right-aligns the requested columns', () => {
    const tree = renderTree(<Table columns={['A', 'B']} rows={[['1', '2']]} align={['left', 'right']} />)
    // second header/body cell carries textAlign right
  })
  it('defaults change nothing (inspection report safety)', () => {
    const tree = renderTree(<Table columns={['A']} rows={[['1']]} />)
    expect(findFirstWithStyle(tree, 'tableHeaderRow').props.fixed).toBeUndefined()
    expect(findFirstWithStyle(tree, 'tableBodyRow').props.wrap).toBeUndefined()
  })
})
```

(Adapt `renderTree`/`findFirstWithStyle` to whatever helpers `interior.test.tsx` already uses — read that file first and follow its conventions exactly.)

- [ ] **Step 2: Run — fail.**

```bash
cd apps/web && npx vitest run src/lib/reports/interior.test.tsx
```

- [ ] **Step 3: Implement**

Replace the `Table` component:

```tsx
interface TableProps {
  columns: string[]
  rows: string[][]
  /** Repeat the header row at the top of every page this table spans. */
  repeatHeader?: boolean
  /** Prevent body rows from splitting across a page break. */
  unbreakableRows?: boolean
  /** Per-column horizontal alignment (default left). */
  align?: ('left' | 'right')[]
}

export function Table({ columns, rows, repeatHeader, unbreakableRows, align }: TableProps) {
  const cellStyle = (base: object, i: number) =>
    align?.[i] === 'right' ? [base, { textAlign: 'right' as const }] : base
  return (
    <View>
      {/* Header — `fixed` repeats it on every page the table flows across */}
      <View style={s.tableHeaderRow} fixed={repeatHeader || undefined}>
        {columns.map((col, i) => (
          <Text key={i} style={cellStyle(s.tableHeaderCell, i)}>{col}</Text>
        ))}
      </View>
      {/* Body */}
      {rows.map((row, ri) => (
        <View key={ri} style={s.tableBodyRow} wrap={unbreakableRows ? false : undefined}>
          {row.map((cell, ci) => (
            <Text key={ci} style={cellStyle(s.tableBodyCell, ci)}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}
```

In `Section`, keep the heading with its content:

```tsx
export function Section({ title, accent, children }: SectionProps) {
  return (
    <View style={s.section} wrap>
      <View
        style={[s.sectionRule, { backgroundColor: accent, height: spacing.sectionRuleHeight }]}
        minPresenceAhead={40}
      />
      <Text style={s.sectionHeading} minPresenceAhead={40}>{title}</Text>
      {children}
    </View>
  )
}
```

- [ ] **Step 4: Run interior tests + the inspection report's tests — all green (regression gate)**

```bash
cd apps/web && npx vitest run src/lib/reports/
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/reports/interior.tsx apps/web/src/lib/reports/interior.test.tsx
git commit -m "feat(reports): opt-in table pagination (repeat headers, unbreakable rows, column align)"
```

### Task 12: Repaginate the generator report

**Files:**
- Modify: `apps/web/src/lib/reports/generator-report.tsx`

- [ ] **Step 1: Restructure the Document** — currently everything (cover + all sections) flows on ONE `<Page>`. Change to:

```tsx
return (
  <Document title="Generator Cost Recovery Report" producer="e-site.live">
    {/* Page 1 — cover only (provides its own fixed footer) */}
    <Page size="A4" style={s.page}>
      <Cover resolved={branding} />
    </Page>

    {/* Content pages — running header + page-number footer on every page */}
    <Page size="A4" style={s.page}>
      <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
      <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

      {/* sections exactly as before, with table props below */}
    </Page>
  </Document>
)
```

(Check `RunningFooter`'s exact props in `interior.tsx` around line 374 and pass what it expects — it already renders `pageNumber / totalPages`.)

- [ ] **Step 2: Apply the pagination props to every table**

```tsx
// Plant sizing
<Table
  columns={['Board / Zone', 'Connected load (kW)', 'Required (kVA)', 'Installed (kVA)']}
  rows={sizingRows}
  repeatHeader unbreakableRows
  align={['left', 'right', 'right', 'right']}
/>

// Appendix A
<Table columns={['Item', 'Amount']} rows={capitalRows} repeatHeader unbreakableRows align={['left', 'right']} />

// Appendix C per-zone tables
<Table
  columns={['Shop', 'Tenant', 'Area m²', 'Loading kW', '% of total', 'Monthly (excl VAT)', 'R/m²']}
  rows={[...g.rows, ['', 'Subtotal', '', '', '', zar(g.subtotal), '']]}
  repeatHeader unbreakableRows
  align={['left', 'left', 'right', 'right', 'right', 'right', 'right']}
/>
```

And keep zone-group headings with their tables:

```tsx
{showZoneHeadings && (
  <Text style={[ss.zoneGroupHeading, { color: accent }]} minPresenceAhead={60}>{g.zoneName}</Text>
)}
```

- [ ] **Step 3: Typecheck + report tests**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/reports/
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/reports/generator-report.tsx
git commit -m "fix(gcr): paginated report — cover page, running header/footer, repeating table headers"
```

### Task 13: Visual verification + PR

- [ ] **Step 1: Generate a real PDF against the smoke project** (local stack + dev server running; tenants configured from Task 10's verification — ensure readiness is green: settings saved, zones+generator exist, all shops categorised + zoned/opted-out)

Either click **Generate** on the Reports tab, or mint a session and POST:

```bash
curl -s -X POST "http://localhost:3000/api/projects/b0000000-0000-4000-8000-000000000001/generator-cost-recovery/reports" \
  -H "Cookie: sb-127-auth-token=<minted session cookie>" -o /dev/null -w "%{http_code}\n"
```

Expected: 201. Download the revision from the Reports tab (or sign the storage path via psql/storage API) to `/tmp/gcr-report.pdf`.

- [ ] **Step 2: Page-by-page inspection** (open the PDF; check every page)

- Cover page stands alone.
- Every content page shows the running header AND "page X / Y" footer.
- Appendix C with 60 tenants spans multiple pages: the column header row repeats at the top of every continuation page; no row is split across pages; no zone heading sits orphaned at a page bottom.
- Numeric columns right-aligned; currency formatted "R 1 234 567.89".

If any check fails, fix in `generator-report.tsx`/`interior.tsx`, regenerate, re-inspect — do not ship on the first render that "looks okay" at a glance.

- [ ] **Step 3: Full gates + PR**

```bash
cd apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run
git push -u origin fix/gcr-report-pagination
gh pr create --title "fix(gcr): properly formatted and paginated report PDF" --body "<before/after page screenshots + verification checklist. End with the Claude Code attribution.>"
```

Wait for CI green; squash-merge; confirm Vercel production deploy.

---

## Self-review checklist (run after writing code, before each PR)

- Spec section A1–A5/B → covered by Tasks 3, 2+4+6, 7, 8, 9 / 11–13.
- No remaining imports of `saveTenantAssignmentAction` / `gcrAssignmentSchema` anywhere (`grep -rn "saveTenantAssignmentAction\|gcrAssignmentSchema" apps/web/src` returns nothing).
- `TenantsPanel.test.tsx` has no test still asserting blur-saves or global disable.
- Migration applied locally AND committed; `NOTIFY pgrst` present (PostgREST must expose the function for `.rpc()` to work).
