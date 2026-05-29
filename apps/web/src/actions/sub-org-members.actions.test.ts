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

    // Chain: supabase.from('organisations').select(...).eq('id', subOrgId).eq('is_shadow', true).maybeSingle()
    //        → resolves sub-org row with parent_organisation_id
    // Then requireRole is called with parent org id.
    // Then: supabase.from('user_organisations').select(...).eq('organisation_id', subOrgId).eq('is_active', true)
    //        → resolves members list

    const subOrgRow = { id: SUB_ORG_ID, parent_organisation_id: PARENT_ORG_ID, is_shadow: true }

    // First from() call: resolve sub-org
    const subOrgMaybeSingle = vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null })
    const subOrgEqShadow = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ eq: subOrgEqShadow })
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
    const eqShadow = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqShadow })
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
    const eqShadow = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqShadow })
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
    const subOrgEqShadow = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ eq: subOrgEqShadow })
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
    const subOrgEqShadow = vi.fn().mockReturnValueOnce({ maybeSingle: subOrgMaybeSingle })
    const subOrgEqId = vi.fn().mockReturnValueOnce({ eq: subOrgEqShadow })
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
