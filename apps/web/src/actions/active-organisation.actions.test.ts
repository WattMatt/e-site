import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

// ─── IDs ──────────────────────────────────────────────────────────────────────

const USER_ID   = '00000000-0000-0000-0000-000000000010'
const ORG_A_ID  = '00000000-0000-0000-0000-000000000001'
const ORG_B_ID  = '00000000-0000-0000-0000-000000000002'

// ─── setActiveOrganisation ────────────────────────────────────────────────────

describe('setActiveOrganisation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false with validation error for non-UUID input', async () => {
    const { setActiveOrganisation } = await import('./active-organisation.actions')
    const result = await setActiveOrganisation('not-a-uuid')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Invalid organisation id/i)
  })

  it('returns ok:false "Not authenticated." when no user', async () => {
    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: null } }) },
    })
    const { setActiveOrganisation } = await import('./active-organisation.actions')
    const result = await setActiveOrganisation(ORG_A_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns ok:false when user has no active membership in the target org', async () => {
    // membership check: maybeSingle returns null
    const membershipMaybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const membershipEqActive    = vi.fn().mockReturnValueOnce({ maybeSingle: membershipMaybeSingle })
    const membershipEqOrg       = vi.fn().mockReturnValueOnce({ eq: membershipEqActive })
    const membershipEqUser      = vi.fn().mockReturnValueOnce({ eq: membershipEqOrg })
    const membershipSelect      = vi.fn().mockReturnValueOnce({ eq: membershipEqUser })
    const from = vi.fn().mockReturnValueOnce({ select: membershipSelect })

    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) },
      from,
    })

    const { setActiveOrganisation } = await import('./active-organisation.actions')
    const result = await setActiveOrganisation(ORG_A_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not a member/i)
  })

  it('happy path: updates profiles.active_organisation_id and returns ok:true', async () => {
    // First from() → user_organisations membership check → found
    const membershipMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { id: 'row-1' }, error: null })
    const membershipEqActive    = vi.fn().mockReturnValueOnce({ maybeSingle: membershipMaybeSingle })
    const membershipEqOrg       = vi.fn().mockReturnValueOnce({ eq: membershipEqActive })
    const membershipEqUser      = vi.fn().mockReturnValueOnce({ eq: membershipEqOrg })
    const membershipSelect      = vi.fn().mockReturnValueOnce({ eq: membershipEqUser })

    // Second from() → profiles.update
    const updateEqId = vi.fn().mockResolvedValueOnce({ error: null })
    const update     = vi.fn().mockReturnValueOnce({ eq: updateEqId })

    const from = vi.fn()
      .mockReturnValueOnce({ select: membershipSelect })
      .mockReturnValueOnce({ update })

    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) },
      from,
    })

    const { setActiveOrganisation } = await import('./active-organisation.actions')
    const result = await setActiveOrganisation(ORG_A_ID)

    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith({ active_organisation_id: ORG_A_ID })
    expect(updateEqId).toHaveBeenCalledWith('id', USER_ID)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })
})

// ─── listMyOrganisations ──────────────────────────────────────────────────────

describe('listMyOrganisations', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false "Not authenticated." when no user', async () => {
    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: null } }) },
    })
    const { listMyOrganisations } = await import('./active-organisation.actions')
    const result = await listMyOrganisations()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns ok:true with empty memberships when user has none', async () => {
    // profiles.select → active_organisation_id = null
    const profileMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { active_organisation_id: null }, error: null })
    const profileEqId        = vi.fn().mockReturnValueOnce({ maybeSingle: profileMaybeSingle })
    const profileSelect      = vi.fn().mockReturnValueOnce({ eq: profileEqId })

    // user_organisations.select → no rows
    const uoOrder  = vi.fn().mockResolvedValueOnce({ data: [], error: null })
    const uoEqActive = vi.fn().mockReturnValueOnce({ order: uoOrder })
    const uoEqUser   = vi.fn().mockReturnValueOnce({ eq: uoEqActive })
    const uoSelect   = vi.fn().mockReturnValueOnce({ eq: uoEqUser })

    const from = vi.fn()
      .mockReturnValueOnce({ select: profileSelect })
      .mockReturnValueOnce({ select: uoSelect })

    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) },
      from,
    })

    const { listMyOrganisations } = await import('./active-organisation.actions')
    const result = await listMyOrganisations()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.memberships).toHaveLength(0)
  })

  it('returns ok:true with multiple memberships; active org has is_active_context=true', async () => {
    const profileMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { active_organisation_id: ORG_B_ID }, error: null })
    const profileEqId        = vi.fn().mockReturnValueOnce({ maybeSingle: profileMaybeSingle })
    const profileSelect      = vi.fn().mockReturnValueOnce({ eq: profileEqId })

    const rows = [
      { organisation_id: ORG_A_ID, role: 'owner',  organisation: { name: 'Alpha Corp' } },
      { organisation_id: ORG_B_ID, role: 'admin',  organisation: { name: 'Beta Corp' } },
    ]
    const uoOrder    = vi.fn().mockResolvedValueOnce({ data: rows, error: null })
    const uoEqActive = vi.fn().mockReturnValueOnce({ order: uoOrder })
    const uoEqUser   = vi.fn().mockReturnValueOnce({ eq: uoEqActive })
    const uoSelect   = vi.fn().mockReturnValueOnce({ eq: uoEqUser })

    const from = vi.fn()
      .mockReturnValueOnce({ select: profileSelect })
      .mockReturnValueOnce({ select: uoSelect })

    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) },
      from,
    })

    const { listMyOrganisations } = await import('./active-organisation.actions')
    const result = await listMyOrganisations()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.memberships).toHaveLength(2)
      const alpha = result.memberships.find((m) => m.organisation_id === ORG_A_ID)
      const beta  = result.memberships.find((m) => m.organisation_id === ORG_B_ID)
      expect(alpha?.is_active_context).toBe(false)
      expect(beta?.is_active_context).toBe(true)
    }
  })

  it('flags the first (oldest) membership as active context when profiles.active_organisation_id is null', async () => {
    const profileMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { active_organisation_id: null }, error: null })
    const profileEqId        = vi.fn().mockReturnValueOnce({ maybeSingle: profileMaybeSingle })
    const profileSelect      = vi.fn().mockReturnValueOnce({ eq: profileEqId })

    const rows = [
      { organisation_id: ORG_A_ID, role: 'contractor', organisation: { name: 'Alpha Corp' } },
      { organisation_id: ORG_B_ID, role: 'owner',      organisation: { name: 'Beta Corp' } },
    ]
    const uoOrder    = vi.fn().mockResolvedValueOnce({ data: rows, error: null })
    const uoEqActive = vi.fn().mockReturnValueOnce({ order: uoOrder })
    const uoEqUser   = vi.fn().mockReturnValueOnce({ eq: uoEqActive })
    const uoSelect   = vi.fn().mockReturnValueOnce({ eq: uoEqUser })

    const from = vi.fn()
      .mockReturnValueOnce({ select: profileSelect })
      .mockReturnValueOnce({ select: uoSelect })

    createClientMock.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: USER_ID } } }) },
      from,
    })

    const { listMyOrganisations } = await import('./active-organisation.actions')
    const result = await listMyOrganisations()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.memberships[0]?.is_active_context).toBe(true)
      expect(result.memberships[1]?.is_active_context).toBe(false)
    }
  })
})
