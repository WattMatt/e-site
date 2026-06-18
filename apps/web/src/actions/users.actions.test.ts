import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOrgContextMock, isOrgAdminMock, createServiceClientMock, rateLimitMock, revalidatePathMock } = vi.hoisted(() => ({
  getOrgContextMock: vi.fn(),
  isOrgAdminMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  rateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock, isOrgAdmin: isOrgAdminMock }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
})

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const NEW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.e-site.live'
  getOrgContextMock.mockResolvedValue({ userId: USER_ID, organisationId: ORG_ID, role: 'admin' })
  isOrgAdminMock.mockReturnValue(true)
  rateLimitMock.mockReturnValue(true)
})

describe('createUserAction invite', () => {
  it('invites via inviteUserByEmail with role/org metadata and redirectTo=/accept-invite', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: NEW_ID } }, error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn().mockReturnValue({ insert }),
    })

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'New@Example.com', fullName: 'New Person', role: 'inspector' })

    expect(res.ok).toBe(true)
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.objectContaining({
        data: expect.objectContaining({ invited_role: 'inspector', org_id: ORG_ID, full_name: 'New Person' }),
        redirectTo: 'https://app.e-site.live/accept-invite',
      }),
    )
    // The membership insert is keyed off the invited user's id.
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: NEW_ID, organisation_id: ORG_ID, role: 'inspector' }))
  })

  it('rejects a client_viewer invite before any auth/DB write', async () => {
    const inviteUserByEmail = vi.fn()
    const insert = vi.fn()
    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn().mockReturnValue({ insert }),
    })

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'client@example.com', fullName: 'Client Person', role: 'client_viewer' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/per-site/i)
    // No auth user provisioned and no user_organisations row written.
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('returns a friendly error when the email already exists', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: null, error: { message: 'User already registered' } })
    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn(),
    })

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'dup@example.com', fullName: 'Dup Person', role: 'inspector' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/already exists/i)
  })
})
