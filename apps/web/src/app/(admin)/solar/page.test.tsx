import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({
  ctx: null as null | { userId: string; organisationId: string; role: string },
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: {} as Record<string, unknown>,
  table: vi.fn((p: unknown) => { void p }),
  subscribe: vi.fn((p: unknown) => { void p }),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
}))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: vi.fn(async () => h.ctx) }))
vi.mock('@/lib/supabase/server', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClient: async () => fakeSupabase({ tables: h.tables, rpc: h.rpc as any }).client,
}))
vi.mock('./PortfolioTable', () => ({ PortfolioTable: (p: unknown) => { h.table(p); return <div>table</div> } }))
vi.mock('@/app/(admin)/projects/[id]/solar/_components/SubscribeButton', () => ({
  SubscribeButton: (p: unknown) => { h.subscribe(p); return <button>Subscribe</button> },
}))
import SolarPortfolioPage from './page'

const portfolioRow = {
  project_id: 'p1', project_name: 'Acme Mall', province: 'Gauteng', city: 'Pretoria', licensee_name: 'City Power',
  stage: 'study', selected_case_name: 'Base', selected_kwp: '500.00', proposed_kwp: null,
  year1_saving_zar: '123456.7', last_activity: '2026-09-28T10:00:00Z', can_see_money: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ctx = { userId: 'u1', organisationId: 'o1', role: 'owner' }
  h.tables = { 'public.organisations': [{ id: 'o1', name: 'Acme Engineering' }], 'projects.projects': [{ id: 'p1', organisation_id: 'o1' }] }
  h.rpc = { org_has_solar: { data: true, error: null }, solar_portfolio: { data: [portfolioRow], error: null } }
})

describe('/solar portfolio page (§15)', () => {
  it('signed out → login', async () => {
    h.ctx = null
    await expect(SolarPortfolioPage()).rejects.toThrow('REDIRECT /login?next=/solar')
  })
  it('subscribed: hands the table JSON rows; a saving without money is dropped server-side', async () => {
    render(await SolarPortfolioPage())
    const props = h.table.mock.calls[0]![0] as { rows: Array<Record<string, unknown>>; isAdmin: boolean }
    expect(props.isAdmin).toBe(true)
    expect(props.rows[0]).toMatchObject({ projectId: 'p1', selectedKwp: 500, year1SavingZar: null, canSeeMoney: false })
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)
    expect(screen.getByText(/no map component yet/)).toBeTruthy()
  })
  it('non-admin member: isAdmin false', async () => {
    h.ctx = { userId: 'u1', organisationId: 'o1', role: 'contractor' }
    render(await SolarPortfolioPage())
    expect((h.table.mock.calls[0]![0] as { isAdmin: boolean }).isAdmin).toBe(false)
  })
  it('unsubscribed owner/admin: Subscribe for any project of the org', async () => {
    h.rpc.org_has_solar = { data: false, error: null }
    render(await SolarPortfolioPage())
    expect(screen.getByText('Solar is not active for Acme Engineering')).toBeTruthy()
    expect(h.subscribe).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(h.table).not.toHaveBeenCalled()
  })
  it('unsubscribed non-admin: ask an admin, no Subscribe', async () => {
    h.ctx = { userId: 'u1', organisationId: 'o1', role: 'contractor' }
    h.rpc.org_has_solar = { data: false, error: null }
    render(await SolarPortfolioPage())
    expect(screen.getByText(/Ask an organisation owner or admin to subscribe/)).toBeTruthy()
    expect(h.subscribe).not.toHaveBeenCalled()
  })
})
