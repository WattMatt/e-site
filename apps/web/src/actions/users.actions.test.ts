import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const getOrgContextMock = vi.fn()
const createServiceClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const rateLimitMock = vi.fn()
const sendInviteEmailMock = vi.fn()
const resolveInviteContextMock = vi.fn()

vi.mock('@/lib/auth-org', () => ({
  getOrgContext: getOrgContextMock,
  isOrgAdmin: (role: string) => role === 'owner' || role === 'admin',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
// Email plumbing is isolated (invite-email has its own tests); mock it so these
// tests exercise the gate/lookup logic, not the email path.
vi.mock('@/lib/invite-email', () => ({
  sendInviteEmail: sendInviteEmailMock,
  sendSiteAssignmentEmail: vi.fn().mockResolvedValue(undefined),
  resolveInviteContext: resolveInviteContextMock,
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

const ORG_ID    = '00000000-0000-0000-0000-000000000001'
const CALLER_ID = '00000000-0000-0000-0000-000000000010'
const TARGET_ID = '00000000-0000-0000-0000-000000000020'

const adminCtx = { userId: CALLER_ID, organisationId: ORG_ID, role: 'admin' }

// ─── Service-client chain builders ───────────────────────────────────────────

// service.from('user_organisations').select(...).eq('user_id', …).eq('organisation_id', …).maybeSingle()
function membershipQuery(row: unknown) {
  const maybeSingle = vi.fn().mockResolvedValueOnce({ data: row, error: null })
  const eqOrg = vi.fn().mockReturnValueOnce({ maybeSingle })
  const eqUser = vi.fn().mockReturnValueOnce({ eq: eqOrg })
  const select = vi.fn().mockReturnValueOnce({ eq: eqUser })
  return { select }
}

// service.schema('projects').from('project_members').select(...).eq(…).eq(…).eq(…) — last eq is awaited
function siteQuery(rows: unknown[]) {
  const eq3 = vi.fn().mockResolvedValueOnce({ data: rows, error: null })
  const eq2 = vi.fn().mockReturnValueOnce({ eq: eq3 })
  const eq1 = vi.fn().mockReturnValueOnce({ eq: eq2 })
  const select = vi.fn().mockReturnValueOnce({ eq: eq1 })
  return { select }
}

function makeService(opts: {
  membership?: unknown
  authUser?: unknown
  siteRows?: unknown[]
}) {
  return {
    from: vi.fn().mockReturnValueOnce(membershipQuery(opts.membership ?? null)),
    schema: vi.fn().mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce(siteQuery(opts.siteRows ?? [])),
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValueOnce({
          data: { user: opts.authUser ?? null },
          error: null,
        }),
      },
    },
  }
}

// ─── resendInviteAction ───────────────────────────────────────────────────────

describe('resendInviteAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    rateLimitMock.mockReturnValue(true)
    resolveInviteContextMock.mockResolvedValue({ inviterName: 'Test Admin', orgName: 'Test Org' })
    sendInviteEmailMock.mockResolvedValue({ ok: true })
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('refuses non-admin callers (same gate as createUserAction)', async () => {
    getOrgContextMock.mockResolvedValueOnce({ ...adminCtx, role: 'contractor' })
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/admin or owner/i)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('rate-limits per caller', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    rateLimitMock.mockReturnValueOnce(false)
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Too many/i)
  })

  it('rejects an invalid userId', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: 'not-a-uuid' })
    expect(result.ok).toBe(false)
  })

  it('refuses when the target is not an active member of the caller org', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    createServiceClientMock.mockReturnValueOnce(makeService({ membership: null }))
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not an active member/i)
    expect(sendInviteEmailMock).not.toHaveBeenCalled()
  })

  it('refuses when the target is a deactivated member', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    createServiceClientMock.mockReturnValueOnce(
      makeService({ membership: { role: 'contractor', is_active: false } }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not an active member/i)
  })

  it('resends even when last_sign_in_at is set — a consumed invite link is not established access', async () => {
    // GoTrue sets last_sign_in_at when a recovery link is *verified* (server-side
    // verifyOtp in /auth/callback), so a scanner-prefetched or abandoned link makes
    // a stranded invitee look "signed in". Proven in prod 2026-07-07: token consumed,
    // 0 sessions, no password. The resend must not refuse on this signal.
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    createServiceClientMock.mockReturnValueOnce(
      makeService({
        membership: { role: 'contractor', is_active: true },
        authUser: { id: TARGET_ID, email: 'mike@example.com', last_sign_in_at: '2026-07-01T00:00:00Z' },
      }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(true)
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      email: 'mike@example.com',
      role: 'contractor',
    }))
  })

  it('records had_prior_sign_in in the audit event for the incident trail', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    createServiceClientMock.mockReturnValueOnce(
      makeService({
        membership: { role: 'contractor', is_active: true },
        authUser: { id: TARGET_ID, email: 'mike@example.com', last_sign_in_at: '2026-07-01T00:00:00Z' },
      }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(true)
    const { logAuthEvent } = await import('@esite/shared')
    expect(logAuthEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'password_reset_requested',
      metadata: expect.objectContaining({ via: 'invite_resend', had_prior_sign_in: true }),
    }))
  })

  it('resends the invite with the org role and assigned site names', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    createServiceClientMock.mockReturnValueOnce(
      makeService({
        membership: { role: 'contractor', is_active: true },
        authUser: { id: TARGET_ID, email: 'mike@example.com', last_sign_in_at: null },
        siteRows: [{ projects: { name: 'KINGSWALK' } }],
      }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })

    expect(result.ok).toBe(true)
    expect(result.ok && result.warning).toBeFalsy()
    expect(sendInviteEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      email: 'mike@example.com',
      inviterName: 'Test Admin',
      orgName: 'Test Org',
      role: 'contractor',
      siteNames: ['KINGSWALK'],
    }))
    expect(revalidatePathMock).toHaveBeenCalledWith('/settings/users')
  })

  it('passes the fallback warning through when the branded invite degraded', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    sendInviteEmailMock.mockResolvedValueOnce({ ok: true, warning: 'basic set-password email was sent' })
    createServiceClientMock.mockReturnValueOnce(
      makeService({
        membership: { role: 'contractor', is_active: true },
        authUser: { id: TARGET_ID, email: 'mike@example.com', last_sign_in_at: null },
      }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warning).toMatch(/basic set-password/i)
  })

  it('returns ok:false when the email could not be sent at all', async () => {
    getOrgContextMock.mockResolvedValueOnce(adminCtx)
    sendInviteEmailMock.mockResolvedValueOnce({ ok: false, warning: 'could not be sent' })
    createServiceClientMock.mockReturnValueOnce(
      makeService({
        membership: { role: 'contractor', is_active: true },
        authUser: { id: TARGET_ID, email: 'mike@example.com', last_sign_in_at: null },
      }),
    )
    const { resendInviteAction } = await import('./users.actions')
    const result = await resendInviteAction({ userId: TARGET_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/could not be sent/i)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
