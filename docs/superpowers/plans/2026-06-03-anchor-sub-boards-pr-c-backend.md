# Anchor Sub-Boards — PR-C (Backend: create actions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server actions to create a `sub_board` (with its equipment-style order) or a concession (`tenant_db` + `tenant_details`) under an anchor, plus `tenant_units` CRUD — the backend the PR-C-UI slice will call. No UI in this PR.

**Architecture:** A new `apps/web/src/actions/tenant-board.actions.ts` mirroring `equipment.actions.ts` exactly: raw PostgREST writes (`Content-Profile: structure` + service key — never `.schema('structure').insert`), `guardProjectAccess`, and `deriveEquipmentNodeOrder` (kind-agnostic, from PR-B) for the sub-board order. No generated-`types.ts` regen needed — `parent_node_id` is already on the hand-written `Node` (PR-B), writes are untyped, and `tenant_units` reads use the established `(supabase as any).schema('structure')` cast (same as the `inspections` schema).

**Tech Stack:** Next.js server actions, Zod, raw PostgREST, `@esite/shared`, `vitest`.

---

## Context the implementer needs

- **Spec:** `docs/superpowers/specs/2026-06-02-anchor-tenant-sub-boards-design.md` (§4.3 procurement; §4.5 UI — UI is the *next* slice). Migration `00116` (live) added `parent_node_id`, `sub_board`, `tenant_units`. PR-B added the `Node`/`NodeKind` types + owning-lease helpers.
- **Branch:** `feat/anchor-sub-boards-pr-c` (already checked out). Repo root `/Users/spud/Developer/ESITE.V1/esite`.
- **The template to mirror:** `apps/web/src/actions/equipment.actions.ts`. Its lines **29–121** are the reusable helpers (`structureHeaders`, `structurePost`, `structurePatch`, `uuidSchema`, `guardProjectAccess`, `guardNodeBelongsToProject`); its `createEquipmentNodeAction` (127–219) is the create+order pattern. `'use server'` files may only export async functions, so these helpers are duplicated as internal module functions (the codebase already duplicates them between `equipment.actions.ts` and `tenant-scope.actions.ts` — follow that convention).
- **`structureDelete`** exists in `apps/web/src/actions/tenant-scope.actions.ts` (line 80) — copy it too (for unit delete).
- **Scope decisions:**
  - A **sub_board** gets an equipment-style order via `deriveEquipmentNodeOrder` (one `node_orders` row, `scope_item_type_id` null, status `required`) — exactly like equipment.
  - A **concession** is a full `tenant_db` lease: create the node **plus** a `tenant_details` row (defaults handle scope/layout status, per migration `00080`) so it behaves as a tenant in the schedule. It does **not** get an equipment order (its orders come from the scope grid later).
  - **Auth:** mirror the equipment template — `guardProjectAccess` (authenticated + project accessible via RLS). Matches the existing equipment create action. (Tightening writes to owner/admin/PM via `requireEffectiveRole` is a separate, codebase-wide hardening, out of scope here.)
- **Test command:** `pnpm --filter web exec vitest run tenant-board` (single file) · `pnpm --filter web test` (full) · `pnpm --filter web type-check`.

## File structure

- **Modify** `packages/shared/src/structure/node-schema.ts` — add `'sub_board'` to `nodeKindEnum`; add `parent_node_id` to `nodeBaseSchema`.
- **Create** `apps/web/src/actions/tenant-board.actions.ts` — helpers + `createSubBoardAction`, `createConcessionAction`, `addTenantUnitAction`, `updateTenantUnitAction`, `deleteTenantUnitAction`.
- **Create** `apps/web/src/actions/tenant-board.actions.test.ts` — validation + happy-path tests.

---

## Task 1: `node-schema.ts` — `sub_board` + `parent_node_id`

**Files:**
- Modify: `packages/shared/src/structure/node-schema.ts`

- [ ] **Step 1: Add `'sub_board'` to `nodeKindEnum`.** Replace the `nodeKindEnum` (lines 3–12) with:

```ts
const nodeKindEnum = z.enum([
  'tenant_db',
  'main_board',
  'common_area_board',
  'common_area_lighting',
  'rmu',
  'mini_sub',
  'generator',
  'custom',
  'sub_board',
]);
```

- [ ] **Step 2: Add `parent_node_id` to `nodeBaseSchema`.** In `packages/shared/src/structure/node-schema.ts`, change:

```ts
  kind: nodeKindEnum,
  custom_kind_label: z.string().nullable().optional(),
```

to:

```ts
  kind: nodeKindEnum,
  parent_node_id: z.string().uuid().nullable().optional(),
  custom_kind_label: z.string().nullable().optional(),
```

- [ ] **Step 3: Type-check — expect PASS**

Run: `pnpm --filter @esite/shared type-check`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/structure/node-schema.ts
git commit -m "feat(shared): node-schema accepts sub_board kind + parent_node_id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `tenant-board.actions.ts` — sub-board + concession creation

**Files:**
- Create: `apps/web/src/actions/tenant-board.actions.ts`
- Create: `apps/web/src/actions/tenant-board.actions.test.ts`

- [ ] **Step 1: Create the action file.** Create `apps/web/src/actions/tenant-board.actions.ts`:

```ts
'use server'

/**
 * tenant-board.actions.ts — create sub-boards / concessions / units under an
 * anchor in the Tenant Schedule. Mirrors equipment.actions.ts: all structure
 * writes go through raw PostgREST (Content-Profile: structure + service key),
 * never supabase-js `.schema('structure').insert()` (which strips service auth).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService, deriveEquipmentNodeOrder } from '@esite/shared'

// ── PostgREST helpers (mirror equipment.actions.ts / tenant-scope.actions.ts) ──

function structureHeaders(serviceKey: string, ret: 'representation' | 'minimal' = 'representation'): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: `return=${ret}`,
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
  ret: 'representation' | 'minimal' = 'representation',
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey, ret),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: ret === 'representation' ? await res.json() : undefined }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey, 'minimal'),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

async function structureDelete(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: structureHeaders(serviceKey, 'minimal'),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ── Guards (mirror equipment.actions.ts) ──

const uuidSchema = z.string().uuid()

async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined; user?: undefined }
  | { error?: undefined; user: object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }
  return { user, orgId: project.organisation_id as string, supabase }
}

async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Node not found or does not belong to this project' }
  return null
}

/** Resolve a tenant_units row's owning project (tenant_units is not in the generated
 *  types, so the structure read is cast — same pattern as the inspections schema). */
async function guardUnitBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: unit } = await (supabase as unknown as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { node_id: string } | null }> } }
      }
    }
  })
    .schema('structure')
    .from('tenant_units')
    .select('node_id')
    .eq('id', unitId)
    .maybeSingle()
  if (!unit) return { error: 'Unit not found' }
  return guardNodeBelongsToProject(supabase, unit.node_id, projectId)
}

function serverEnv(): { serviceKey: string; supabaseUrl: string } | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return null
  return { serviceKey, supabaseUrl }
}

const TENANT_SCHEDULE_PATH = (projectId: string) => `/projects/${projectId}/tenant-schedule`

export type CreateNodeResult = { error: string } | { id: string }

// ── createSubBoardAction ──

const createSubBoardSchema = z.object({
  projectId: uuidSchema,
  parentNodeId: uuidSchema,
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().max(120).optional(),
  breakerRatingA: z.number().positive().nullable().optional(),
  section: z.enum(['NORMAL', 'EMERGENCY', 'MIXED']).nullable().optional(),
  cocRequired: z.boolean().optional(),
})

export async function createSubBoardAction(
  projectId: string,
  parentNodeId: string,
  code: string,
  name: string = '',
  breakerRatingA: number | null = null,
  section: string | null = null,
  cocRequired: boolean = false,
): Promise<CreateNodeResult> {
  const parsed = createSubBoardSchema.safeParse({ projectId, parentNodeId, code, name, breakerRatingA, section, cocRequired })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const parentGuard = await guardNodeBelongsToProject(guard.supabase, parentNodeId, projectId)
  if (parentGuard) return { error: 'Parent board not found in this project' }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const body: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: guard.orgId,
    kind: 'sub_board',
    parent_node_id: parentNodeId,
    code: code.trim(),
    name: name.trim() || null,
    breaker_rating_a: breakerRatingA,
    section,
    coc_required: cocRequired,
    status: 'active',
    created_by: (guard.user as { id?: string }).id ?? null,
  }

  const result = await structurePost(env.supabaseUrl, env.serviceKey, 'nodes', body)
  if (!result.ok) {
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to create sub-board' }
  }

  const nodeId = (result.data as Array<{ id: string }>)[0]?.id ?? ''
  if (nodeId) {
    const orderPayload = deriveEquipmentNodeOrder(nodeId, projectId, guard.orgId, code.trim())
    const orderRes = await structurePost(env.supabaseUrl, env.serviceKey, 'node_orders', orderPayload as unknown as Record<string, unknown>, 'minimal')
    if (!orderRes.ok) {
      revalidatePath(TENANT_SCHEDULE_PATH(projectId))
      return { error: `Sub-board created but order derivation failed: ${orderRes.error}` }
    }
  }

  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { id: nodeId }
}

// ── createConcessionAction ──

const createConcessionSchema = z.object({
  projectId: uuidSchema,
  parentNodeId: uuidSchema,
  shopNumber: z.string().min(1, 'Shop number is required').max(50),
  shopName: z.string().max(120).optional(),
  code: z.string().min(1, 'Code is required').max(50),
})

export async function createConcessionAction(
  projectId: string,
  parentNodeId: string,
  shopNumber: string,
  shopName: string = '',
  code: string = '',
): Promise<CreateNodeResult> {
  const parsed = createConcessionSchema.safeParse({ projectId, parentNodeId, shopNumber, shopName, code })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const parentGuard = await guardNodeBelongsToProject(guard.supabase, parentNodeId, projectId)
  if (parentGuard) return { error: 'Parent (anchor) not found in this project' }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const body: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: guard.orgId,
    kind: 'tenant_db',
    parent_node_id: parentNodeId,
    shop_number: shopNumber.trim(),
    shop_name: shopName.trim() || null,
    code: code.trim(),
    status: 'active',
    created_by: (guard.user as { id?: string }).id ?? null,
  }

  const result = await structurePost(env.supabaseUrl, env.serviceKey, 'nodes', body)
  if (!result.ok) {
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to create concession' }
  }

  const nodeId = (result.data as Array<{ id: string }>)[0]?.id ?? ''
  if (nodeId) {
    const detailsRes = await structurePost(env.supabaseUrl, env.serviceKey, 'tenant_details', { node_id: nodeId }, 'minimal')
    if (!detailsRes.ok) {
      revalidatePath(TENANT_SCHEDULE_PATH(projectId))
      return { error: `Concession created but tenant-details init failed: ${detailsRes.error}` }
    }
  }

  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { id: nodeId }
}
```

- [ ] **Step 2: Write the tests.** Create `apps/web/src/actions/tenant-board.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

import {
  createSubBoardAction,
  createConcessionAction,
} from './tenant-board.actions'

const UUID = '11111111-1111-1111-1111-111111111111'
const PARENT = '22222222-2222-2222-2222-222222222222'

/** Supabase mock: auth.getUser → a user; projectService.getById reads
 *  projects → {organisation_id}; the structure nodes lookup → a parent row. */
function mockClient(opts: { user?: boolean; project?: boolean; parentExists?: boolean } = {}) {
  const { user = true, project = true, parentExists = true } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: user ? { id: 'u-1' } : null } }) },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: parentExists ? { id: PARENT } : null }) }),
            maybeSingle: () => Promise.resolve({ data: project ? { id: UUID, organisation_id: 'org-1' } : null }),
            single: () => Promise.resolve({ data: project ? { id: UUID, organisation_id: 'org-1' } : null, error: null }),
          }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  createClientMock.mockReset()
  revalidatePathMock.mockReset()
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('createSubBoardAction — validation', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    const res = await createSubBoardAction('not-a-uuid', PARENT, 'SB-1')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects an empty code', async () => {
    const res = await createSubBoardAction(UUID, PARENT, '')
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('createSubBoardAction — happy path', () => {
  it('inserts a sub_board node + its order and returns the id', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      // 1) node insert → representation [{id}]
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'node-9' }]) })
      // 2) node_orders insert → minimal
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createSubBoardAction(UUID, PARENT, 'SB-1', 'Butchery DB')
    expect(res).toEqual({ id: 'node-9' })
    // node POST body carries kind + parent_node_id
    const nodeBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(nodeBody.kind).toBe('sub_board')
    expect(nodeBody.parent_node_id).toBe(PARENT)
    // a node_orders POST followed
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/node_orders')
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('surfaces a friendly message on a duplicate code', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('duplicate key value') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createSubBoardAction(UUID, PARENT, 'SB-1')
    expect(res).toEqual({ error: expect.stringContaining('already in use') })
  })
})

describe('createConcessionAction — happy path', () => {
  it('inserts a tenant_db node + a tenant_details row', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'con-1' }]) }) // node
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })                // tenant_details
    vi.stubGlobal('fetch', fetchMock)

    const res = await createConcessionAction(UUID, PARENT, 'SHOP-12', 'Coffee Kiosk', 'CON-1')
    expect(res).toEqual({ id: 'con-1' })
    const nodeBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(nodeBody.kind).toBe('tenant_db')
    expect(nodeBody.parent_node_id).toBe(PARENT)
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/tenant_details')
  })

  it('rejects a missing shop number', async () => {
    const res = await createConcessionAction(UUID, PARENT, '', 'x', 'CON-1')
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests — expect PASS**

Run: `pnpm --filter web exec vitest run tenant-board`
Expected: PASS — all create-action tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/tenant-board.actions.ts apps/web/src/actions/tenant-board.actions.test.ts
git commit -m "feat(web): createSubBoardAction + createConcessionAction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `tenant_units` CRUD actions

**Files:**
- Modify: `apps/web/src/actions/tenant-board.actions.ts`
- Modify: `apps/web/src/actions/tenant-board.actions.test.ts`

- [ ] **Step 1: Append the unit actions** to `apps/web/src/actions/tenant-board.actions.ts`:

```ts
// ── tenant_units CRUD ──

export type UnitResult = { error: string } | { ok: true }

const addUnitSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  shopNumber: z.string().max(50).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
})

export async function addTenantUnitAction(
  projectId: string,
  nodeId: string,
  shopNumber: string | null = null,
  areaM2: number | null = null,
): Promise<UnitResult> {
  const parsed = addUnitSchema.safeParse({ projectId, nodeId, shopNumber, areaM2 })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const nodeGuard = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeGuard) return { error: nodeGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structurePost(
    env.supabaseUrl,
    env.serviceKey,
    'tenant_units',
    { node_id: nodeId, shop_number: shopNumber?.trim() || null, area_m2: areaM2 },
    'minimal',
  )
  if (!res.ok) return { error: res.error ?? 'Failed to add unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}

const updateUnitSchema = z.object({
  projectId: uuidSchema,
  unitId: uuidSchema,
  shopNumber: z.string().max(50).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
})

export async function updateTenantUnitAction(
  projectId: string,
  unitId: string,
  shopNumber: string | null = null,
  areaM2: number | null = null,
): Promise<UnitResult> {
  const parsed = updateUnitSchema.safeParse({ projectId, unitId, shopNumber, areaM2 })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const unitGuard = await guardUnitBelongsToProject(guard.supabase, unitId, projectId)
  if (unitGuard) return { error: unitGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structurePatch(env.supabaseUrl, env.serviceKey, 'tenant_units', `id=eq.${unitId}`, {
    shop_number: shopNumber?.trim() || null,
    area_m2: areaM2,
  })
  if (!res.ok) return { error: res.error ?? 'Failed to update unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}

export async function deleteTenantUnitAction(projectId: string, unitId: string): Promise<UnitResult> {
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(unitId).success) {
    return { error: 'Invalid input' }
  }
  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const unitGuard = await guardUnitBelongsToProject(guard.supabase, unitId, projectId)
  if (unitGuard) return { error: unitGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structureDelete(env.supabaseUrl, env.serviceKey, 'tenant_units', `id=eq.${unitId}`)
  if (!res.ok) return { error: res.error ?? 'Failed to delete unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}
```

- [ ] **Step 2: Append unit tests** to `apps/web/src/actions/tenant-board.actions.test.ts` (update the import line and add a describe block).

Change the import:

```ts
import {
  createSubBoardAction,
  createConcessionAction,
} from './tenant-board.actions'
```

to:

```ts
import {
  createSubBoardAction,
  createConcessionAction,
  addTenantUnitAction,
} from './tenant-board.actions'
```

Append:

```ts
describe('addTenantUnitAction', () => {
  it('rejects a non-positive area before any I/O', async () => {
    const res = await addTenantUnitAction(UUID, PARENT, 'U-1', -5)
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('inserts a tenant_units row and returns ok', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await addTenantUnitAction(UUID, PARENT, 'UNIT-13', 250)
    expect(res).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/tenant_units')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.node_id).toBe(PARENT)
    expect(body.area_m2).toBe(250)
  })
})
```

- [ ] **Step 3: Run the tests — expect PASS**

Run: `pnpm --filter web exec vitest run tenant-board`
Expected: PASS — create + unit tests all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/tenant-board.actions.ts apps/web/src/actions/tenant-board.actions.test.ts
git commit -m "feat(web): tenant_units CRUD actions (add/update/delete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1: Type-check the web app — expect PASS**

Run: `pnpm --filter web type-check`
Expected: exits 0 (a pre-existing node-engine WARN is fine; no NEW type errors).

- [ ] **Step 2: Run the full web test suite — expect PASS**

Run: `pnpm --filter web test 2>&1 | tail -8`
Expected: all suites pass, including the new `tenant-board.actions.test.ts`. No regressions vs the prior count (165+).

- [ ] **Step 3 (if Step 1 or 2 reveals issues): fix and re-run.** Do not commit on red.

---

## Self-Review

**1. Spec coverage (§4.3, §4.5 backend):**
- sub_board create + equipment-style order → Task 2 `createSubBoardAction`. ✓
- concession create (tenant_db + tenant_details) → Task 2 `createConcessionAction`. ✓
- multi-unit `tenant_units` CRUD → Task 3. ✓
- `parent_node_id` set on every created node → both create actions. ✓
- node-schema accepts the new kind/column → Task 1. ✓
- **UI** (§4.5) → the **next slice (PR-C-UI)**, documented in Context. ✓ (de-scoped, not dropped)
- generated `types.ts` regen → avoided via the cast pattern (documented); a future `pnpm db:gen-types` cleanup, not needed here. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an exact command + expected result.

**3. Type/name consistency:** Action names (`createSubBoardAction`, `createConcessionAction`, `addTenantUnitAction`, `updateTenantUnitAction`, `deleteTenantUnitAction`) match between the action file, the test imports, and this plan. Helper names (`structurePost`/`structurePatch`/`structureDelete`/`guardProjectAccess`/`guardNodeBelongsToProject`/`guardUnitBelongsToProject`/`serverEnv`) are consistent. `deriveEquipmentNodeOrder` is imported from `@esite/shared` (PR-B-confirmed kind-agnostic).

---

## Next slices

- **PR-C-UI** — tenant-schedule rendering: load `sub_board` + concession children, render them nested/indented under their anchor, with "Add sub-board" / "Add concession" modals + a units editor (calling these actions).
- **PR-D** — Materials page rollup via `buildAnchorGroups` + `computeNodeOrderRequiredBy`.
- **PR-E** — cable-schedule node pickers for `sub_board`.
