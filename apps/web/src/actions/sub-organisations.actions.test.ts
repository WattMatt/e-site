import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const requireRoleMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

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

describe('createSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: 'Bobs' })
    expect(result.ok).toBe(false)
  })

  it('rejects empty names', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: 'org', role: 'owner' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce({})
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: '  ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/required/i)
  })

  it('creates a shadow org with the parent and contact details', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'owner' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    const inserted = {
      id: 'sub-1', name: "Bob's Building", is_shadow: true,
      parent_organisation_id: orgId, address: 'Cape Town', phone: null,
      registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const single = vi.fn().mockResolvedValueOnce({ data: inserted, error: null })
    const select = vi.fn().mockReturnValueOnce({ single })
    const insert = vi.fn().mockReturnValueOnce({ select })
    const from = vi.fn().mockReturnValueOnce({ insert })
    createClientMock.mockResolvedValueOnce({ from })
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: "Bob's Building", address: 'Cape Town' })
    expect(result.ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: "Bob's Building",
      parent_organisation_id: orgId,
      is_shadow: true,
      address: 'Cape Town',
    }))
    if (result.ok) expect(result.subOrganisation.id).toBe('sub-1')
  })
})

describe('updateSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates only the provided fields and skips the rest', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'admin' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })
    const subId = '00000000-0000-0000-0000-000000000001'
    const updated = {
      id: subId, name: "Bob's Building", is_shadow: true, parent_organisation_id: orgId,
      address: 'New Address', phone: '+27 21 555 0100',
      registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const single = vi.fn().mockResolvedValueOnce({ data: updated, error: null })
    const select = vi.fn().mockReturnValueOnce({ single })
    const eqParent = vi.fn().mockReturnValueOnce({ select })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const update = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ update })
    createClientMock.mockResolvedValueOnce({ from })
    const { updateSubOrganisation } = await import('./sub-organisations.actions')
    const result = await updateSubOrganisation(subId, { address: 'New Address', phone: '+27 21 555 0100' })
    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      address: 'New Address',
      phone: '+27 21 555 0100',
    }))
    // name and other fields should NOT be in the update payload
    const patch = update.mock.calls[0][0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('name')
  })
})

describe('getSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the sub-org by id when it belongs to the caller\'s org', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'admin' })
    const subId = '00000000-0000-0000-0000-000000000001'
    const found = {
      id: subId, name: "Bob's Building", is_shadow: true, parent_organisation_id: orgId,
      address: null, phone: null, registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: found, error: null })
    const eqParent = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { getSubOrganisation } = await import('./sub-organisations.actions')
    const result = await getSubOrganisation(subId)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.subOrganisation.id).toBe(subId)
  })

  it('returns ok:false when sub-org not found', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: 'org-wm', role: 'owner' })
    const subId = '00000000-0000-0000-0000-000000000099'
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const eqParent = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { getSubOrganisation } = await import('./sub-organisations.actions')
    const result = await getSubOrganisation(subId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not found/i)
  })
})
