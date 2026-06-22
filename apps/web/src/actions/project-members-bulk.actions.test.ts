import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const {
  getOrgContextMock,
  createClientMock,
  createServiceClientMock,
  requireRoleMock,
  rateLimitMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  getOrgContextMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireRoleMock: vi.fn(),
  rateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
})

// ─── IDs ──────────────────────────────────────────────────────────────────────

const ORG_ID     = '00000000-0000-0000-0000-000000000001'
const PROJECT_ID = '00000000-0000-0000-0000-000000000002'
const CALLER_ID  = '00000000-0000-0000-0000-000000000010'

// ─── Cookie-client mock ─────────────────────────────────────────────────────
//
// Serves, in order:
//   1. supabase.schema('projects').from('projects').select(...).eq('id',...).maybeSingle()
//        → project row { organisation_id, name }
//   2. supabase.schema('projects').from('project_members').select('user_id').eq('project_id',...)
//        → existing project members (awaited directly)
//   3. supabase.from('user_organisations').select(...).eq('organisation_id',...).eq('is_active',true)
//        → org users (awaited directly)
function makeCookieClient({
  project,
  existingProjectMembers = [],
  orgUsers = [],
}: {
  project: { organisation_id: string; name: string | null } | null
  existingProjectMembers?: Array<{ user_id: string }>
  orgUsers?: Array<{ user_id: string; role: string; profiles: { email: string | null } | null }>
}) {
  // schema('projects') path — projects lookup + project_members existing read.
  const projectsSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: project, error: null }),
    }),
  })
  const projectMembersSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: existingProjectMembers, error: null }),
  })
  const schemaFrom = vi.fn((table: string) =>
    table === 'projects'
      ? { select: projectsSelect }
      : { select: projectMembersSelect },
  )

  // top-level from('user_organisations') — org users read.
  const orgUsersSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: orgUsers, error: null }),
    }),
  })

  return {
    schema: vi.fn().mockReturnValue({ from: schemaFrom }),
    from: vi.fn().mockReturnValue({ select: orgUsersSelect }),
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.e-site.live'
  getOrgContextMock.mockResolvedValue({ userId: CALLER_ID, organisationId: ORG_ID, role: 'admin' })
  requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
  rateLimitMock.mockReturnValue(true)
})

describe('bulkAddOrInviteProjectMembers', () => {
  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com'],
      projectRole: 'contractor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns error when project not found', async () => {
    createClientMock.mockResolvedValue(makeCookieClient({ project: null }))
    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com'],
      projectRole: 'contractor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Project not found/i)
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('invites 2 new emails via inviteUserByEmail with role/site metadata and /accept-invite', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({ project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' } }),
    )

    const userId1 = '00000000-0000-0000-0000-000000000091'
    const userId2 = '00000000-0000-0000-0000-000000000092'

    const inviteUserByEmail = vi.fn()
      .mockResolvedValueOnce({ data: { user: { id: userId1 } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: userId2 } }, error: null })
    const deleteUser = vi.fn()

    // user_organisations insert (awaited directly).
    const uoInsert = vi.fn().mockResolvedValue({ error: null })
    // schema('projects').from('project_members').insert (awaited directly).
    const pmInsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser } },
      from: vi.fn().mockReturnValue({ insert: uoInsert }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ insert: pmInsert }) }),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com', 'jane@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.invited).toBe(2)
      expect(result.summary.added).toBe(0)
      expect(result.summary.skipped).toBe(0)
      expect(result.summary.failed).toBe(0)
      expect(result.details.every((d) => d.status === 'invited-and-added')).toBe(true)
    }
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'mike@example.com',
      expect.objectContaining({
        data: expect.objectContaining({
          invited_role: 'contractor',
          org_id: ORG_ID,
          site_name: 'Kingswalk Mall',
        }),
        redirectTo: 'https://app.e-site.live/accept-invite',
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/settings/members`)
  })

  it('downgrades new users org role to contractor when project role is project_manager', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({ project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' } }),
    )

    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: 'u-new' } }, error: null })
    const uoInsert = vi.fn().mockResolvedValue({ error: null })
    const pmInsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn().mockReturnValue({ insert: uoInsert }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ insert: pmInsert }) }),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['pm@example.com'],
      projectRole: 'project_manager',
    })

    expect(result.ok).toBe(true)
    // New user's ORG role is downgraded to contractor; the invite metadata carries that role.
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'pm@example.com',
      expect.objectContaining({ data: expect.objectContaining({ invited_role: 'contractor' }) }),
    )
    expect(uoInsert).toHaveBeenCalledWith(expect.objectContaining({ role: 'contractor' }))
    // But the PROJECT membership keeps project_manager.
    expect(pmInsert).toHaveBeenCalledWith(expect.objectContaining({ role: 'project_manager' }))
  })

  it('adds an existing org user to the project without inviting', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({
        project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
        orgUsers: [{ user_id: 'u-existing', role: 'contractor', profiles: { email: 'existing@example.com' } }],
      }),
    )

    const inviteUserByEmail = vi.fn()
    const pmInsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn(),
      schema: vi.fn(),
    })

    // The existing-user path inserts via the COOKIE client (supabase.schema('projects')),
    // not the service client. Override the cookie client's project_members insert.
    const cookie = makeCookieClient({
      project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
      orgUsers: [{ user_id: 'u-existing', role: 'contractor', profiles: { email: 'existing@example.com' } }],
    })
    const cookiePmInsert = vi.fn().mockResolvedValue({ error: null })
    cookie.schema = vi.fn().mockImplementation(() => ({
      from: (table: string) =>
        table === 'projects'
          ? {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
                    error: null,
                  }),
                }),
              }),
            }
          : {
              // project_members: existing-members read (.select().eq()) AND insert.
              select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
              insert: cookiePmInsert,
            },
    }))
    createClientMock.mockResolvedValue(cookie)

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['existing@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.added).toBe(1)
      expect(result.summary.invited).toBe(0)
      expect(result.details[0]?.status).toBe('added')
    }
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(cookiePmInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-existing', role: 'contractor' }))
  })

  it('skips an existing org user already on the project', async () => {
    const cookie = makeCookieClient({
      project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
      existingProjectMembers: [{ user_id: 'u-existing' }],
      orgUsers: [{ user_id: 'u-existing', role: 'contractor', profiles: { email: 'existing@example.com' } }],
    })
    createClientMock.mockResolvedValue(cookie)

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail: vi.fn(), deleteUser: vi.fn() } },
      from: vi.fn(),
      schema: vi.fn(),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['existing@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.skipped).toBe(1)
      expect(result.details[0]?.status).toBe('skipped-already-on-project')
    }
  })

  it('mixed batch: one invite fails on the auth call, one succeeds — loop completes', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({ project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' } }),
    )

    const inviteUserByEmail = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'smtp blew up' } }) // first email fails
      .mockResolvedValueOnce({ data: { user: { id: 'u-ok' } }, error: null })     // second succeeds
    const deleteUser = vi.fn()
    const uoInsert = vi.fn().mockResolvedValue({ error: null })
    const pmInsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser } },
      from: vi.fn().mockReturnValue({ insert: uoInsert }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ insert: pmInsert }) }),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['bad@example.com', 'good@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.failed).toBe(1)
      expect(result.summary.invited).toBe(1)
      expect(result.details).toHaveLength(2)
      expect(result.details[0]?.status).toBe('failed')
      expect(result.details[1]?.status).toBe('invited-and-added')
    }
    // First failure must NOT trigger a rollback delete (no user was created).
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('rejects a NEW-user client_viewer invite per-row (no auth user, no org row)', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({ project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' } }),
    )

    const inviteUserByEmail = vi.fn()
    const uoInsert = vi.fn()
    const pmInsert = vi.fn()

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn().mockReturnValue({ insert: uoInsert }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ insert: pmInsert }) }),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['client@example.com'],
      projectRole: 'client_viewer',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.failed).toBe(1)
      expect(result.summary.invited).toBe(0)
      expect(result.details[0]?.status).toBe('failed')
      expect(result.details[0]?.reason).toMatch(/per-site/i)
    }
    // No invite (auth user) and no user_organisations org-membership write.
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(uoInsert).not.toHaveBeenCalled()
  })

  it('still adds an EXISTING org user to a project as client_viewer (per-site is allowed)', async () => {
    const cookie = makeCookieClient({
      project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
      orgUsers: [{ user_id: 'u-existing', role: 'contractor', profiles: { email: 'existing@example.com' } }],
    })
    const cookiePmInsert = vi.fn().mockResolvedValue({ error: null })
    cookie.schema = vi.fn().mockImplementation(() => ({
      from: (table: string) =>
        table === 'projects'
          ? {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { organisation_id: ORG_ID, name: 'Kingswalk Mall' },
                    error: null,
                  }),
                }),
              }),
            }
          : {
              select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
              insert: cookiePmInsert,
            },
    }))
    createClientMock.mockResolvedValue(cookie)

    const inviteUserByEmail = vi.fn()
    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn(),
      schema: vi.fn(),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['existing@example.com'],
      projectRole: 'client_viewer',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.added).toBe(1)
      expect(result.details[0]?.status).toBe('added')
    }
    // No invite — existing user added per-site only.
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(cookiePmInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-existing', role: 'client_viewer' }))
  })

  it('rolls back the orphaned auth user when the membership insert fails', async () => {
    createClientMock.mockResolvedValue(
      makeCookieClient({ project: { organisation_id: ORG_ID, name: 'Kingswalk Mall' } }),
    )

    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: 'u-orphan' } }, error: null })
    const deleteUser = vi.fn().mockResolvedValue({})
    const uoInsert = vi.fn().mockResolvedValue({ error: { message: 'uo insert failed' } })

    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser } },
      from: vi.fn().mockReturnValue({ insert: uoInsert }),
      schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ insert: vi.fn() }) }),
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['orphan@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.summary.failed).toBe(1)
    // createdHere was true → orphaned auth user must be deleted.
    expect(deleteUser).toHaveBeenCalledWith('u-orphan')
  })
})
