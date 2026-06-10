import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  return { ...actual }
})

// ─── IDs ──────────────────────────────────────────────────────────────────────

const ORG_ID      = '00000000-0000-0000-0000-000000000001'
const USER_ID     = '00000000-0000-0000-0000-000000000010'
const OTHER_USER  = '00000000-0000-0000-0000-000000000011'
const SEAT_ID     = '00000000-0000-0000-0000-000000000020'
const OTHER_ORG   = '00000000-0000-0000-0000-000000000099'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn(),
    schema: vi.fn(),
    ...overrides,
  }
}

function authedContext(role = 'admin') {
  getOrgContextMock.mockResolvedValueOnce({ userId: USER_ID, organisationId: ORG_ID, role })
  createClientMock.mockResolvedValueOnce(mockClient())
  requireRoleMock.mockResolvedValueOnce({ ok: true, role })
}

// ─── listSeatsAction ──────────────────────────────────────────────────────────

describe('listSeatsAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { listSeatsAction } = await import('./seats.actions')
    const result = await listSeatsAction()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns ok:false when caller is not owner/admin', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: USER_ID, organisationId: ORG_ID, role: 'contractor' })
    createClientMock.mockResolvedValueOnce(mockClient())
    requireRoleMock.mockResolvedValueOnce({ ok: false, error: 'Your role (contractor) is not allowed' })
    const { listSeatsAction } = await import('./seats.actions')
    const result = await listSeatsAction()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not allowed/i)
  })

  it('returns members with seat state on success', async () => {
    authedContext()

    const memberRow = {
      id: 'mem-1',
      user_id: USER_ID,
      role: 'admin',
      profiles: { full_name: 'Alice', email: 'alice@example.com' },
    }
    const seatRow = {
      id: SEAT_ID,
      organisation_id: ORG_ID,
      feature_key: 'generator_cost_recovery',
      assigned_user_id: USER_ID,
      purchased_at: '2026-01-01T00:00:00Z',
      assigned_at: '2026-01-01T00:00:00Z',
    }

    // Service client chains: members query and seats query in parallel.
    // Each call to .schema('billing') returns a builder ending in the seats result.
    const seatsSelect   = vi.fn().mockReturnValueOnce({ eq: vi.fn().mockReturnValueOnce({ eq: vi.fn().mockResolvedValueOnce({ data: [seatRow], error: null }) }) })
    const schemaBilling = vi.fn().mockReturnValueOnce({ from: vi.fn().mockReturnValueOnce({ select: seatsSelect }) })

    const membersOrder  = vi.fn().mockResolvedValueOnce({ data: [memberRow], error: null })
    const membersEqActive = vi.fn().mockReturnValueOnce({ order: membersOrder })
    const membersEqOrg  = vi.fn().mockReturnValueOnce({ eq: membersEqActive })
    const membersSelect = vi.fn().mockReturnValueOnce({ eq: membersEqOrg })
    const serviceFrom   = vi.fn().mockReturnValueOnce({ select: membersSelect })

    createServiceClientMock.mockReturnValue({ from: serviceFrom, schema: schemaBilling })

    const { listSeatsAction } = await import('./seats.actions')
    const result = await listSeatsAction()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totalSeats).toBe(1)
      expect(result.assignedSeats).toBe(1)
      expect(result.members).toHaveLength(1)
      expect(result.members[0]?.seat?.id).toBe(SEAT_ID)
    }
  })
})

// ─── reassignSeatAction ───────────────────────────────────────────────────────

describe('reassignSeatAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, OTHER_USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns ok:false when caller is not owner/admin', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: USER_ID, organisationId: ORG_ID, role: 'project_manager' })
    createClientMock.mockResolvedValueOnce(mockClient())
    requireRoleMock.mockResolvedValueOnce({ ok: false, error: 'Your role (project_manager) is not allowed' })
    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, OTHER_USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not allowed/i)
  })

  it('returns ok:false when target is not an active org member', async () => {
    authedContext()

    const seatMaybeSingle = vi.fn().mockResolvedValueOnce({
      data: { id: SEAT_ID, organisation_id: ORG_ID, assigned_user_id: null },
      error: null,
    })
    const seatEqFeature = vi.fn().mockReturnValueOnce({ maybeSingle: seatMaybeSingle })
    const seatEqId      = vi.fn().mockReturnValueOnce({ eq: seatEqFeature })
    const seatSelect    = vi.fn().mockReturnValueOnce({ eq: seatEqId })
    const billingFrom   = vi.fn().mockReturnValueOnce({ select: seatSelect })
    const schemaBilling = vi.fn().mockReturnValueOnce({ from: billingFrom })

    // Target member lookup → not found.
    const memberMaybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const memberEqActive    = vi.fn().mockReturnValueOnce({ maybeSingle: memberMaybeSingle })
    const memberEqOrg       = vi.fn().mockReturnValueOnce({ eq: memberEqActive })
    const memberEqUser      = vi.fn().mockReturnValueOnce({ eq: memberEqOrg })
    const memberSelect      = vi.fn().mockReturnValueOnce({ eq: memberEqUser })
    const serviceFrom       = vi.fn().mockReturnValueOnce({ select: memberSelect })

    createServiceClientMock.mockReturnValue({ from: serviceFrom, schema: schemaBilling })

    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, OTHER_USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not an active member/i)
  })

  it('returns ok:false when target already holds a seat', async () => {
    authedContext()

    const seatMaybeSingle = vi.fn().mockResolvedValueOnce({
      data: { id: SEAT_ID, organisation_id: ORG_ID, assigned_user_id: null },
      error: null,
    })
    const seatEqFeature = vi.fn().mockReturnValueOnce({ maybeSingle: seatMaybeSingle })
    const seatEqId      = vi.fn().mockReturnValueOnce({ eq: seatEqFeature })
    const seatSelect    = vi.fn().mockReturnValueOnce({ eq: seatEqId })
    const billingFrom1  = vi.fn().mockReturnValueOnce({ select: seatSelect })

    // Existing seat conflict check → found.
    const conflictMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { id: 'other-seat' }, error: null })
    const conflictEqUser   = vi.fn().mockReturnValueOnce({ maybeSingle: conflictMaybeSingle })
    const conflictEqFeature = vi.fn().mockReturnValueOnce({ eq: conflictEqUser })
    const conflictEqOrg    = vi.fn().mockReturnValueOnce({ eq: conflictEqFeature })
    const conflictSelect   = vi.fn().mockReturnValueOnce({ eq: conflictEqOrg })
    const billingFrom2     = vi.fn().mockReturnValueOnce({ select: conflictSelect })

    const schemaBilling = vi.fn()
      .mockReturnValueOnce({ from: billingFrom1 })
      .mockReturnValueOnce({ from: billingFrom2 })

    // Target member lookup → found.
    const memberMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { user_id: OTHER_USER }, error: null })
    const memberEqActive    = vi.fn().mockReturnValueOnce({ maybeSingle: memberMaybeSingle })
    const memberEqOrg       = vi.fn().mockReturnValueOnce({ eq: memberEqActive })
    const memberEqUser      = vi.fn().mockReturnValueOnce({ eq: memberEqOrg })
    const memberSelect      = vi.fn().mockReturnValueOnce({ eq: memberEqUser })
    const serviceFrom       = vi.fn().mockReturnValueOnce({ select: memberSelect })

    createServiceClientMock.mockReturnValue({ from: serviceFrom, schema: schemaBilling })

    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, OTHER_USER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/already holds/i)
  })

  it('reassigns seat to a new user successfully', async () => {
    authedContext()

    const seatMaybeSingle = vi.fn().mockResolvedValueOnce({
      data: { id: SEAT_ID, organisation_id: ORG_ID, assigned_user_id: null },
      error: null,
    })
    const seatEqFeature = vi.fn().mockReturnValueOnce({ maybeSingle: seatMaybeSingle })
    const seatEqId      = vi.fn().mockReturnValueOnce({ eq: seatEqFeature })
    const seatSelect    = vi.fn().mockReturnValueOnce({ eq: seatEqId })
    const billingFrom1  = vi.fn().mockReturnValueOnce({ select: seatSelect })

    // Conflict check → no existing seat.
    const conflictMaybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const conflictEqUser   = vi.fn().mockReturnValueOnce({ maybeSingle: conflictMaybeSingle })
    const conflictEqFeature = vi.fn().mockReturnValueOnce({ eq: conflictEqUser })
    const conflictEqOrg    = vi.fn().mockReturnValueOnce({ eq: conflictEqFeature })
    const conflictSelect   = vi.fn().mockReturnValueOnce({ eq: conflictEqOrg })
    const billingFrom2     = vi.fn().mockReturnValueOnce({ select: conflictSelect })

    // Update call.
    const updateEqId  = vi.fn().mockResolvedValueOnce({ error: null })
    const update      = vi.fn().mockReturnValueOnce({ eq: updateEqId })
    const billingFrom3 = vi.fn().mockReturnValueOnce({ update })

    const schemaBilling = vi.fn()
      .mockReturnValueOnce({ from: billingFrom1 })
      .mockReturnValueOnce({ from: billingFrom2 })
      .mockReturnValueOnce({ from: billingFrom3 })

    // Target member lookup → found.
    const memberMaybeSingle = vi.fn().mockResolvedValueOnce({ data: { user_id: OTHER_USER }, error: null })
    const memberEqActive    = vi.fn().mockReturnValueOnce({ maybeSingle: memberMaybeSingle })
    const memberEqOrg       = vi.fn().mockReturnValueOnce({ eq: memberEqActive })
    const memberEqUser      = vi.fn().mockReturnValueOnce({ eq: memberEqOrg })
    const memberSelect      = vi.fn().mockReturnValueOnce({ eq: memberEqUser })
    const serviceFrom       = vi.fn().mockReturnValueOnce({ select: memberSelect })

    createServiceClientMock.mockReturnValue({ from: serviceFrom, schema: schemaBilling })

    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, OTHER_USER)
    expect(result.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/settings/billing/seats')
  })

  it('frees a seat (newUserId = null) successfully', async () => {
    authedContext()

    const seatMaybeSingle = vi.fn().mockResolvedValueOnce({
      data: { id: SEAT_ID, organisation_id: ORG_ID, assigned_user_id: USER_ID },
      error: null,
    })
    const seatEqFeature = vi.fn().mockReturnValueOnce({ maybeSingle: seatMaybeSingle })
    const seatEqId      = vi.fn().mockReturnValueOnce({ eq: seatEqFeature })
    const seatSelect    = vi.fn().mockReturnValueOnce({ eq: seatEqId })
    const billingFrom1  = vi.fn().mockReturnValueOnce({ select: seatSelect })

    // Update call.
    const updateEqId  = vi.fn().mockResolvedValueOnce({ error: null })
    const update      = vi.fn().mockReturnValueOnce({ eq: updateEqId })
    const billingFrom2 = vi.fn().mockReturnValueOnce({ update })

    const schemaBilling = vi.fn()
      .mockReturnValueOnce({ from: billingFrom1 })
      .mockReturnValueOnce({ from: billingFrom2 })

    createServiceClientMock.mockReturnValue({ from: vi.fn(), schema: schemaBilling })

    const { reassignSeatAction } = await import('./seats.actions')
    const result = await reassignSeatAction(SEAT_ID, null)
    expect(result.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/settings/billing/seats')
  })
})
