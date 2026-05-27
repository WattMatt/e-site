import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
  unstable_cache: (fn: any) => fn,
}))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Bare-minimum supabase mock that chains schema().from().select()...
 *  `sequences` drives responses in order of .maybeSingle() / .single() calls.
 */
function makeClient({
  projectOrgId,
  memberProjectId,
  memberOrgId,
  insertData,
  updateData,
  listData,
  orgMembersData,
}: {
  projectOrgId?: string | null
  memberProjectId?: string | null
  memberOrgId?: string | null
  insertData?: Record<string, unknown> | null
  updateData?: Record<string, unknown> | null
  listData?: Record<string, unknown>[]
  orgMembersData?: Record<string, unknown>[]
}) {
  let callCount = 0

  const maybeSingleFn = () => {
    const idx = callCount++
    // Call 0 = project lookup → { organisation_id }
    // Call 1 = member lookup → { project_id, organisation_id } (update/remove paths)
    // Call 2 = org role lookup after insert/update
    if (idx === 0 && projectOrgId !== undefined) {
      return Promise.resolve(
        projectOrgId
          ? { data: { organisation_id: projectOrgId }, error: null }
          : { data: null, error: null },
      )
    }
    if (idx === 0 && memberProjectId !== undefined) {
      return Promise.resolve(
        memberProjectId
          ? { data: { project_id: memberProjectId, organisation_id: memberOrgId }, error: null }
          : { data: null, error: null },
      )
    }
    return Promise.resolve({ data: { role: 'admin' }, error: null })
  }

  const selectFn = (query?: string) => {
    void query
    return {
      eq: (col: string, val: unknown) => ({
        eq: (col2: string, val2: unknown) => ({
          eq: () => ({
            maybeSingle: maybeSingleFn,
            order: () => Promise.resolve({ data: listData ?? [], error: null }),
            in: () => Promise.resolve({ data: [], error: null }),
          }),
          maybeSingle: maybeSingleFn,
          in: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve(updateData ? { data: updateData, error: null } : { data: null, error: { message: 'update failed' } }),
        }),
        maybeSingle: maybeSingleFn,
        // single .eq().order() — used by project_members list query
        order: () => Promise.resolve({ data: listData ?? [], error: null }),
        in: (col2: string, vals: unknown[]) => ({
          eq: () => ({
            maybeSingle: maybeSingleFn,
          }),
          order: () => Promise.resolve({ data: orgMembersData ?? [], error: null }),
          // project_members existing user_ids query
          ...Promise.resolve({ data: [], error: null }),
        }),
      }),
      in: () => Promise.resolve({ data: [], error: null }),
      order: () => ({
        in: () => Promise.resolve({ data: orgMembersData ?? [], error: null }),
      }),
    }
  }

  const fromFn = (table: string) => ({
    select: selectFn,
    insert: () => ({
      select: () => ({
        single: () =>
          Promise.resolve(
            insertData !== undefined && insertData !== null
              ? { data: insertData, error: null }
              : insertData === null
                ? { data: null, error: { code: '23505', message: 'duplicate key' } }
                : { data: { id: 'm-1', project_id: 'p-1', organisation_id: 'org-1', user_id: 'u-1', role: 'contractor', is_active: true, created_at: '', profiles: { full_name: 'Alice', email: 'alice@example.com' } }, error: null },
          ),
      }),
    }),
    update: () => ({
      eq: () => ({
        select: () => ({
          single: () =>
            Promise.resolve(
              updateData
                ? { data: updateData, error: null }
                : { data: null, error: { message: 'not found' } },
            ),
        }),
      }),
    }),
    delete: () => ({
      eq: () => Promise.resolve({ error: null }),
    }),
  })

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'caller-id' } } }),
    },
    schema: () => ({ from: fromFn }),
    from: fromFn,
  }
}

// ─── listProjectMembers ───────────────────────────────────────────────────────

describe('listProjectMembers', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns error when project not found', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: null }))
    const { listProjectMembers } = await import('./project-members.actions')

    const result = await listProjectMembers('missing-project')

    expect(result).toEqual({ error: 'Project not found' })
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('returns error when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Not a member of this organisation' })
    const { listProjectMembers } = await import('./project-members.actions')

    const result = await listProjectMembers('p-1')

    expect(result).toEqual({ error: 'Not a member of this organisation' })
  })

  it('returns members list with expected shape', async () => {
    const listData = [
      {
        id: 'm-1',
        project_id: 'p-1',
        organisation_id: 'org-1',
        user_id: 'u-1',
        role: 'contractor',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        profiles: { full_name: 'Alice Smith', email: 'alice@example.com' },
      },
    ]
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1', listData }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { listProjectMembers } = await import('./project-members.actions')

    const result = await listProjectMembers('p-1')

    expect('members' in result).toBe(true)
    if ('members' in result) {
      expect(result.members).toHaveLength(1)
      expect(result.members[0]).toMatchObject({
        id: 'm-1',
        user_id: 'u-1',
        role: 'contractor',
        full_name: 'Alice Smith',
        email: 'alice@example.com',
      })
    }
  })
})

// ─── addProjectMember ─────────────────────────────────────────────────────────

describe('addProjectMember', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns error for invalid project role', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { addProjectMember } = await import('./project-members.actions')

    const result = await addProjectMember('p-1', 'u-1', 'owner')

    expect(result).toMatchObject({ error: expect.stringContaining('Invalid project role') })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('returns error when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })
    const { addProjectMember } = await import('./project-members.actions')

    const result = await addProjectMember('p-1', 'u-1', 'contractor')

    expect(result).toEqual({ error: 'Forbidden' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('inserts a member and returns it', async () => {
    const inserted = {
      id: 'm-new',
      project_id: 'p-1',
      organisation_id: 'org-1',
      user_id: 'u-1',
      role: 'contractor',
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      profiles: { full_name: 'Bob', email: 'bob@example.com' },
    }
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1', insertData: inserted }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { addProjectMember } = await import('./project-members.actions')

    const result = await addProjectMember('p-1', 'u-1', 'contractor')

    expect('member' in result).toBe(true)
    if ('member' in result) {
      expect(result.member).toMatchObject({
        id: 'm-new',
        role: 'contractor',
        full_name: 'Bob',
        email: 'bob@example.com',
      })
    }
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/settings/members')
  })

  it('returns duplicate-key error when user already a member', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1', insertData: null }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { addProjectMember } = await import('./project-members.actions')

    const result = await addProjectMember('p-1', 'u-1', 'contractor')

    expect(result).toEqual({ error: 'This user is already a member of this project' })
  })
})

// ─── removeProjectMember ──────────────────────────────────────────────────────

describe('removeProjectMember', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns error when member not found', async () => {
    createClientMock.mockResolvedValue(makeClient({ memberProjectId: null, memberOrgId: null }))
    const { removeProjectMember } = await import('./project-members.actions')

    const result = await removeProjectMember('missing-id')

    expect(result).toEqual({ error: 'Member not found' })
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('deletes member and returns ok', async () => {
    createClientMock.mockResolvedValue(makeClient({ memberProjectId: 'p-1', memberOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { removeProjectMember } = await import('./project-members.actions')

    const result = await removeProjectMember('m-1')

    expect(result).toEqual({ ok: true })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/settings/members')
  })
})
