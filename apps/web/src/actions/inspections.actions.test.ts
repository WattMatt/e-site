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

import {
  listProjectMembersAction,
  updateInspectionAssignmentAction,
  attachInspectionFileAction,
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

describe('attachInspectionFileAction', () => {
  // Client for the two calls the action makes: inspections select (project_id)
  // and photos insert. Everything goes through the RLS (cookie) client — the
  // photos_insert policy is the write gate, no service role involved.
  function makeAttachClient(opts: {
    inspection?: { project_id: string } | null
    insertResult?: { data: unknown; error: { message: string } | null }
  }) {
    const insertSpy = vi.fn((_row: Record<string, unknown>) => ({
      select: () => ({
        single: () =>
          Promise.resolve(opts.insertResult ?? { data: { id: 'ph-1' }, error: null }),
      }),
    }))
    const client = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-uploader' } } }) },
      schema: () => ({
        from: (t: string) =>
          t === 'inspections'
            ? {
                select: () => ({
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: 'inspection' in opts ? opts.inspection : { project_id: 'proj-1' },
                      }),
                  }),
                }),
              }
            : { insert: insertSpy },
      }),
    }
    return { client, insertSpy }
  }

  const input = {
    inspectionId: 'insp-1',
    sectionId: 'sec-1',
    fieldId: 'f-file-1',
    storagePath: 'proj-1/insp-1/sec-1/f-file-1/999-spec.pdf',
    filename: 'spec.pdf',
  }

  it('inserts the photos row (filename in caption) and returns the new id', async () => {
    const { client, insertSpy } = makeAttachClient({})
    createClientMock.mockResolvedValue(client)

    const res = await attachInspectionFileAction(input)

    expect(res).toEqual({ ok: true, id: 'ph-1' })
    expect(insertSpy).toHaveBeenCalledWith({
      inspection_id: 'insp-1',
      section_id: 'sec-1',
      field_id: 'f-file-1',
      storage_path: input.storagePath,
      caption: 'spec.pdf',
      uploaded_by: 'u-uploader',
    })
  })

  it('rejects a storage path outside the inspection/section/field prefix', async () => {
    const { client, insertSpy } = makeAttachClient({})
    createClientMock.mockResolvedValue(client)

    const res = await attachInspectionFileAction({
      ...input,
      storagePath: 'proj-1/OTHER-INSPECTION/sec-1/f-file-1/999-spec.pdf',
    })

    expect(res).toEqual({ ok: false, error: 'Storage path does not match the inspection field' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when the inspection is not readable', async () => {
    const { client, insertSpy } = makeAttachClient({ inspection: null })
    createClientMock.mockResolvedValue(client)

    const res = await attachInspectionFileAction(input)
    expect(res).toEqual({ ok: false, error: 'Inspection not found' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('surfaces the RLS/DB error instead of throwing (server actions mask thrown errors)', async () => {
    const { client } = makeAttachClient({
      insertResult: { data: null, error: { message: 'new row violates row-level security policy' } },
    })
    createClientMock.mockResolvedValue(client)

    const res = await attachInspectionFileAction(input)
    expect(res).toEqual({ ok: false, error: 'new row violates row-level security policy' })
  })
})
