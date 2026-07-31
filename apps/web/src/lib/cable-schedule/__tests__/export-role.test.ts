import { describe, it, expect } from 'vitest'
import { getExportPolicy } from '../export-role'

/**
 * Role × outcome matrix for the highest-risk function in the cable-schedule
 * module — `getExportPolicy` gates every PDF / Excel / ZIP / CSV export route.
 *
 * Policy (2026-07-31, user-confirmed):
 *   - Resolution runs through public.user_effective_project_role (the same
 *     RPC requireEffectiveRole uses): org owner/admin/PM win outright, else
 *     projects.project_members.role applies, else null.
 *   - owner / admin / project_manager → full export.
 *   - contractor / inspector / supplier / client_viewer → export allowed,
 *     cost redacted (redactCost derives from COST_VIEW_ROLES membership).
 *   - No effective role on the project (unassigned member of ANY org role,
 *     or outsider) → blocked. This preserves the pre-existing client_viewer
 *     project-scoping and extends it to the site roles.
 */

function mockSupabase(opts: { effectiveRole: string | null; rpcError?: string }) {
  const calls: Array<{ fn: string; args: unknown }> = []
  return {
    calls,
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } }
      return { data: opts.effectiveRole, error: null }
    },
  } as any
}

describe('getExportPolicy', () => {
  it.each([
    ['owner', false],
    ['admin', false],
    ['project_manager', false],
  ] as const)('%s -> full export (redactCost=%s)', async (role, redact) => {
    const sb = mockSupabase({ effectiveRole: role })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(true)
    expect(r.redactCost).toBe(redact)
    expect(r.reason).toBeUndefined()
  })

  it.each([
    ['contractor'],
    ['inspector'],
    ['supplier'],
    ['client_viewer'],
  ] as const)('%s -> export allowed with cost redacted', async (role) => {
    const sb = mockSupabase({ effectiveRole: role })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(true)
    expect(r.redactCost).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it('no effective role on the project -> blocked', async () => {
    const sb = mockSupabase({ effectiveRole: null })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.reason).toMatch(/no access/i)
  })

  it('RPC error -> blocked with a GENERIC reason (no DB internals in the 403 body)', async () => {
    const sb = mockSupabase({ effectiveRole: null, rpcError: 'function not in schema cache' })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.reason).toBe('Role check failed')
    expect(r.reason).not.toMatch(/schema cache/)
  })

  it('unrecognised role string -> blocked (unknown ⇒ deny, fail closed)', async () => {
    const sb = mockSupabase({ effectiveRole: 'mystery_role' })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.reason).toMatch(/unknown role/i)
  })

  it('resolves via user_effective_project_role with the right params', async () => {
    const sb = mockSupabase({ effectiveRole: 'contractor' })
    await getExportPolicy(sb, 'user-9', 'proj-7')
    expect(sb.calls).toEqual([
      {
        fn: 'user_effective_project_role',
        args: { p_project_id: 'proj-7', p_user_id: 'user-9' },
      },
    ])
  })

  it('a per-project PM promotion yields full export (RPC returns the promoted role)', async () => {
    // The RPC itself applies promotion rules; getExportPolicy just consumes
    // the resolved role. A contractor org member promoted via
    // project_members.role='project_manager' arrives here as PM.
    const sb = mockSupabase({ effectiveRole: 'project_manager' })
    const r = await getExportPolicy(sb, 'u1', 'proj1')
    expect(r.canExport).toBe(true)
    expect(r.redactCost).toBe(false)
  })
})
