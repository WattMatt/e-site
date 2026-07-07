import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()
const revalidatePathMock = vi.fn()
const rateLimitMock = vi.fn()
const sendInviteEmailMock = vi.fn().mockResolvedValue({ ok: true })
const sendSiteAssignmentEmailMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
// Email plumbing is isolated (invite-email has its own tests); mock it so these
// tests exercise the provisioning/membership logic, not the email path.
// sendInviteEmail is closure-captured so tests can simulate failed sends.
vi.mock('@/lib/invite-email', () => ({
  sendInviteEmail: sendInviteEmailMock,
  sendSiteAssignmentEmail: sendSiteAssignmentEmailMock,
  resolveInviteContext: vi.fn().mockResolvedValue({ inviterName: 'Test Admin', orgName: 'Test Org' }),
  getOrgName: vi.fn().mockResolvedValue('Test Org'),
}))
vi.mock('next/headers', () => ({
  headers: () => ({ get: () => null }),
}))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
})

// ─── IDs ──────────────────────────────────────────────────────────────────────

const ORG_ID      = '00000000-0000-0000-0000-000000000001'
const PROJECT_ID  = '00000000-0000-0000-0000-000000000002'
const USER_ID     = '00000000-0000-0000-0000-000000000010'
const NEW_USER_ID = '00000000-0000-0000-0000-000000000099'

/**
 * Wire up the full happy-path mock chain for one NEW email:
 *   supabase.schema('projects').from('projects')        → project row
 *   supabase.schema('projects').from('project_members') → no existing members
 *   supabase.from('user_organisations')                  → no existing org users
 *   service.auth.admin.createUser                        → NEW_USER_ID
 *   service.from('user_organisations').insert            → ok
 *   service.schema('projects').from('project_members').insert → ok
 * Returns the insert spies so tests can assert membership creation happened.
 */
function setupNewUserPath() {
  getOrgContextMock.mockResolvedValueOnce({
    userId: USER_ID,
    organisationId: ORG_ID,
    role: 'admin',
  })
  requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })
  rateLimitMock.mockReturnValueOnce(true)

  const projectMaybeSingle = vi.fn().mockResolvedValueOnce({
    data: { organisation_id: ORG_ID, name: 'Kingswalk' },
    error: null,
  })
  const projectEq = vi.fn().mockReturnValueOnce({ maybeSingle: projectMaybeSingle })
  const projectSelect = vi.fn().mockReturnValueOnce({ eq: projectEq })

  // Existing project members query resolves at the .eq() await.
  const pmEq = vi.fn().mockResolvedValueOnce({ data: [], error: null })
  const pmSelect = vi.fn().mockReturnValueOnce({ eq: pmEq })

  const schemaFrom = vi.fn((table: string) =>
    table === 'projects' ? { select: projectSelect } : { select: pmSelect },
  )
  const schemaFn = vi.fn().mockReturnValue({ from: schemaFrom })

  const uoEqActive = vi.fn().mockResolvedValueOnce({ data: [], error: null })
  const uoEqOrg = vi.fn().mockReturnValueOnce({ eq: uoEqActive })
  const uoSelect = vi.fn().mockReturnValueOnce({ eq: uoEqOrg })
  const supabaseFrom = vi.fn().mockReturnValueOnce({ select: uoSelect })

  createClientMock.mockResolvedValueOnce({ schema: schemaFn, from: supabaseFrom })

  const uoInsert = vi.fn().mockResolvedValue({ error: null })
  const pmInsert = vi.fn().mockResolvedValue({ error: null })
  const serviceSchemaFrom = vi.fn().mockReturnValue({ insert: pmInsert })

  createServiceClientMock.mockReturnValue({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: NEW_USER_ID } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({}),
      },
    },
    from: vi.fn().mockReturnValue({ insert: uoInsert }),
    schema: vi.fn().mockReturnValue({ from: serviceSchemaFrom }),
  })

  return { uoInsert, pmInsert }
}

// ─── bulkAddOrInviteProjectMembers ───────────────────────────────────────────

describe('bulkAddOrInviteProjectMembers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

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

  it('invites a new user and reports invited-and-added', async () => {
    const { uoInsert, pmInsert } = setupNewUserPath()

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toEqual({ invited: 1, added: 0, skipped: 0, failed: 0, emailFailed: 0 })
      expect(result.details[0]?.status).toBe('invited-and-added')
      expect(result.details[0]?.reason).toBeUndefined()
    }
    expect(uoInsert).toHaveBeenCalled()
    expect(pmInsert).toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/settings/members`)
  })

  it('reports invited-email-failed (not invited) when the invite email does not send', async () => {
    const { uoInsert, pmInsert } = setupNewUserPath()

    sendInviteEmailMock.mockResolvedValueOnce({
      ok: false,
      warning: 'User created, but the invite email could not be sent.',
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toEqual({ invited: 0, added: 0, skipped: 0, failed: 0, emailFailed: 1 })
      expect(result.details[0]?.status).toBe('invited-email-failed')
      expect(result.details[0]?.reason).toMatch(/could not be sent/i)
    }
    // Membership creation is untouched by a mail failure — only reporting changes.
    expect(uoInsert).toHaveBeenCalled()
    expect(pmInsert).toHaveBeenCalled()
  })

  it('keeps invited-and-added but attaches the warning when the fallback email was used', async () => {
    setupNewUserPath()

    sendInviteEmailMock.mockResolvedValueOnce({
      ok: true,
      warning: 'User created and a basic set-password email was sent (the branded invite could not be generated).',
    })

    const { bulkAddOrInviteProjectMembers } = await import('./project-members-bulk.actions')
    const result = await bulkAddOrInviteProjectMembers({
      projectId: PROJECT_ID,
      emails: ['mike@example.com'],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toEqual({ invited: 1, added: 0, skipped: 0, failed: 0, emailFailed: 0 })
      expect(result.details[0]?.status).toBe('invited-and-added')
      expect(result.details[0]?.reason).toMatch(/basic set-password email/i)
    }
  })
})
