import { vi, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'

const m = vi.hoisted(() => ({
  listAccessible: vi.fn(), getById: vi.fn(),
  getProjectSettingsCached: vi.fn(), getProjectHistoryCached: vi.fn(),
  listProjectContacts: vi.fn(), listProjectMembers: vi.fn(), listMyOrganisations: vi.fn(),
  requireEffectiveRole: vi.fn(), requireProjectAccess: vi.fn(),
}))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), projectService: { listAccessible: m.listAccessible, getById: m.getById } }))
vi.mock('@/lib/project-settings', () => ({ getProjectSettingsCached: m.getProjectSettingsCached, getProjectHistoryCached: m.getProjectHistoryCached }))
vi.mock('@/actions/project-contacts.actions', () => ({ listProjectContacts: m.listProjectContacts }))
vi.mock('@/actions/project-members.actions', () => ({ listProjectMembers: m.listProjectMembers }))
vi.mock('@/actions/active-organisation.actions', () => ({ listMyOrganisations: m.listMyOrganisations }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: m.requireEffectiveRole }))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: m.requireProjectAccess }))
vi.mock('@/lib/projects/cost-visibility', () => ({ loadCostVisibility: async () => (p: { id: string }) => p.id === P1 }))

import { discoveryTools } from './discovery'
import { ToolRefusal, type RegisteredTool } from '../define-tool'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const O1 = '33333333-3333-4333-8333-333333333333'
const rpc = vi.fn()
const ctx = { client: { rpc }, user: { id: 'u1', email: 'a@b.co' }, claims: { client_id: 'c9' }, memberships: [] } as never
const tool = (name: string) => discoveryTools.find(t => t.name === name) as RegisteredTool
// Parse as the MCP SDK does before the handler runs, so clamping and defaults are exercised.
const run = (name: string, args: unknown) => {
  const t = tool(name)
  return (t.handler as (a: unknown, c: unknown) => Promise<any>)(z.object(t.inputSchema).parse(args), ctx)
}
const row = (i: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, code: `C${i}`, name: `P${i}`, organisation_id: O1, status: 'active',
  client_name: 'Client', start_date: null, end_date: null, opening_date: null, cloud_storage_connection_id: null, contract_value: 100,
  created_at: new Date(Date.UTC(2026, 0, 1) - i * 1000).toISOString(), ...extra,
})

beforeEach(() => { vi.clearAllMocks() })

it('registers the four discovery tools as read tools', () => {
  expect(discoveryTools.map(t => t.name)).toEqual(['esite_whoami', 'esite_projects_list', 'esite_project_get', 'esite_project_history'])
  expect(discoveryTools.every(t => t.kind === 'read')).toBe(true)
})

it('esite_whoami returns clientId from claims and effectiveRole per project', async () => {
  m.listMyOrganisations.mockResolvedValue({ ok: true, memberships: [{ organisation_id: O1, organisation_name: 'WM', role: 'owner', is_active_context: true }] })
  m.listAccessible.mockResolvedValue([row(1, { id: P1 }), row(2, { id: P2 })])
  rpc.mockImplementation(async (_fn: string, a: { p_project_id: string }) => ({ data: a.p_project_id === P1 ? 'project_manager' : 'contractor', error: null }))
  const out = await run('esite_whoami', {})
  expect(rpc).toHaveBeenCalledWith('user_effective_project_role', { p_project_id: P1, p_user_id: 'u1' })
  expect(out).toEqual({
    userId: 'u1', email: 'a@b.co', clientId: 'c9',
    organisations: [{ id: O1, name: 'WM', role: 'owner' }],
    projects: [
      { id: P1, code: 'C1', name: 'P1', organisationId: O1, effectiveRole: 'project_manager' },
      { id: P2, code: 'C2', name: 'P2', organisationId: O1, effectiveRole: 'contractor' },
    ],
  })
})

it('esite_projects_list clamps limit to 200 and 1 and reports truncated', async () => {
  m.listAccessible.mockResolvedValue(Array.from({ length: 250 }, (_, i) => row(i + 1)))
  const big = await run('esite_projects_list', { limit: 10000 })
  expect(big.projects).toHaveLength(200)
  expect(big.truncated).toBe(true)
  expect(big.nextCursor).toEqual(expect.any(String))
  const small = await run('esite_projects_list', { limit: -5 })
  expect(small.projects).toHaveLength(1)
  const next = await run('esite_projects_list', { limit: 200, cursor: big.nextCursor })
  expect(next.projects).toHaveLength(50)
  expect(next.truncated).toBe(false)
  expect(next.nextCursor).toBeNull()
  expect(next.projects[0].id).toBe(row(201).id)
})

it('esite_projects_list gives contractValue only for projects whose cost the caller can see', async () => {
  m.listAccessible.mockResolvedValue([row(1, { id: P1 }), row(2, { id: P2 })])
  const out = await run('esite_projects_list', {})
  expect(out.projects[0]).toMatchObject({ id: P1, canSeeCost: true, contractValue: 100, dropboxMapped: false })
  expect(out.projects[1]).toMatchObject({ id: P2, canSeeCost: false })
  expect('contractValue' in out.projects[1]).toBe(false)
})

it('esite_projects_list refuses a cursor it did not issue', async () => {
  m.listAccessible.mockResolvedValue([row(1)])
  await expect(run('esite_projects_list', { cursor: '!!!' })).rejects.toBeInstanceOf(ToolRefusal)
})

it('esite_project_get omits contract for a contractor and refuses an invisible project', async () => {
  m.requireProjectAccess.mockResolvedValue({ ok: true })
  m.getById.mockResolvedValue({ ...row(1, { id: P1 }), project_members: [] })
  m.getProjectSettingsCached.mockResolvedValue({ projectId: P1, retentionPct: 5, contractType: 'jbcc_pba', units: 'metric' })
  m.listProjectContacts.mockResolvedValue({ contacts: [{ id: 'c' }] })
  m.listProjectMembers.mockResolvedValue({ members: [{ user_id: 'u1', full_name: 'A', email: 'a@b.co', role: 'contractor', org_role: 'contractor', is_active: true }] })
  m.requireEffectiveRole.mockResolvedValue({ ok: false, error: 'no' })
  const lean = await run('esite_project_get', { projectId: P1 })
  expect(lean.contract).toBeNull()
  expect(JSON.stringify(lean)).not.toContain('retentionPct')
  expect(lean.project.id).toBe(P1)
  expect(lean.contacts).toEqual([{ id: 'c' }])
  expect(lean.members[0]).toMatchObject({ userId: 'u1', role: 'contractor' })

  m.requireEffectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
  const full = await run('esite_project_get', { projectId: P1 })
  expect(full.contract).toMatchObject({ contractValue: 100, retentionPct: 5 })

  m.requireProjectAccess.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
  const err = await run('esite_project_get', { projectId: P2 }).catch(e => e)
  expect(err).toBeInstanceOf(ToolRefusal)
  expect(err.message).toBe('Project not found')
  expect(m.getById).toHaveBeenCalledTimes(2)
})

it('esite_project_history refuses an invisible project, and hides retention from non-cost roles', async () => {
  m.requireProjectAccess.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
  await expect(run('esite_project_history', { projectId: P2 })).rejects.toThrow('Project not found')
  expect(m.getProjectHistoryCached).not.toHaveBeenCalled()

  m.requireProjectAccess.mockResolvedValue({ ok: true })
  m.getProjectHistoryCached.mockResolvedValue([{ id: 'h', operation: 'UPDATE', snapshot: { units: 'metric', retentionPct: 5 }, diff: { retentionPct: [5, 10], units: ['a', 'b'] }, changedBy: 'u', changedAt: 't' }])
  m.requireEffectiveRole.mockResolvedValue({ ok: false, error: 'no' })
  const lean = await run('esite_project_history', { projectId: P1, limit: 999 })
  expect(m.getProjectHistoryCached).toHaveBeenCalledWith(P1, 200)
  expect(lean.rows[0].snapshot).toEqual({ units: 'metric' })
  expect(lean.rows[0].diff).toEqual({ units: ['a', 'b'] })

  m.requireEffectiveRole.mockResolvedValue({ ok: true, role: 'owner' })
  const full = await run('esite_project_history', { projectId: P1 })
  expect(full.rows[0].snapshot.retentionPct).toBe(5)
})
