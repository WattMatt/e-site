import { describe, it, expect } from 'vitest'
import { getExportPolicy } from '../export-role'

/**
 * 4-role × 2-membership smoke matrix for the highest-risk function in the
 * cable-schedule module. `getExportPolicy` gates every PDF / Excel / ZIP /
 * CSV export route — if the role mapping breaks silently (e.g. a future
 * schema change that renames `is_active` or `role`), every export becomes
 * either over- or under-permissive without anyone noticing.
 *
 * Mock the SupabaseClient minimally to mirror the function's actual query
 * shape:
 *   - from('user_organisations').select('role').eq.eq.eq.maybeSingle()
 *   - schema('projects').from('project_members').select('id')
 *       .eq.eq.eq.maybeSingle()  (client_viewer only)
 *
 * Each builder returns `this` from .select() and .eq() so any number of
 * chained calls works, then .maybeSingle() resolves the canned row.
 */

type MockOpts = {
  userOrgRole:
    | 'owner'
    | 'admin'
    | 'project_manager'
    | 'client_viewer'
    | 'mystery_role'
    | null
  hasProjectMembership?: boolean
}

function mockSupabase(opts: MockOpts) {
  function builder(rowResolver: () => Promise<{ data: unknown }>) {
    const b: Record<string, unknown> = {
      select() { return b },
      eq() { return b },
      maybeSingle: rowResolver,
    }
    return b
  }
  return {
    from(table: string) {
      if (table !== 'user_organisations') {
        throw new Error(`unexpected table from public: ${table}`)
      }
      return builder(async () => ({
        data: opts.userOrgRole ? { role: opts.userOrgRole } : null,
      }))
    },
    schema(s: string) {
      if (s !== 'projects') throw new Error(`unexpected schema ${s}`)
      return {
        from(table: string) {
          if (table !== 'project_members') {
            throw new Error(`unexpected table from projects: ${table}`)
          }
          return builder(async () => ({
            data: opts.hasProjectMembership ? { id: 'pm1' } : null,
          }))
        },
      }
    },
  } as any
}

describe('getExportPolicy', () => {
  it.each([
    ['owner', true, false],
    ['admin', true, false],
    ['project_manager', true, false],
  ] as const)(
    '%s -> canExport=%s redactCost=%s (no project_members check)',
    async (role, canExport, redactCost) => {
      const sb = mockSupabase({ userOrgRole: role })
      const r = await getExportPolicy(sb, 'u1', 'org1', 'proj1')
      expect(r.canExport).toBe(canExport)
      expect(r.redactCost).toBe(redactCost)
      expect(r.reason).toBeUndefined()
    },
  )

  it('client_viewer IN project_members -> canExport + redact', async () => {
    const sb = mockSupabase({
      userOrgRole: 'client_viewer',
      hasProjectMembership: true,
    })
    const r = await getExportPolicy(sb, 'u1', 'org1', 'proj1')
    expect(r.canExport).toBe(true)
    expect(r.redactCost).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it('client_viewer NOT in project_members -> blocked but flagged redact', async () => {
    const sb = mockSupabase({
      userOrgRole: 'client_viewer',
      hasProjectMembership: false,
    })
    const r = await getExportPolicy(sb, 'u1', 'org1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.redactCost).toBe(true)
    expect(r.reason).toMatch(/not assigned/i)
  })

  it('no org membership -> blocked, no-membership reason', async () => {
    const sb = mockSupabase({ userOrgRole: null })
    const r = await getExportPolicy(sb, 'u1', 'org1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.redactCost).toBe(false)
    expect(r.reason).toMatch(/not a member/i)
  })

  it('unknown role -> blocked with unknown-role reason', async () => {
    const sb = mockSupabase({ userOrgRole: 'mystery_role' })
    const r = await getExportPolicy(sb, 'u1', 'org1', 'proj1')
    expect(r.canExport).toBe(false)
    expect(r.redactCost).toBe(false)
    expect(r.reason).toMatch(/unknown role/i)
  })
})
