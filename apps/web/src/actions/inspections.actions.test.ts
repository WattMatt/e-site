import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
// vi.hoisted so these fns are initialised before the hoisted vi.mock factories
// reference them (the SUT imports next/cache etc. at module load).
const {
  createClientMock,
  createServiceClientMock,
  requireRoleMock,
  requireFeatureMock,
  dispatchNotificationMock,
  revalidatePathMock,
  redirectMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireRoleMock: vi.fn(),
  requireFeatureMock: vi.fn(),
  dispatchNotificationMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/features', () => ({ requireFeature: requireFeatureMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

import { listProjectMembersAction, updateInspectionAssignmentAction } from './inspections.actions'

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
      schema: (_s: string) => ({
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
