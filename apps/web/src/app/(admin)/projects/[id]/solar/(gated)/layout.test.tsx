import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`) }),
}))
vi.mock('next/navigation', () => ({
  redirect: (p: string) => h.redirect(p),
  usePathname: () => '/projects/p1/solar/overview',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/actions/solar-requests.actions', () => ({ requestSolarAccessAction: vi.fn() }))

import SolarGatedLayout from './layout'
import { fakeSupabase } from '@/test/fake-supabase'

function setup(grantor: boolean, level: string) {
  const { client } = fakeSupabase({
    rpc: { solar_is_grantor: { data: grantor, error: null } },
    tables: { 'projects.projects': [{ id: 'p1', name: 'Kings Mall' }] },
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
})
