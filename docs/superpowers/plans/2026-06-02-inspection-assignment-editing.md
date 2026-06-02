# Inspection Assignment Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the inspection member dropdowns showing UUID "codes" instead of names, and add the ability to edit an inspection's Inspector + Verifier after creation.

**Architecture:** Member/verifier names are resolved server-side via the service-role client (bypassing the `public.profiles` RLS that only exposes the viewer's own row) — the same pattern `project-members.actions.ts` already uses, applied to the three inspection read-sites. A new `updateInspectionAssignmentAction` (PM+ gated, any status) plus an `AssignmentEditor` client component on the detail page provide the edit UI. No DB migration — the columns and UPDATE RLS already exist.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase JS, Vitest + @testing-library/react, TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-02-inspection-assignment-editing-design.md](../specs/2026-06-02-inspection-assignment-editing-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/src/actions/inspections.actions.ts` | Inspection server actions | Add `createServiceClient`/`requireRole` imports; fix name resolution in `listProjectMembersAction` + `listInspectionsAction`; add `updateInspectionAssignmentAction` |
| `apps/web/src/actions/inspections.actions.test.ts` | Unit tests for the above | **Create** |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.tsx` | Edit/read-only assignment UI | **Create** |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.test.tsx` | Component tests | **Create** |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx` | Detail page | Service-client name resolution; fetch members (PM+); render `AssignmentEditor`; drop header verifier chip |

**Conventions to follow:** `inspections` schema reads are cast `as AnyClient` (`type AnyClient = any`). UI uses `Card`/`CardBody` + `Button` from `@/components/ui/*` with `var(--c-*)` styling. All React hooks sit above any conditional `return` (project history: React #310 from `StickySaveBar`/`OrgSwitcher`).

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch** (do NOT work on `main`; do NOT push without an explicit request)

```bash
cd /Users/spud/Developer/ESITE.V1/esite
git checkout -b feat/inspection-assignment-editing
git status
```
Expected: `On branch feat/inspection-assignment-editing`, with the two untracked spec/plan docs.

- [ ] **Step 2: Commit the spec + plan docs**

```bash
git add docs/superpowers/specs/2026-06-02-inspection-assignment-editing-design.md docs/superpowers/plans/2026-06-02-inspection-assignment-editing.md
git commit -m "docs(inspections): assignment-editing spec + implementation plan"
```

---

## Task 1: Fix name resolution (the "database code" bug)

**Files:**
- Test: `apps/web/src/actions/inspections.actions.test.ts` (create)
- Modify: `apps/web/src/actions/inspections.actions.ts` (imports at `:27-32`; `listProjectMembersAction` at `:162-197`; `listInspectionsAction` hydration at `:306-331`)

The root cause: `listProjectMembersAction` reads `public.profiles` with the caller's RLS client, which only returns the viewer's own row, so every other member's `full_name`/`email` is null and the UI falls back to `user_id.slice(0,8)`. Fix = resolve names via `createServiceClient()` after an access gate, exactly like `project-members.actions.ts:96-138`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/actions/inspections.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const requireFeatureMock = vi.fn()
vi.mock('@/lib/features', () => ({ requireFeature: requireFeatureMock }))

const dispatchNotificationMock = vi.fn()
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const redirectMock = vi.fn(() => {
  throw new Error('NEXT_REDIRECT')
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

import {
  listProjectMembersAction,
  updateInspectionAssignmentAction,
} from './inspections.actions'

// ─── Chainable + awaitable query-builder stub ───────────────────────────────
// Returns a Promise (so `await qb(r)` === r) that also exposes the supabase
// chain methods. Chain methods return another qb(result); terminal single /
// maybeSingle resolve to the result directly.
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['select', 'eq', 'in', 'order', 'update', 'insert']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listProjectMembersAction — name resolution', () => {
  it('resolves full_name/email from the SERVICE client, not the RLS client', async () => {
    // RLS client: returns the project org + the member rows, but NO profiles
    // (simulating the RLS lock-down that caused the bug).
    createClientMock.mockResolvedValue({
      schema: (s: string) => ({
        from: (t: string) => {
          if (t === 'projects') return { select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }
          if (t === 'project_members')
            return {
              select: () =>
                qb({
                  data: [
                    { user_id: 'u-alice', organisation_id: 'org-1' },
                    { user_id: 'u-bob', organisation_id: 'org-1' },
                  ],
                  error: null,
                }),
            }
          return { select: () => qb({ data: [], error: null }) }
        },
      }),
    })

    requireRoleMock.mockResolvedValue({ ok: true })

    // SERVICE client: this is where names actually come from.
    createServiceClientMock.mockReturnValue({
      from: (t: string) => ({
        select: () =>
          t === 'profiles'
            ? qb({
                data: [
                  { id: 'u-alice', full_name: 'Alice Smith', email: 'alice@example.com' },
                  { id: 'u-bob', full_name: 'Bob Jones', email: 'bob@example.com' },
                ],
                error: null,
              })
            : qb({
                data: [
                  { user_id: 'u-alice', organisation_id: 'org-1', role: 'project_manager' },
                  { user_id: 'u-bob', organisation_id: 'org-1', role: 'inspector' },
                ],
                error: null,
              }),
      }),
    })

    const result = await listProjectMembersAction('p-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ user_id: 'u-alice', full_name: 'Alice Smith', role: 'project_manager' })
    expect(result[1]).toMatchObject({ user_id: 'u-bob', full_name: 'Bob Jones', role: 'inspector' })
    expect(createServiceClientMock).toHaveBeenCalled()
  })

  it('returns [] when the access gate fails', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
    })
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })

    const result = await listProjectMembersAction('p-1')
    expect(result).toEqual([])
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns [] when the project is not found', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: null, error: null }) }) }),
    })
    const result = await listProjectMembersAction('p-unknown')
    expect(result).toEqual([])
    expect(requireRoleMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter web test -- inspections.actions.test.ts
```
Expected: FAIL — `listProjectMembersAction` currently never calls `createServiceClient` (assertion `createServiceClientMock` toHaveBeenCalled fails), and may import-error until `updateInspectionAssignmentAction` exists.

- [ ] **Step 3: Update imports**

In `apps/web/src/actions/inspections.actions.ts`, change the import block (currently `:27-32`):

```ts
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { dispatchNotification } from '@/lib/notifications'
import { requireFeature } from '@/lib/features'
import type { SupabaseClient } from '@supabase/supabase-js'
```

- [ ] **Step 4: Rewrite `listProjectMembersAction`**

Replace the body (`:162-197`) with:

```ts
export async function listProjectMembersAction(projectId: string) {
  type Member = { user_id: string; full_name: string | null; email: string | null; role: string | null }
  const supabase = (await createClient()) as AnyClient

  // Resolve org for the access gate.
  const { data: project } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return [] as Member[]

  // Gate: any active org member may see the member list (matches the settings
  // members page). Return [] rather than throw, so the un-PM-gated /new page
  // still renders for non-PM members.
  const guard = await requireRole(supabase, project.organisation_id, [
    'owner',
    'admin',
    'project_manager',
    'contractor',
    'inspector',
    'supplier',
    'client_viewer',
  ])
  if (!guard.ok) return [] as Member[]

  const { data: rows } = await supabase
    .schema('projects')
    .from('project_members')
    .select('user_id, organisation_id')
    .eq('project_id', projectId)
    .eq('is_active', true)

  const members = (rows as Array<{ user_id: string; organisation_id: string }> | null) ?? []
  if (members.length === 0) return [] as Member[]

  const userIds = [...new Set(members.map((m) => m.user_id))]
  const orgIds = [...new Set(members.map((m) => m.organisation_id))]

  // Resolve identity (profiles) + org-role via the SERVICE client — the cookie
  // client only ever sees the viewer's own profile under RLS (00009). Safe: the
  // requireRole gate above already authorised the caller. org_role is keyed by
  // (user_id, organisation_id) so cross-org / sub-org members resolve correctly.
  const service = createServiceClient() as AnyClient
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    service.from('profiles').select('id, full_name, email').in('id', userIds),
    service
      .from('user_organisations')
      .select('user_id, organisation_id, role')
      .in('user_id', userIds)
      .in('organisation_id', orgIds),
  ])

  const profileMap = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]),
  )
  const roleMap = new Map(
    ((roles ?? []) as Array<{ user_id: string; organisation_id: string; role: string }>).map((r) => [
      `${r.user_id}|${r.organisation_id}`,
      r.role,
    ]),
  )

  return members.map((m) => {
    const p = profileMap.get(m.user_id)
    return {
      user_id: m.user_id,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
      role: roleMap.get(`${m.user_id}|${m.organisation_id}`) ?? null,
    } as Member
  })
}
```

- [ ] **Step 5: Fix `listInspectionsAction` name hydration**

In `listInspectionsAction`, the profiles read (`:314-317`) currently uses `supabase`. Add a service client and switch only the profiles fetch to it (templates stay on the RLS client — `inspections.templates` is readable by project members). The preceding RLS-gated `inspections` SELECT already proves access, so no extra gate is needed. Replace the `const [{ data: templates }, { data: profiles }] = await Promise.all([...])` block with:

```ts
  // The inspections SELECT above is RLS-gated — returned rows prove project
  // access, so resolving assignee/verifier names via the service client here is
  // safe (cookie client can't read other users' profiles; see 00009).
  const service = createServiceClient() as AnyClient
  const [{ data: templates }, { data: profiles }] = await Promise.all([
    templateIds.length
      ? supabase
          .schema('inspections')
          .from('templates')
          .select('id, name, deliverable_type')
          .in('id', templateIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; deliverable_type: string }> }),
    userIds.length
      ? service.from('profiles').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }),
  ])
```

> Note: `listInspectionsAction` uses the same service-client mechanism proven by the `listProjectMembersAction` test above; its correctness is additionally confirmed by the manual preview check (list view shows names) in the Verification section. No separate unit test (the chained `inspections` query mock adds cost without covering new logic).

- [ ] **Step 6: Run the test, verify it passes**

```bash
pnpm --filter web test -- inspections.actions.test.ts
```
Expected: `listProjectMembersAction — name resolution` 3 tests PASS. (`updateInspectionAssignmentAction` import resolves once Task 2 lands; if it errors now, comment out that import line temporarily, or do Task 2 first — they share the file.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/actions/inspections.actions.ts apps/web/src/actions/inspections.actions.test.ts
git commit -m "fix(inspections): resolve member/verifier names via service client (was showing UUID codes)"
```

---

## Task 2: `updateInspectionAssignmentAction`

**Files:**
- Test: `apps/web/src/actions/inspections.actions.test.ts` (extend)
- Modify: `apps/web/src/actions/inspections.actions.ts` (add the action; mirror `createInspectionAction` at `:214-256`)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/actions/inspections.actions.test.ts`:

```ts
// ─── update-action client stub ──────────────────────────────────────────────
function makeUpdateClient({
  role,
  previousAssignee,
  updateError = null,
}: {
  role: string
  previousAssignee: string | null
  updateError?: { message: string } | null
}) {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'caller-id' } } }) },
    // requirePmOrAbove → from('user_organisations').select('role')...single()
    from: () => ({ select: () => qb({ data: { role }, error: null }) }),
    // schema('inspections').from('inspections') → select (current) + update
    schema: () => ({
      from: () => ({
        select: () => qb({ data: { assigned_to_id: previousAssignee }, error: null }),
        update: () => qb({ error: updateError }),
      }),
    }),
  }
}

describe('updateInspectionAssignmentAction', () => {
  const base = {
    inspectionId: 'insp-1',
    projectId: 'p-1',
    organisationId: 'org-1',
    verifierId: 'u-verifier',
  }

  it('throws for a non-PM caller', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ role: 'contractor', previousAssignee: null }))
    requireFeatureMock.mockResolvedValue(undefined)

    await expect(
      updateInspectionAssignmentAction({ ...base, assignedToId: 'u-alice' }),
    ).rejects.toThrow(/Forbidden/)
  })

  it('updates and notifies the new inspector when the assignee changes', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ role: 'admin', previousAssignee: 'u-old' }))
    requireFeatureMock.mockResolvedValue(undefined)

    await updateInspectionAssignmentAction({ ...base, assignedToId: 'u-new' })

    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1)
    expect(dispatchNotificationMock.mock.calls[0][0]).toMatchObject({
      userIds: ['u-new'],
      type: 'inspection_assigned',
      entityId: 'insp-1',
    })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/inspections/insp-1')
  })

  it('does NOT notify when the assignee is unchanged', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ role: 'admin', previousAssignee: 'u-same' }))
    requireFeatureMock.mockResolvedValue(undefined)

    await updateInspectionAssignmentAction({ ...base, assignedToId: 'u-same' })
    expect(dispatchNotificationMock).not.toHaveBeenCalled()
  })

  it('does NOT notify when the caller assigns themselves', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ role: 'admin', previousAssignee: null }))
    requireFeatureMock.mockResolvedValue(undefined)

    await updateInspectionAssignmentAction({ ...base, assignedToId: 'caller-id' })
    expect(dispatchNotificationMock).not.toHaveBeenCalled()
  })

  it('throws when the DB update errors', async () => {
    createClientMock.mockResolvedValue(
      makeUpdateClient({ role: 'admin', previousAssignee: null, updateError: { message: 'boom' } }),
    )
    requireFeatureMock.mockResolvedValue(undefined)

    await expect(
      updateInspectionAssignmentAction({ ...base, assignedToId: 'u-new' }),
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm --filter web test -- inspections.actions.test.ts
```
Expected: FAIL — `updateInspectionAssignmentAction` is not exported yet.

- [ ] **Step 3: Implement the action**

In `apps/web/src/actions/inspections.actions.ts`, add after `createInspectionAction` (after `:256`):

```ts
// ─── updateInspectionAssignmentAction ───────────────────────────────────────

export interface UpdateInspectionAssignmentInput {
  inspectionId: string
  projectId: string
  organisationId: string
  assignedToId: string | null // Inspector — optional (may be unassigned)
  verifierId: string // Verifier — required (mirrors create)
}

/**
 * Reassign an existing inspection's Inspector + Verifier. Allowed at ANY status
 * (per design 2026-06-02). PM+ only — identical gate to createInspectionAction.
 * Notifies the new Inspector only when they actually changed and aren't the actor.
 */
export async function updateInspectionAssignmentAction(
  input: UpdateInspectionAssignmentInput,
): Promise<void> {
  const supabase = (await createClient()) as AnyClient
  const user = await requirePmOrAbove(supabase, input.organisationId)
  await requireFeature(input.organisationId, 'inspections', supabase)

  // Read the current assignee to decide whether a notification is warranted.
  const { data: current } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('assigned_to_id')
    .eq('id', input.inspectionId)
    .single()
  const previousAssignee = (current as { assigned_to_id: string | null } | null)?.assigned_to_id ?? null

  const { error } = await supabase
    .schema('inspections')
    .from('inspections')
    .update({ assigned_to_id: input.assignedToId, verifier_id: input.verifierId })
    .eq('id', input.inspectionId)
  if (error) throw error

  if (
    input.assignedToId &&
    input.assignedToId !== previousAssignee &&
    input.assignedToId !== user.id
  ) {
    await dispatchNotification({
      userIds: [input.assignedToId],
      title: 'Inspection assigned to you',
      body: 'You are now the inspector on this inspection.',
      route: `/projects/${input.projectId}/inspections/${input.inspectionId}`,
      type: 'inspection_assigned',
      entityType: 'inspection',
      entityId: input.inspectionId,
    })
  }

  revalidatePath(`/projects/${input.projectId}/inspections/${input.inspectionId}`)
  revalidatePath(`/projects/${input.projectId}/inspections`)
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm --filter web test -- inspections.actions.test.ts
```
Expected: all `updateInspectionAssignmentAction` tests PASS (5) plus the Task 1 tests (3) = 8 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/inspections.actions.ts apps/web/src/actions/inspections.actions.test.ts
git commit -m "feat(inspections): updateInspectionAssignmentAction (reassign inspector/verifier)"
```

---

## Task 3: `AssignmentEditor` component

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.test.tsx`

Read-only when `canEdit` is false (uses pre-resolved `assigneeName`/`verifierName`); two dropdowns + Save when true (options from `members`). **All hooks above any return.**

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AssignmentEditor from './AssignmentEditor'

const updateMock = vi.fn()
vi.mock('@/actions/inspections.actions', () => ({
  updateInspectionAssignmentAction: (...args: unknown[]) => updateMock(...args),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

const MEMBERS = [
  { user_id: 'u-alice', full_name: 'Alice Smith', email: 'alice@example.com', role: 'project_manager' },
  { user_id: 'u-bob', full_name: 'Bob Jones', email: 'bob@example.com', role: 'inspector' },
]

const baseProps = {
  inspectionId: 'insp-1',
  projectId: 'p-1',
  organisationId: 'org-1',
  assignedToId: 'u-bob',
  verifierId: 'u-alice',
  assigneeName: 'Bob Jones',
  verifierName: 'Alice Smith',
  members: MEMBERS,
}

beforeEach(() => vi.clearAllMocks())

describe('AssignmentEditor', () => {
  it('renders read-only names when canEdit is false', () => {
    render(<AssignmentEditor {...baseProps} canEdit={false} />)
    expect(screen.getByText(/Bob Jones/)).toBeDefined()
    expect(screen.getByText(/Alice Smith/)).toBeDefined()
    // No Save button in read-only mode
    expect(screen.queryByText('Save')).toBeNull()
  })

  it('renders editable dropdowns pre-selected when canEdit is true', () => {
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    const inspectorSelect = screen.getByLabelText(/INSPECTOR/i) as HTMLSelectElement
    const verifierSelect = screen.getByLabelText(/VERIFIER/i) as HTMLSelectElement
    expect(inspectorSelect.value).toBe('u-bob')
    expect(verifierSelect.value).toBe('u-alice')
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('only lists verifier-eligible roles in the verifier dropdown', () => {
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    const verifierSelect = screen.getByLabelText(/VERIFIER/i) as HTMLSelectElement
    // Alice (project_manager) is eligible; Bob (inspector) is not.
    const optionValues = Array.from(verifierSelect.options).map((o) => o.value)
    expect(optionValues).toContain('u-alice')
    expect(optionValues).not.toContain('u-bob')
  })

  it('calls updateInspectionAssignmentAction on Save', async () => {
    updateMock.mockResolvedValue(undefined)
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })
    expect(updateMock).toHaveBeenCalledWith({
      inspectionId: 'insp-1',
      projectId: 'p-1',
      organisationId: 'org-1',
      assignedToId: 'u-bob',
      verifierId: 'u-alice',
    })
  })

  it('does not crash when canEdit toggles (hook-order guard, React #310)', () => {
    const { rerender } = render(<AssignmentEditor {...baseProps} canEdit={false} />)
    expect(() => {
      rerender(<AssignmentEditor {...baseProps} canEdit={true} />)
      rerender(<AssignmentEditor {...baseProps} canEdit={false} />)
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm --filter web test -- AssignmentEditor.test.tsx
```
Expected: FAIL — module `./AssignmentEditor` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateInspectionAssignmentAction } from '@/actions/inspections.actions'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type Member = { user_id: string; full_name: string | null; email: string | null; role: string | null }

const VERIFIER_ROLES = ['owner', 'admin', 'project_manager']
const labelFor = (m: Member) => m.full_name ?? m.email ?? m.user_id.slice(0, 8)

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
}
const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
}

interface Props {
  inspectionId: string
  projectId: string
  organisationId: string
  assignedToId: string | null
  verifierId: string | null
  assigneeName: string | null
  verifierName: string | null
  members: Member[]
  canEdit: boolean
}

export default function AssignmentEditor({
  inspectionId,
  projectId,
  organisationId,
  assignedToId,
  verifierId,
  assigneeName,
  verifierName,
  members,
  canEdit,
}: Props) {
  const router = useRouter()
  const [assignedTo, setAssignedTo] = useState(assignedToId ?? '')
  const [verifier, setVerifier] = useState(verifierId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const eligibleVerifiers = members.filter((m) => m.role && VERIFIER_ROLES.includes(m.role))

  async function onSave() {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      if (!verifier) throw new Error('Assign a verifier')
      await updateInspectionAssignmentAction({
        inspectionId,
        projectId,
        organisationId,
        assignedToId: assignedTo || null,
        verifierId: verifier,
      })
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) {
    return (
      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--c-text-mid)' }}>
            <div>
              <span style={FIELD_LABEL}>INSPECTOR</span>
              {assigneeName ?? '— unassigned —'}
            </div>
            <div>
              <span style={FIELD_LABEL}>VERIFIER</span>
              {verifierName ?? '—'}
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="edit_assigned_to" style={FIELD_LABEL}>
                INSPECTOR (OPTIONAL)
              </label>
              <select
                id="edit_assigned_to"
                style={FIELD_INPUT}
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                <option value="">— unassigned (anyone can pick up) —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {labelFor(m)}
                    {m.role ? ` (${m.role})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="edit_verifier" style={FIELD_LABEL}>
                VERIFIER *
              </label>
              <select
                id="edit_verifier"
                style={FIELD_INPUT}
                value={verifier}
                onChange={(e) => setVerifier(e.target.value)}
              >
                <option value="">— select —</option>
                {eligibleVerifiers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {labelFor(m)} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</div>
          )}
          {saved && !error && (
            <div style={{ fontSize: 12, color: 'var(--c-green, #3fb950)' }}>Saved.</div>
          )}

          <div>
            <Button onClick={onSave} disabled={busy} isLoading={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm --filter web test -- AssignmentEditor.test.tsx
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.tsx" "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.test.tsx"
git commit -m "feat(inspections): AssignmentEditor component (edit inspector/verifier)"
```

---

## Task 4: Wire `AssignmentEditor` into the detail page

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx`

This is a server component (not unit-tested); verify via type-check, build, and the manual preview steps.

- [ ] **Step 1: Update imports**

Change `:4` and add component/action imports near the top of `page.tsx`:

```ts
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listProjectMembersAction } from '@/actions/inspections.actions'
import AssignmentEditor from './AssignmentEditor'
```

- [ ] **Step 2: Replace the verifier-only resolution with service-client name resolution for both people**

Replace the `verifierProfile` block (`:77-85`) with:

```ts
  // Resolve assignee + verifier display names via the service client — the
  // RLS cookie client can't read other users' profiles (00009). The inspection
  // read above is RLS-gated, so a returned row already proves project access.
  const service = createServiceClient() as AnyClient
  const assigneeIds = [inspection.assigned_to_id, inspection.verifier_id].filter(
    (v): v is string => Boolean(v),
  )
  const { data: people } = assigneeIds.length
    ? await service.from('profiles').select('id, full_name, email').in('id', assigneeIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const peopleMap = new Map(
    ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]),
  )
  const nameFrom = (uid: string | null) => {
    if (!uid) return null
    const p = peopleMap.get(uid)
    return p ? p.full_name ?? p.email ?? uid.slice(0, 8) : uid.slice(0, 8)
  }
  const assigneeName = nameFrom(inspection.assigned_to_id)
  const verifierName = nameFrom(inspection.verifier_id)
```

- [ ] **Step 3: Compute `canEdit` + fetch members after `userOrgRole` is resolved**

After the `userOrgRole` line (`:95`), add:

```ts
  const canEdit = ['owner', 'admin', 'project_manager'].includes(userOrgRole ?? '')
  const members = canEdit ? await listProjectMembersAction(projectId) : []
```

- [ ] **Step 4: Remove the header verifier chip; render the editor**

Delete the header verifier chip (`:141-145`):

```tsx
            {verifierProfile && (
              <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                verifier: {verifierProfile.full_name ?? verifierProfile.email}
              </span>
            )}
```

Then insert the editor immediately after the closing `</div>` of `.page-header` (after `:148`), before the `!templateJson` block:

```tsx
      <div style={{ marginBottom: 16 }}>
        <AssignmentEditor
          inspectionId={inspectionId}
          projectId={projectId}
          organisationId={inspection.organisation_id}
          assignedToId={inspection.assigned_to_id}
          verifierId={inspection.verifier_id}
          assigneeName={assigneeName}
          verifierName={verifierName}
          members={members}
          canEdit={canEdit}
        />
      </div>
```

- [ ] **Step 5: Type-check + full web test suite**

```bash
pnpm --filter web type-check
pnpm --filter web test
```
Expected: type-check clean; all tests green (existing suite + the new `inspections.actions` (8) and `AssignmentEditor` (5)).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx"
git commit -m "feat(inspections): show + edit assignment on the detail page"
```

---

## Verification (manual, on the Vercel preview)

After all tasks, deploy the branch to a preview and confirm:
1. **New-inspection dropdowns** show real member **names** (not UUID codes), including any cross-org/sub-org members.
2. **Inspections list** shows assignee/verifier names.
3. **Detail page:** the verifier (and inspector) name shows; a PM+ user sees the editable `AssignmentEditor`, a non-PM sees read-only names.
4. **Reassign** the Inspector on the detail page → persists after refresh; the new Inspector gets an `inspection_assigned` notification; saving without changing the Inspector sends none.

---

## Self-Review

**Spec coverage:**
- Bug fix, 3 sites — `listProjectMembersAction` (Task 1 Step 4), `listInspectionsAction` (Task 1 Step 5), detail page (Task 4 Step 2). ✓
- Edit action, PM+ gate, any status, notify-new-inspector-only — Task 2. ✓
- Editor (read-only vs editable, verifier-eligibility filter, hook-order) — Task 3. ✓
- No migration — confirmed; nothing in the plan touches `apps/edge-functions`. ✓
- Out-of-scope items (multi-inspector, notify old/verifier, certified confirm-prompt) — not present in any task. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The one explicit non-test (listInspectionsAction) is justified in-line with the manual-verification fallback (no silent gap). ✓

**Type consistency:** `Member = { user_id, full_name, email, role }` is identical in the action, the editor, and the test fixtures. `updateInspectionAssignmentAction` input `{ inspectionId, projectId, organisationId, assignedToId, verifierId }` matches the editor's call site and both test call sites. `createServiceClient` imported in both `inspections.actions.ts` and `page.tsx`. ✓
