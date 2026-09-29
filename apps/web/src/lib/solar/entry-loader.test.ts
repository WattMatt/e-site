import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { loadSolarEntry } from './entry-loader'
import { fakeSupabase } from '@/test/fake-supabase'

const P = 'p1'
const ORG = 'org-1'
const U = 'user-1'

function setup(o: {
  role?: string | null
  level?: string | null
  levelError?: boolean
  grantor?: boolean
  member?: boolean
  subscribed?: boolean
  requests?: Array<Record<string, unknown>>
  project?: boolean
} = {}) {
  return fakeSupabase({
    userId: U,
    rpc: {
      user_effective_project_role: { data: o.role === undefined ? 'contractor' : o.role, error: null },
      solar_access_level: o.levelError ? { data: 'edit', error: { message: 'boom' } } : { data: o.level ?? null, error: null },
      solar_is_grantor: { data: o.grantor ?? false, error: null },
      org_has_solar: { data: o.subscribed ?? false, error: null },
    },
    tables: {
      'projects.projects': o.project === false ? [] : [{ id: P, name: 'Mall', organisation_id: ORG }],
      'public.user_organisations': o.member === false ? [] : [{ user_id: U, organisation_id: ORG, is_active: true }],
      'solar.access_requests': o.requests ?? [],
    },
  })
}

describe('loadSolarEntry', () => {
  it('returns null for an unknown project', async () => {
    const { client } = setup({ project: false })
    await expect(loadSolarEntry(P, client as never)).resolves.toBeNull()
  })

  it('own-org member, subscribed, no grant → request access up to edit + financials', async () => {
    const { client } = setup({ subscribed: true })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx).toEqual({
      projectId: P, projectName: 'Mall', organisationId: ORG, userId: U,
      state: { kind: 'request_access', maxLevel: 'edit_financials' },
    })
  })

  it('finds my pending access request on this project', async () => {
    const { client } = setup({
      subscribed: true,
      requests: [{ project_id: P, requester_id: U, organisation_id: ORG, kind: 'access', status: 'pending', created_at: '2026-09-28T08:00:00Z' }],
    })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('finds a pending subscribe request raised from ANOTHER project of the org', async () => {
    const { client } = setup({
      subscribed: false,
      requests: [{ project_id: 'p-other', requester_id: U, organisation_id: ORG, kind: 'subscribe', status: 'pending', created_at: '2026-09-27T08:00:00Z' }],
    })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'ask_admin', requestedAt: '2026-09-27T08:00:00Z' })
  })

  it('an external member never asks org_has_solar (it is false for non-members) and may request View', async () => {
    const { client } = setup({ member: false, subscribed: true })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'request_access', maxLevel: 'view' })
    expect(client.rpc).not.toHaveBeenCalledWith('org_has_solar', expect.anything())
  })

  it('grantor of an unsubscribed org → subscribe', async () => {
    const { client } = setup({ role: 'admin', grantor: true, subscribed: false })
    expect((await loadSolarEntry(P, client as never))?.state).toEqual({ kind: 'subscribe' })
  })

  it('a supplier is hidden', async () => {
    const { client } = setup({ role: 'supplier' })
    expect((await loadSolarEntry(P, client as never))?.state).toEqual({ kind: 'hidden' })
  })

  it('an RPC error on the level fails closed (treated as no access)', async () => {
    const { client } = setup({ levelError: true, subscribed: true })
    expect((await loadSolarEntry(P, client as never))?.state.kind).toBe('request_access')
  })
})
