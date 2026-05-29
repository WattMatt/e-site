import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Cross-org requireEffectiveRole regression tests (PR-D Task 1).
 *
 * requireEffectiveRole takes an explicit supabase client, so we build stubs
 * inline rather than mocking createClient. The module-level mocks below only
 * silence the transitive dependencies (next/navigation, next/server) that
 * require-role.ts imports at module level.
 */

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/server', () => ({ NextResponse: { json: vi.fn() } }))
// Silence createClient — require-role.ts imports it but requireEffectiveRole
// never calls it (the caller supplies the client directly).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: vi.fn() }))

import { requireEffectiveRole } from './require-role'

/** Build a minimal supabase stub with auth.getUser and rpc mocked. */
function makeClient(
  userId: string,
  rpcResult: { data: string | null; error: null | { message: string } },
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValueOnce({ data: { user: { id: userId } } }),
    },
    rpc: vi.fn().mockResolvedValueOnce(rpcResult),
  }
}

function makeUnauthClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValueOnce({ data: { user: null } }),
    },
    rpc: vi.fn(),
  }
}

const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID    = 'user-arno'

describe('requireEffectiveRole — cross-org regression', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scenario 1: org-clause hit — owner in project org → ok:true', async () => {
    const client = makeClient(USER_ID, { data: 'owner', error: null })
    const result = await requireEffectiveRole(client as any, PROJECT_ID, ['owner'])

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.role).toBe('owner')

    // RPC was called with the right args.
    expect(client.rpc).toHaveBeenCalledWith('user_effective_project_role', {
      p_project_id: PROJECT_ID,
      p_user_id:    USER_ID,
    })
  })

  it('scenario 2: cross-org sub-org user — project_members row → ok:true', async () => {
    // User is NOT in the project's parent org, but IS in project_members as
    // 'contractor'. The DB function resolves this and returns 'contractor'.
    const client = makeClient(USER_ID, { data: 'contractor', error: null })
    const result = await requireEffectiveRole(client as any, PROJECT_ID, ['contractor'])

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.role).toBe('contractor')
  })

  it('scenario 3: no access — RPC returns null → ok:false "No access to this project"', async () => {
    const client = makeClient(USER_ID, { data: null, error: null })
    const result = await requireEffectiveRole(
      client as any,
      PROJECT_ID,
      ['owner', 'admin', 'contractor'],
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('No access to this project')
  })

  it('scenario 4: role disallowed — RPC returns contractor but allowed is owner/admin → ok:false', async () => {
    const client = makeClient(USER_ID, { data: 'contractor', error: null })
    const result = await requireEffectiveRole(client as any, PROJECT_ID, ['owner', 'admin'])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/contractor/)
      expect(result.error).toMatch(/not allowed/)
    }
  })

  it('unauthenticated — no user session → ok:false "Not authenticated"', async () => {
    const client = makeUnauthClient()
    const result = await requireEffectiveRole(client as any, PROJECT_ID, ['owner'])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Not authenticated')
    // RPC should never be called when user is null.
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('RPC error propagates as ok:false with the error message', async () => {
    const client = makeClient(USER_ID, { data: null, error: { message: 'connection refused' } })
    const result = await requireEffectiveRole(client as any, PROJECT_ID, ['owner'])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('connection refused')
  })
})
