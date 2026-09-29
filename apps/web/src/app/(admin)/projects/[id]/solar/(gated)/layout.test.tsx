import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  extra: vi.fn(async (): Promise<Record<string, unknown>> => ({ stale: null })),
  svc: vi.fn(() => ({ svc: true })),
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`) }),
}))
vi.mock('next/navigation', () => ({
  redirect: (p: string) => h.redirect(p),
  usePathname: () => '/projects/p1/solar/overview',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.svc }))
vi.mock('@/lib/solar/cases/page-data', () => ({ loadSolarReadinessExtra: h.extra }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/actions/solar-requests.actions', () => ({ requestSolarAccessAction: vi.fn() }))

import SolarGatedLayout from './layout'
import { fakeSupabase } from '@/test/fake-supabase'

function setup(grantor: boolean, level: string, ownOrg = true) {
  const { client } = fakeSupabase({
    userId: 'u1',
    rpc: { solar_is_grantor: { data: grantor, error: null } },
    tables: {
      'projects.projects': [{ id: 'p1', name: 'Kings Mall', organisation_id: 'org-1' }],
      'public.user_organisations': ownOrg ? [{ user_id: 'u1', organisation_id: 'org-1', is_active: true }] : [],
    },
  })
  h.createClient.mockResolvedValue(client)
  h.requireSolarLevel.mockResolvedValue(level)
}

const args = { children: <p>child</p>, params: Promise.resolve({ id: 'p1' }) }

beforeEach(() => { vi.clearAllMocks() })

// Owner default 1 (2026-09-28): the gated chrome offers "Manage access" to
// grantors only — the Access panel is otherwise unreachable from the module.
describe('Solar gated layout — Manage access link', () => {
  it('shows Manage access to a grantor', async () => {
    setup(true, 'edit_financials')
    render(await SolarGatedLayout(args))
    expect(screen.getByRole('link', { name: 'Manage access' }).getAttribute('href')).toBe('/projects/p1/solar/access')
    expect(screen.getByText('child')).toBeDefined()
  })

  it('hides it from everyone else (hidden, not disabled)', async () => {
    setup(false, 'edit_financials')
    render(await SolarGatedLayout(args))
    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull()
  })

  it('a View user sees the view-only banner and no Manage access', async () => {
    setup(false, 'view')
    render(await SolarGatedLayout(args))
    expect(screen.getByText('You have view access — ask an admin for edit access')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull()
  })

  it('an own-org View user can request edit; an external View user cannot', async () => {
    setup(false, 'view', true)
    const { unmount } = render(await SolarGatedLayout(args))
    expect(screen.getByRole('button', { name: 'Request edit access' })).toBeDefined()
    unmount()
    setup(false, 'view', false)
    render(await SolarGatedLayout(args))
    expect(screen.queryByRole('button', { name: 'Request edit access' })).toBeNull()
    expect(screen.getByText('You have view access. Members from outside the organisation can have View only.')).toBeDefined()
  })
})

describe('Solar gated layout — Phase 4b readiness dots', () => {
  it('feeds the stored-run readiness (Yield / Financials) into the tab dots, at the caller\'s level', async () => {
    setup(false, 'edit_financials')
    h.extra.mockResolvedValueOnce({ yield: { caseCount: 2, selectedCaseId: 'c1', selectedStatus: 'stale' }, financials: { capexZar: 1, hasModel: true, usingOrgDefaults: false }, stale: { caseId: 'c1', caseName: 'Base' } })
    render(await SolarGatedLayout(args))
    expect(h.extra).toHaveBeenCalledWith(expect.anything(), { svc: true }, 'p1', 'edit_financials')
    expect(screen.getByRole('img', { name: 'Incomplete: The selected case is stale — re-run it' })).toBeDefined()
    expect(screen.getByRole('img', { name: 'Complete: Capex and a finance model are set' })).toBeDefined()
  })
  it('a refused caller never reaches the readiness loader', async () => {
    setup(false, 'view')
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(SolarGatedLayout(args)).rejects.toThrow('REDIRECT')
    expect(h.extra).not.toHaveBeenCalled()
    expect(h.svc).not.toHaveBeenCalled()
  })
})
