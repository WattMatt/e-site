import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const requireRoleMock = vi.fn()

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

describe('listSubOrganisations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { listSubOrganisations } = await import('./sub-organisations.actions')
    const result = await listSubOrganisations()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns the org\'s shadow children with shadow filter', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'owner' })
    const order2 = vi.fn().mockResolvedValueOnce({ data: [{ id: 's1', name: 'Bobs', is_shadow: true }], error: null })
    const order1 = vi.fn().mockReturnValueOnce({ order: order2 })
    const eq = vi.fn().mockReturnValueOnce({ order: order1 })
    const select = vi.fn().mockReturnValueOnce({ eq })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { listSubOrganisations } = await import('./sub-organisations.actions')
    const result = await listSubOrganisations()
    expect(result.ok).toBe(true)
    expect(from).toHaveBeenCalledWith('organisations')
    expect(eq).toHaveBeenCalledWith('parent_organisation_id', orgId)
    if (result.ok) expect(result.subOrganisations).toHaveLength(1)
  })
})
