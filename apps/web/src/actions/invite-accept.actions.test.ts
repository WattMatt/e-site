import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createClientMock, createServiceClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))

const USER_ID = '00000000-0000-0000-0000-0000000000aa'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('markInviteAccepted', () => {
  it('returns ok:false and writes nothing when there is no session', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const update = vi.fn()
    createServiceClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ update }) })

    const { markInviteAccepted } = await import('./invite-accept.actions')
    const res = await markInviteAccepted()

    expect(res.ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('stamps accepted_at on the session user\'s NULL rows', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    })

    // service.from('user_organisations').update({...}).eq('user_id', id).is('accepted_at', null)
    const isNull = vi.fn().mockResolvedValue({ error: null })
    const eqUser = vi.fn().mockReturnValue({ is: isNull })
    const update = vi.fn().mockReturnValue({ eq: eqUser })
    const from = vi.fn().mockReturnValue({ update })
    createServiceClientMock.mockReturnValue({ from })

    const { markInviteAccepted } = await import('./invite-accept.actions')
    const res = await markInviteAccepted()

    expect(res.ok).toBe(true)
    expect(from).toHaveBeenCalledWith('user_organisations')
    // Only NULL rows for THIS user are touched, and accepted_at is set to a timestamp.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ accepted_at: expect.any(String) }))
    expect(eqUser).toHaveBeenCalledWith('user_id', USER_ID)
    expect(isNull).toHaveBeenCalledWith('accepted_at', null)
  })

  it('returns ok:false when the update errors (non-fatal)', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    })
    const isNull = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const eqUser = vi.fn().mockReturnValue({ is: isNull })
    const update = vi.fn().mockReturnValue({ eq: eqUser })
    createServiceClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ update }) })

    const { markInviteAccepted } = await import('./invite-accept.actions')
    const res = await markInviteAccepted()

    expect(res.ok).toBe(false)
  })
})
