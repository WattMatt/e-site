import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()
const revalidatePathMock = vi.fn()
const rateLimitMock = vi.fn()

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
vi.mock('@/lib/invite-email', () => ({
  sendInviteEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendSiteAssignmentEmail: vi.fn().mockResolvedValue(undefined),
  resolveInviteContext: vi.fn().mockResolvedValue({ inviterName: 'Test Admin', orgName: 'Test Org' }),
  getOrgName: vi.fn().mockResolvedValue('Test Org'),
}))
vi.mock('next/headers', () => ({
  headers: () => ({ get: () => null }),
}))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

// ─── IDs ──────────────────────────────────────────────────────────────────────

const PARENT_ORG_ID = '00000000-0000-0000-0000-000000000001'
const SUB_ORG_ID    = '00000000-0000-0000-0000-000000000002'
const USER_ID       = '00000000-0000-0000-0000-000000000010'
const MEMBER_ROW_ID = '00000000-0000-0000-0000-000000000020'

// ─── Task 1: listSubOrgMembers ────────────────────────────────────────────────

describe('listSubOrgMembers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { listSubOrgMembers } = await import('./sub-org-members.actions')
    const result = await listSubOrgMembers(SUB_ORG_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns active roster joined with profile data', async () => {
    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })

    const memberRow = {
      id: MEMBER_ROW_ID,
      user_id: USER_ID,
      organisation_id: SUB_ORG_ID,
      role: 'contractor',
      is_active: true,
      created_at: '2026-05-29T00:00:00Z',
      profiles: { full_name: 'Mike Smith', email: 'mike@example.com' },
    }

    // Chain: supabase.from('organisations').select(...).eq('id', subOrgId).maybeSingle()
    //        → resolves sub-org row with parent_organisation_id
    // Then requireRole is called with parent org id.
    // Then: supabase.from('user_organisations').select(...).eq('organisation_id', subOrgId).eq('is_active', true)
    //        → resolves members list

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }

    // First from() call: resolve sub-org (single .eq() now — is_shadow filter removed)
    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgSelect = vi.fn().mockReturnValueOnce({ eq: subOrgEqId })
    const fromOrgs = vi.fn().mockReturnValueOnce({ select: subOrgSelect })

    // Second from() call: resolve members
    const membersEqActive = vi.fn().mockResolvedValueOnce({ data: [memberRow], error: null })
    const membersEqOrg = vi.fn().mockReturnValueOnce({ eq: membersEqActive })
    const membersSelect = vi.fn().mockReturnValueOnce({ eq: membersEqOrg })
    const fromMembers = vi.fn().mockReturnValueOnce({ select: membersSelect })

    // The supabase client serves two from() calls in sequence
    const from = vi.fn()
      .mockReturnValueOnce({ select: subOrgSelect })
      .mockReturnValueOnce({ select: membersSelect })

    createClientMock.mockResolvedValueOnce({ from })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const { listSubOrgMembers } = await import('./sub-org-members.actions')
    const result = await listSubOrgMembers(SUB_ORG_ID)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.members).toHaveLength(1)
      expect(result.members[0]?.full_name).toBe('Mike Smith')
      expect(result.members[0]?.email).toBe('mike@example.com')
      expect(result.members[0]?.role).toBe('contractor')
    }
  })
})

// ─── Task 2: addSubOrgMember ──────────────────────────────────────────────────

describe('addSubOrgMember', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { addSubOrgMember } = await import('./sub-org-members.actions')
    const result = await addSubOrgMember(SUB_ORG_ID, {
      email: 'mike@example.com',
      fullName: 'Mike Smith',
      role: 'contractor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns ok:false for invalid email input', async () => {
    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })
    rateLimitMock.mockReturnValueOnce(true)

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const eqId = vi.fn().mockReturnValueOnce({ maybeSingle })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })

    const { addSubOrgMember } = await import('./sub-org-members.actions')
    const result = await addSubOrgMember(SUB_ORG_ID, {
      email: 'not-an-email',
      fullName: 'Mike Smith',
      role: 'contractor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/email/i)
  })

  it('provisions a new user and inserts membership into sub-org', async () => {
    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })
    rateLimitMock.mockReturnValueOnce(true)

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const eqId = vi.fn().mockReturnValueOnce({ maybeSingle })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const fromOrgs = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from: fromOrgs })

    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const newUserId = '00000000-0000-0000-0000-000000000099'
    const insertedMember = {
      id: MEMBER_ROW_ID,
      user_id: newUserId,
      organisation_id: SUB_ORG_ID,
      role: 'contractor',
      is_active: true,
      created_at: '2026-05-29T00:00:00Z',
      profiles: { full_name: 'Mike Smith', email: 'mike@example.com' },
    }

    // Service client: createUser → insert → resetPassword → logAuthEvent → fetch member
    const insertSingle = vi.fn().mockResolvedValueOnce({ data: insertedMember, error: null })
    const insertSelect = vi.fn().mockReturnValueOnce({ single: insertSingle })
    const fromUO = vi.fn().mockReturnValueOnce({ insert: vi.fn().mockReturnValueOnce({ select: insertSelect }) })
    // For fetchMember call after insert
    const memberMaybeSingle = vi.fn().mockResolvedValueOnce({ data: insertedMember, error: null })
    const memberEqId = vi.fn().mockReturnValueOnce({ maybeSingle: memberMaybeSingle })
    const memberSelect = vi.fn().mockReturnValueOnce({ eq: memberEqId })
    const fromUO2 = vi.fn().mockReturnValueOnce({ select: memberSelect })

    const resetPasswordForEmail = vi.fn().mockResolvedValueOnce({ error: null })
    const logAuthEventSpy = vi.fn().mockResolvedValueOnce(undefined)

    createServiceClientMock.mockReturnValueOnce({
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValueOnce({
            data: { user: { id: newUserId } },
            error: null,
          }),
        },
        resetPasswordForEmail,
      },
      from: vi.fn()
        .mockReturnValueOnce({ insert: vi.fn().mockReturnValueOnce({ select: insertSelect }) })
        .mockReturnValueOnce({ select: memberSelect }),
    })

    // Mock logAuthEvent at the shared level — it's imported via @esite/shared
    vi.doMock('@esite/shared', async () => {
      const actual = await vi.importActual<any>('@esite/shared')
      return { ...actual, logAuthEvent: logAuthEventSpy }
    })

    const { addSubOrgMember } = await import('./sub-org-members.actions')
    const result = await addSubOrgMember(SUB_ORG_ID, {
      email: 'mike@example.com',
      fullName: 'Mike Smith',
      role: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.member.organisation_id).toBe(SUB_ORG_ID)
      expect(result.member.role).toBe('contractor')
    }
    expect(revalidatePathMock).toHaveBeenCalledWith(`/settings/sub-organizations/${SUB_ORG_ID}`)
  })

  // ─── Email collision tests ────────────────────────────────────────────────

  it('email collision: looks up existing user and inserts membership with their user_id', async () => {
    vi.resetModules()
    vi.clearAllMocks()

    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })
    rateLimitMock.mockReturnValueOnce(true)

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }
    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqId        = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgSelect      = vi.fn().mockReturnValueOnce({ eq: subOrgEqId })
    createClientMock.mockResolvedValueOnce({ from: vi.fn().mockReturnValueOnce({ select: subOrgSelect }) })

    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const existingUserId = '00000000-0000-0000-0000-000000000088'
    const insertedMember = {
      id:              MEMBER_ROW_ID,
      user_id:         existingUserId,
      organisation_id: SUB_ORG_ID,
      role:            'contractor',
      is_active:       true,
      created_at:      '2026-05-29T00:00:00Z',
      profiles:        { full_name: 'Existing User', email: 'existing@example.com' },
    }

    // Service client mock:
    //   createUser → collision error
    //   service.from('profiles').select('id').eq('email', email).maybeSingle() → existing id
    //   service.from('user_organisations').insert(...).select(...).single()     → member row
    const profilesMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { id: existingUserId }, error: null })
    const profilesEqEmail     = vi.fn().mockReturnValueOnce({ maybeSingle: profilesMaybeSingle })
    const profilesSelect      = vi.fn().mockReturnValueOnce({ eq: profilesEqEmail })

    const insertSingle = vi.fn().mockResolvedValueOnce({ data: insertedMember, error: null })
    const insertSelect = vi.fn().mockReturnValueOnce({ single: insertSingle })
    const insertFn     = vi.fn().mockReturnValueOnce({ select: insertSelect })

    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValueOnce({
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValueOnce({
            data: null,
            error: { message: 'User already registered' },
          }),
          deleteUser: vi.fn().mockResolvedValue({}),
        },
        resetPasswordForEmail,
      },
      from: vi.fn()
        .mockReturnValueOnce({ select: profilesSelect })   // profiles look-up
        .mockReturnValueOnce({ insert: insertFn }),         // user_organisations insert
    })

    vi.doMock('@esite/shared', async () => {
      const actual = await vi.importActual<any>('@esite/shared')
      return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
    })

    const { addSubOrgMember } = await import('./sub-org-members.actions')
    const result = await addSubOrgMember(SUB_ORG_ID, {
      email: 'existing@example.com',
      fullName: 'Existing User',
      role: 'contractor',
    })

    expect(result.ok).toBe(true)
    // The insert must use the EXISTING user's id (not a newly created one)
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      user_id:         existingUserId,
      organisation_id: SUB_ORG_ID,
    }))
    // Profiles look-up was called to resolve the existing user
    expect(profilesMaybeSingle).toHaveBeenCalled()
    if (result.ok) {
      expect(result.member.user_id).toBe(existingUserId)
    }
  })

  it('no-collision: standard happy path still works (no regression)', async () => {
    vi.resetModules()
    vi.clearAllMocks()

    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })
    rateLimitMock.mockReturnValueOnce(true)

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }
    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqId        = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgSelect      = vi.fn().mockReturnValueOnce({ eq: subOrgEqId })
    createClientMock.mockResolvedValueOnce({ from: vi.fn().mockReturnValueOnce({ select: subOrgSelect }) })

    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const newUserId  = '00000000-0000-0000-0000-000000000099'
    const insertedMember = {
      id:              MEMBER_ROW_ID,
      user_id:         newUserId,
      organisation_id: SUB_ORG_ID,
      role:            'contractor',
      is_active:       true,
      created_at:      '2026-05-29T00:00:00Z',
      profiles:        { full_name: 'New User', email: 'new@example.com' },
    }

    const insertSingle = vi.fn().mockResolvedValueOnce({ data: insertedMember, error: null })
    const insertSelect = vi.fn().mockReturnValueOnce({ single: insertSingle })
    const insertFn     = vi.fn().mockReturnValueOnce({ select: insertSelect })

    createServiceClientMock.mockReturnValueOnce({
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValueOnce({
            data: { user: { id: newUserId } },
            error: null,
          }),
        },
        resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn().mockReturnValueOnce({ insert: insertFn }),
    })

    vi.doMock('@esite/shared', async () => {
      const actual = await vi.importActual<any>('@esite/shared')
      return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
    })

    const { addSubOrgMember } = await import('./sub-org-members.actions')
    const result = await addSubOrgMember(SUB_ORG_ID, {
      email: 'new@example.com',
      fullName: 'New User',
      role: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.member.user_id).toBe(newUserId)
      expect(result.member.organisation_id).toBe(SUB_ORG_ID)
    }
  })
})

// ─── Task 3: removeSubOrgMember ───────────────────────────────────────────────

describe('removeSubOrgMember', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { removeSubOrgMember } = await import('./sub-org-members.actions')
    const result = await removeSubOrgMember(MEMBER_ROW_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('sets is_active=false on the member row (soft deactivate)', async () => {
    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })

    const memberRow = {
      id: MEMBER_ROW_ID,
      user_id: USER_ID,
      organisation_id: SUB_ORG_ID,
      role: 'contractor',
      is_active: true,
    }
    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }

    // Service client: fetch member row → fetch sub-org to confirm parent → update
    const memberMaybeSingle = vi.fn().mockResolvedValueOnce({ data: memberRow, error: null })
    const memberEqId = vi.fn().mockReturnValueOnce({ maybeSingle: memberMaybeSingle })
    const memberSelect = vi.fn().mockReturnValueOnce({ eq: memberEqId })

    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgSelect = vi.fn().mockReturnValueOnce({ eq: subOrgEqId })

    const updateEqId = vi.fn().mockResolvedValueOnce({ error: null })
    const update = vi.fn().mockReturnValueOnce({ eq: updateEqId })

    const from = vi.fn()
      .mockReturnValueOnce({ select: memberSelect })    // fetch member
      .mockReturnValueOnce({ select: subOrgSelect })   // fetch sub-org to verify parent
      .mockReturnValueOnce({ update })                  // update is_active

    createClientMock.mockResolvedValueOnce({ from })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const { removeSubOrgMember } = await import('./sub-org-members.actions')
    const result = await removeSubOrgMember(MEMBER_ROW_ID)

    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith({ is_active: false })
    expect(updateEqId).toHaveBeenCalledWith('id', MEMBER_ROW_ID)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/settings/sub-organizations/${SUB_ORG_ID}`)
  })
})

// ─── Task 4: bulkInviteSubOrgMembers ─────────────────────────────────────────

describe('bulkInviteSubOrgMembers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { bulkInviteSubOrgMembers } = await import('./sub-org-members.actions')
    const result = await bulkInviteSubOrgMembers({
      subOrgId: SUB_ORG_ID,
      emails: ['mike@example.com'],
      role: 'contractor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('invites 2 new emails and returns invited count', async () => {
    getOrgContextMock.mockResolvedValueOnce({
      userId: USER_ID,
      organisationId: PARENT_ORG_ID,
      role: 'admin',
    })
    rateLimitMock.mockReturnValueOnce(true)

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }

    // supabase client: resolve sub-org then fetch existing members
    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgSelect = vi.fn().mockReturnValueOnce({ eq: subOrgEqId })

    // existing members query (empty — no one in sub-org yet)
    const existingEqActive = vi.fn().mockResolvedValueOnce({ data: [], error: null })
    const existingEqOrg = vi.fn().mockReturnValueOnce({ eq: existingEqActive })
    const existingSelect = vi.fn().mockReturnValueOnce({ eq: existingEqOrg })

    const supabaseFrom = vi.fn()
      .mockReturnValueOnce({ select: subOrgSelect })
      .mockReturnValueOnce({ select: existingSelect })

    createClientMock.mockResolvedValueOnce({ from: supabaseFrom })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const userId1 = '00000000-0000-0000-0000-000000000091'
    const userId2 = '00000000-0000-0000-0000-000000000092'

    // insert() is awaited directly in the action, so it must return a Promise.
    const insert1 = vi.fn().mockResolvedValueOnce({ error: null })
    const insert2 = vi.fn().mockResolvedValueOnce({ error: null })

    const serviceFrom = vi.fn()
      .mockReturnValueOnce({ insert: insert1 })
      .mockReturnValueOnce({ insert: insert2 })

    const mockServiceClient = {
      auth: {
        admin: {
          createUser: vi.fn()
            .mockResolvedValueOnce({ data: { user: { id: userId1 } }, error: null })
            .mockResolvedValueOnce({ data: { user: { id: userId2 } }, error: null }),
        },
        resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      },
      from: serviceFrom,
    }

    createServiceClientMock.mockReturnValue(mockServiceClient)

    const { bulkInviteSubOrgMembers } = await import('./sub-org-members.actions')
    const result = await bulkInviteSubOrgMembers({
      subOrgId: SUB_ORG_ID,
      emails: ['mike@example.com', 'jane@example.com'],
      role: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.invited).toBe(2)
      expect(result.summary.skipped).toBe(0)
      expect(result.summary.failed).toBe(0)
      expect(result.details).toHaveLength(2)
      expect(result.details[0]?.status).toBe('invited')
      expect(result.details[1]?.status).toBe('invited')
    }
    expect(revalidatePathMock).toHaveBeenCalledWith(`/settings/sub-organizations/${SUB_ORG_ID}`)
  })
})
