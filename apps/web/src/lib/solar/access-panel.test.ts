import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))

import { loadSolarAccessPanel } from './access-panel'
import { fakeSupabase } from '@/test/fake-supabase'

const P = 'p1'
const ORG = 'org-1'
const T1 = '2026-09-28T08:00:00Z'

function setup(o: { grantor?: boolean; subscribed?: boolean } = {}) {
  const user = fakeSupabase({
    userId: 'admin-1',
    rpc: {
      solar_is_grantor: { data: o.grantor ?? true, error: null },
      org_has_solar: { data: o.subscribed ?? false, error: null },
    },
    tables: {
      'projects.projects': [
        { id: P, name: 'Kings Mall', organisation_id: ORG },
        { id: 'p2', name: 'Other Mall', organisation_id: ORG },
      ],
      'solar.project_access': [{ project_id: P, user_id: 'u-con', level: 'view', granted_by: 'admin-1', granted_at: T1, updated_at: T1 }],
      'solar.access_requests': [
        { id: 'r1', project_id: P, organisation_id: ORG, requester_id: 'u-ext', kind: 'access', status: 'pending', requested_level: 'view', note: null, created_at: T1 },
        { id: 's1', project_id: 'p2', organisation_id: ORG, requester_id: 'u-con', kind: 'subscribe', status: 'pending', requested_level: null, note: 'PV please', created_at: T1 },
        { id: 's0', project_id: P, organisation_id: ORG, requester_id: 'u-con', kind: 'subscribe', status: 'approved', requested_level: null, note: null, created_at: T1 },
      ],
      'billing.org_addon_subscriptions': [],
    },
  })
  const svc = fakeSupabase({
    tables: {
      'projects.project_members': [
        { project_id: P, user_id: 'u-con', role: 'contractor', organisation_id: ORG, is_active: true },
        { project_id: P, user_id: 'u-ext', role: 'contractor', organisation_id: 'org-x', is_active: true },
        { project_id: P, user_id: 'u-sup', role: 'supplier', organisation_id: 'org-x', is_active: true },
      ],
      'public.user_organisations': [
        { organisation_id: ORG, user_id: 'admin-1', role: 'admin', is_active: true },
        { organisation_id: ORG, user_id: 'u-con', role: 'contractor', is_active: true },
      ],
      'public.profiles': [
        { id: 'admin-1', full_name: 'Ann Admin', email: 'ann@x.test' },
        { id: 'u-con', full_name: 'Carl Contractor', email: 'c@x.test' },
        { id: 'u-ext', full_name: 'Eve External', email: 'e@x.test' },
      ],
    },
  })
  h.createClient.mockResolvedValue(user.client)
  h.createServiceClient.mockReturnValue(svc.client)
  return { user, svc }
}

beforeEach(() => { vi.clearAllMocks() })

describe('loadSolarAccessPanel', () => {
  it('returns null for a non-grantor and never opens the service client', async () => {
    setup({ grantor: false })
    await expect(loadSolarAccessPanel(P)).resolves.toBeNull()
    expect(h.createServiceClient).not.toHaveBeenCalled()
  })

  it('lists members (owner implicit, external capped, supplier excluded) and access requests', async () => {
    setup()
    const d = await loadSolarAccessPanel(P)
    expect(d?.members.map((m) => [m.name, m.implicit, m.external, m.level])).toEqual([
      ['Ann Admin', true, false, 'edit_financials'],
      ['Carl Contractor', false, false, 'view'],
      ['Eve External', false, true, null],
    ])
    expect(d?.requests).toEqual([
      { id: 'r1', requesterId: 'u-ext', requesterName: 'Eve External', requestedLevel: 'view', maxLevel: 'view', note: null, createdAt: T1 },
    ])
  })

  it('lists the org’s pending subscribe requests with the project they came from (owner default 3)', async () => {
    setup({ subscribed: true })
    const d = await loadSolarAccessPanel(P)
    expect(d?.subscribeRequests).toEqual([
      { id: 's1', requesterName: 'Carl Contractor', projectName: 'Other Mall', note: 'PV please', createdAt: T1 },
    ])
    expect(d?.orgSubscribed).toBe(true)
  })
})
