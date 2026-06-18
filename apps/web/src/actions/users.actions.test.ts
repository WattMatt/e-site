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
const OTHER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.e-site.live'
  getOrgContextMock.mockResolvedValue({ userId: USER_ID, organisationId: ORG_ID, role: 'admin' })
  isOrgAdminMock.mockReturnValue(true)
  rateLimitMock.mockReturnValue(true)
})

// ─── Tiny query-builder mock ───────────────────────────────────────────────────
// Each .from(table) call is routed to a handler that returns a thenable chain.
// Handlers are queued FIFO per table so a single test can describe a sequence of
// queries against the same table.

type Result = { data?: any; error?: any; count?: number }

/** A chainable stub whose terminal methods resolve to `result`. */
function chain(result: Result) {
  const p: any = {
    select: vi.fn(() => p),
    insert: vi.fn(() => p),
    update: vi.fn(() => p),
    delete: vi.fn(() => p),
    eq: vi.fn(() => p),
    order: vi.fn(() => p),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return p
}

interface ServiceMockSpec {
  invite?: Result
  generateLink?: Result
  deleteUser?: Result
  /** Per-table FIFO queue of results, each becomes a fresh chain() on .from(). */
  tables?: Record<string, Result[]>
}

function buildService(spec: ServiceMockSpec) {
  const inviteUserByEmail = vi.fn().mockResolvedValue(spec.invite ?? { data: { user: { id: NEW_ID } }, error: null })
  const generateLink = vi.fn().mockResolvedValue(spec.generateLink ?? { data: {}, error: null })
  const deleteUser = vi.fn().mockResolvedValue(spec.deleteUser ?? {})

  const queues: Record<string, Result[]> = {}
  for (const [t, arr] of Object.entries(spec.tables ?? {})) queues[t] = [...arr]
  const chains: Record<string, any[]> = {}

  const from = vi.fn((table: string) => {
    const next = queues[table]?.shift() ?? { data: null, error: null }
    const c = chain(next)
    ;(chains[table] ??= []).push(c)
    return c
  })

  return {
    client: { auth: { admin: { inviteUserByEmail, generateLink, deleteUser } }, from },
    inviteUserByEmail,
    generateLink,
    deleteUser,
    from,
    chains,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// createUserAction
// ════════════════════════════════════════════════════════════════════════════

describe('createUserAction invite', () => {
  it('invites via inviteUserByEmail with role/org metadata and redirectTo=/accept-invite', async () => {
    const svc = buildService({
      invite: { data: { user: { id: NEW_ID } }, error: null },
      tables: { user_organisations: [{ error: null }] },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'New@Example.com', fullName: 'New Person', role: 'inspector' })

    expect(res.ok).toBe(true)
    expect(svc.inviteUserByEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.objectContaining({
        data: expect.objectContaining({ invited_role: 'inspector', org_id: ORG_ID, full_name: 'New Person' }),
        redirectTo: 'https://app.e-site.live/accept-invite',
      }),
    )
    const uoChain = svc.chains.user_organisations[0]
    expect(uoChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: NEW_ID, organisation_id: ORG_ID, role: 'inspector', is_active: true }),
    )
  })

  it('rejects when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'a@b.com', fullName: 'A B', role: 'inspector' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/authenticated/i)
  })

  it('rejects a non-admin caller', async () => {
    isOrgAdminMock.mockReturnValueOnce(false)
    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'a@b.com', fullName: 'A B', role: 'inspector' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/admin or owner/i)
  })

  it('rejects assigning owner at creation', async () => {
    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'a@b.com', fullName: 'A B', role: 'owner' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/owner role cannot be assigned/i)
  })

  it('rejects a client_viewer (per-site role) invite before any auth/DB write', async () => {
    const svc = buildService({})
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'client@example.com', fullName: 'Client Person', role: 'client_viewer' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/per-site/i)
    expect(svc.inviteUserByEmail).not.toHaveBeenCalled()
    expect(svc.from).not.toHaveBeenCalled()
  })

  it('rolls back the orphaned auth user when the membership insert fails', async () => {
    const svc = buildService({
      invite: { data: { user: { id: NEW_ID } }, error: null },
      tables: { user_organisations: [{ error: { message: 'boom' } }] },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'new@example.com', fullName: 'New Person', role: 'inspector' })

    expect(res.ok).toBe(false)
    expect(svc.deleteUser).toHaveBeenCalledWith(NEW_ID)
  })

  // ─── delete → re-create round-trip (CRITICAL) ─────────────────────────────

  it('collision + dormant membership in THIS org → reactivates the row, re-sends invite, no new auth user', async () => {
    const svc = buildService({
      invite: { data: null, error: { message: 'User already registered' } },
      tables: {
        profiles: [{ data: { id: OTHER_ID }, error: null }],
        // membership lookup → inactive row exists; then the reactivate update
        user_organisations: [
          { data: { id: 'mem-1', is_active: false }, error: null },
          { error: null },
        ],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'back@example.com', fullName: 'Returning Person', role: 'contractor' })

    expect(res.ok).toBe(true)
    // No new auth user should be created — the existing one is reused.
    expect(svc.deleteUser).not.toHaveBeenCalled()
    // The dormant membership row is reactivated with the chosen role.
    const updateChain = svc.chains.user_organisations[1]
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'contractor', is_active: true }),
    )
    // The branded invite is re-sent via generateLink (NOT inviteUserByEmail again).
    expect(svc.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invite', email: 'back@example.com' }),
    )
  })

  it('collision + NO membership in this org (multi-org user) → inserts a fresh row, re-sends invite, no "already registered" error', async () => {
    const svc = buildService({
      invite: { data: null, error: { message: 'A user with this email address has already been registered' } },
      tables: {
        profiles: [{ data: { id: OTHER_ID }, error: null }],
        user_organisations: [
          { data: null, error: null }, // membership lookup → none
          { error: null },             // fresh insert
        ],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'multi@example.com', fullName: 'Multi Org', role: 'inspector' })

    expect(res.ok).toBe(true)
    // Fresh membership row inserted for the existing user.
    const insertChain = svc.chains.user_organisations[1]
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OTHER_ID, organisation_id: ORG_ID, role: 'inspector', is_active: true }),
    )
    expect(svc.generateLink).toHaveBeenCalled()
    expect(svc.deleteUser).not.toHaveBeenCalled()
  })

  it('collision + already an ACTIVE member of this org → friendly error, no writes', async () => {
    const svc = buildService({
      invite: { data: null, error: { message: 'User already registered' } },
      tables: {
        profiles: [{ data: { id: OTHER_ID }, error: null }],
        user_organisations: [{ data: { id: 'mem-1', is_active: true }, error: null }],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'active@example.com', fullName: 'Active Person', role: 'inspector' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/already an active member/i)
    expect(svc.generateLink).not.toHaveBeenCalled()
  })

  it('collision but the email cannot be resolved in profiles → friendly error', async () => {
    const svc = buildService({
      invite: { data: null, error: { message: 'User already registered' } },
      tables: { profiles: [{ data: null, error: null }] },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'ghost@example.com', fullName: 'Ghost', role: 'inspector' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/could not be found/i)
  })

  it('non-collision invite error is surfaced verbatim (no lookup)', async () => {
    const svc = buildService({ invite: { data: null, error: { message: 'smtp exploded' } } })
    createServiceClientMock.mockReturnValue(svc.client)

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'x@example.com', fullName: 'X Y', role: 'inspector' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/smtp exploded/i)
    expect(svc.generateLink).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// resendInviteAction
// ════════════════════════════════════════════════════════════════════════════

describe('resendInviteAction', () => {
  it('re-sends a branded invite for a pending member via generateLink({type:invite})', async () => {
    const svc = buildService({
      tables: {
        user_organisations: [{
          data: { id: 'mem-1', role: 'inspector', accepted_at: null, profile: { email: 'pending@example.com' } },
          error: null,
        }],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { resendInviteAction } = await import('./users.actions')
    const res = await resendInviteAction({ userId: OTHER_ID })

    expect(res.ok).toBe(true)
    expect(svc.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invite',
        email: 'pending@example.com',
        options: expect.objectContaining({
          data: expect.objectContaining({ invited_role: 'inspector', org_id: ORG_ID }),
          redirectTo: 'https://app.e-site.live/accept-invite',
        }),
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith('/settings/users')
  })

  it('refuses to resend to a member who has already accepted', async () => {
    const svc = buildService({
      tables: {
        user_organisations: [{
          data: { id: 'mem-1', role: 'inspector', accepted_at: '2026-06-01T00:00:00Z', profile: { email: 'done@example.com' } },
          error: null,
        }],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { resendInviteAction } = await import('./users.actions')
    const res = await resendInviteAction({ userId: OTHER_ID })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/already accepted/i)
    expect(svc.generateLink).not.toHaveBeenCalled()
  })

  it('rejects when the target is not a member of this org', async () => {
    const svc = buildService({ tables: { user_organisations: [{ data: null, error: null }] } })
    createServiceClientMock.mockReturnValue(svc.client)

    const { resendInviteAction } = await import('./users.actions')
    const res = await resendInviteAction({ userId: OTHER_ID })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not a member/i)
  })

  it('rejects a non-admin caller', async () => {
    isOrgAdminMock.mockReturnValueOnce(false)
    const { resendInviteAction } = await import('./users.actions')
    const res = await resendInviteAction({ userId: OTHER_ID })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/admin or owner/i)
  })

  it('is rate-limited', async () => {
    rateLimitMock.mockReturnValueOnce(false)
    const { resendInviteAction } = await import('./users.actions')
    const res = await resendInviteAction({ userId: OTHER_ID })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/too many/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// updateUserAction — self-protection + last-owner + per-site
// ════════════════════════════════════════════════════════════════════════════

describe('updateUserAction self-protection & guards', () => {
  it('blocks a user from changing their OWN role or status', async () => {
    const svc = buildService({})
    createServiceClientMock.mockReturnValue(svc.client)

    const { updateUserAction } = await import('./users.actions')
    const res = await updateUserAction({ userId: USER_ID, role: 'contractor' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/your own role or status/i)
    // Guard fires before any DB read.
    expect(svc.from).not.toHaveBeenCalled()
  })

  it('blocks a user from deactivating themselves', async () => {
    const { updateUserAction } = await import('./users.actions')
    const res = await updateUserAction({ userId: USER_ID, isActive: false })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/your own role or status/i)
  })

  it('rejects promoting a member to a per-site (client_viewer) role', async () => {
    const svc = buildService({})
    createServiceClientMock.mockReturnValue(svc.client)

    const { updateUserAction } = await import('./users.actions')
    const res = await updateUserAction({ userId: OTHER_ID, role: 'client_viewer' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/per-site/i)
    // Guard fires before any DB read.
    expect(svc.from).not.toHaveBeenCalled()
  })

  it('protects the last active owner from demotion', async () => {
    getOrgContextMock.mockResolvedValue({ userId: USER_ID, organisationId: ORG_ID, role: 'owner' })
    const svc = buildService({
      tables: {
        user_organisations: [
          { data: { id: 'owner-row', role: 'owner', is_active: true }, error: null }, // target lookup
          { count: 1, error: null },                                                   // owner count
        ],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { updateUserAction } = await import('./users.actions')
    const res = await updateUserAction({ userId: OTHER_ID, role: 'admin' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/at least one active owner/i)
  })

  it('a non-owner cannot touch an owner row', async () => {
    const svc = buildService({
      tables: { user_organisations: [{ data: { id: 'owner-row', role: 'owner', is_active: true }, error: null }] },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { updateUserAction } = await import('./users.actions')
    const res = await updateUserAction({ userId: OTHER_ID, role: 'admin' })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/only an owner/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// removeUserAction — self-delete, last-owner, free-the-email
// ════════════════════════════════════════════════════════════════════════════

describe('removeUserAction', () => {
  it('blocks a user from removing themselves', async () => {
    const svc = buildService({})
    createServiceClientMock.mockReturnValue(svc.client)

    const { removeUserAction } = await import('./users.actions')
    const res = await removeUserAction({ userId: USER_ID })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cannot remove yourself/i)
    expect(svc.from).not.toHaveBeenCalled()
  })

  it('sole-org member: deletes the membership AND the auth user (frees the email)', async () => {
    const svc = buildService({
      tables: {
        user_organisations: [
          { data: { id: 'mem-3', role: 'inspector' }, error: null }, // target lookup
          { error: null },                                            // delete membership
          { count: 0, error: null },                                  // remaining memberships → 0
        ],
      },
      deleteUser: { error: null },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { removeUserAction } = await import('./users.actions')
    const res = await removeUserAction({ userId: OTHER_ID })

    expect(res.ok).toBe(true)
    // The auth user is deleted → the email is freed for a brand-new invite.
    expect(svc.deleteUser).toHaveBeenCalledWith(OTHER_ID)
  })

  it('multi-org member: deletes the membership but KEEPS the auth user', async () => {
    const svc = buildService({
      tables: {
        user_organisations: [
          { data: { id: 'mem-4', role: 'inspector' }, error: null }, // target lookup
          { error: null },                                            // delete membership
          { count: 2, error: null },                                  // remaining memberships → still in another org
        ],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { removeUserAction } = await import('./users.actions')
    const res = await removeUserAction({ userId: OTHER_ID })

    expect(res.ok).toBe(true)
    // The auth user must NOT be deleted — they still belong to another org.
    expect(svc.deleteUser).not.toHaveBeenCalled()
  })

  it('protects the last active owner from removal', async () => {
    getOrgContextMock.mockResolvedValue({ userId: USER_ID, organisationId: ORG_ID, role: 'owner' })
    const svc = buildService({
      tables: {
        user_organisations: [
          { data: { id: 'owner-row', role: 'owner' }, error: null }, // target lookup
          { count: 1, error: null },                                  // owner count
        ],
      },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { removeUserAction } = await import('./users.actions')
    const res = await removeUserAction({ userId: OTHER_ID })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/at least one active owner/i)
  })

  it('a non-owner cannot remove an owner', async () => {
    const svc = buildService({
      tables: { user_organisations: [{ data: { id: 'owner-row', role: 'owner' }, error: null }] },
    })
    createServiceClientMock.mockReturnValue(svc.client)

    const { removeUserAction } = await import('./users.actions')
    const res = await removeUserAction({ userId: OTHER_ID })

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/only an owner can remove an owner/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Full delete → re-invite round trip (sole-org case)
// ════════════════════════════════════════════════════════════════════════════

describe('delete-then-reinvite round trip', () => {
  it('sole-org delete frees the email so a fresh invite creates a brand-new auth user', async () => {
    // 1. Remove the sole-org member → auth user deleted.
    const removeSvc = buildService({
      tables: {
        user_organisations: [
          { data: { id: 'mem-5', role: 'inspector' }, error: null },
          { error: null },
          { count: 0, error: null },
        ],
      },
      deleteUser: { error: null },
    })
    createServiceClientMock.mockReturnValueOnce(removeSvc.client)

    const { removeUserAction, createUserAction } = await import('./users.actions')
    const removeRes = await removeUserAction({ userId: OTHER_ID })
    expect(removeRes.ok).toBe(true)
    expect(removeSvc.deleteUser).toHaveBeenCalledWith(OTHER_ID)

    // 2. Re-invite the same email → because the auth user is gone, inviteUserByEmail
    //    succeeds and provisions a BRAND-NEW user (no collision path).
    const inviteSvc = buildService({
      invite: { data: { user: { id: 'brand-new-id' } }, error: null },
      tables: { user_organisations: [{ error: null }] },
    })
    createServiceClientMock.mockReturnValueOnce(inviteSvc.client)

    const createRes = await createUserAction({ email: 'gone@example.com', fullName: 'Returning', role: 'inspector' })
    expect(createRes.ok).toBe(true)
    expect(inviteSvc.inviteUserByEmail).toHaveBeenCalled()
    expect(inviteSvc.generateLink).not.toHaveBeenCalled() // no collision → no re-send branch
    const uoChain = inviteSvc.chains.user_organisations[0]
    expect(uoChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'brand-new-id', organisation_id: ORG_ID }),
    )
  })
})
