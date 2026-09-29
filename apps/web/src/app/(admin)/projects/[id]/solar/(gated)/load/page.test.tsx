import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  props: {} as Record<string, Record<string, unknown>>,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/load/views', () => ({
  loadMetersView: vi.fn(async (_s: unknown, _p: string, isGrantor: boolean) => ({ kind: 'meters', isGrantor })),
  loadTenantsView: vi.fn(async () => ({ kind: 'tenants' })),
  loadProfileView: vi.fn(async () => ({ kind: 'profile' })),
  loadChecksView: vi.fn(async () => ({ kind: 'checks' })),
}))
function capture(name: string) {
  return (p: Record<string, unknown>) => { h.props[name] = p; return null }
}
vi.mock('./_components/LoadBasisBar', () => ({ LoadBasisBar: capture('LoadBasisBar') }))
vi.mock('./_components/LoadSubTabs', () => ({ LoadSubTabs: capture('LoadSubTabs') }))
vi.mock('./_components/MetersPanel', () => ({ MetersPanel: capture('MetersPanel') }))
vi.mock('./_components/TenantsPanel', () => ({ TenantsPanel: capture('TenantsPanel') }))
vi.mock('./_components/SiteProfilePanel', () => ({ SiteProfilePanel: capture('SiteProfilePanel') }))
vi.mock('./_components/ChecksPanel', () => ({ ChecksPanel: capture('ChecksPanel') }))

import { render } from '@testing-library/react'
import SolarLoadPage from './page'
import { fakeSupabase } from '@/test/fake-supabase'

function setup(level: string, basis: string | null = 'S2') {
  const { client } = fakeSupabase({
    userId: 'u1',
    rpc: { solar_is_grantor: { data: true, error: null } },
    tables: { 'solar.studies': [{ id: 's1', project_id: 'p1', load_basis: basis, updated_at: 'T0' }] },
  })
  h.createClient.mockResolvedValue(client)
  h.requireSolarLevel.mockResolvedValue(level)
}
async function renderPage(tab?: string, meter?: string) {
  render(await SolarLoadPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({ tab, meter }) }))
}
/** Page → 'use client' props must be JSON (a function prop fails only at render, CLAUDE.md 2026-09-22). */
function expectJson(p: Record<string, unknown>) {
  expect(JSON.parse(JSON.stringify(p))).toEqual(p)
}

beforeEach(() => { vi.clearAllMocks(); h.props = {} })

describe('Solar Load page', () => {
  it('gates on Solar View and defaults to Meters; every client prop is JSON', async () => {
    setup('edit')
    await renderPage()
    expect(h.requireSolarLevel).toHaveBeenCalledWith('p1', 'view', expect.anything())
    expect(Object.keys(h.props).sort()).toEqual(['LoadBasisBar', 'LoadSubTabs', 'MetersPanel'])
    expect(h.props.MetersPanel).toMatchObject({ projectId: 'p1', canEdit: true, openMeterId: null, view: { kind: 'meters', isGrantor: true } })
    expect(h.props.LoadBasisBar).toMatchObject({ basis: 'S2', updatedAt: 'T0', canEdit: true })
    for (const p of Object.values(h.props)) expectJson(p)
  })
  it.each([['tenants', 'TenantsPanel'], ['profile', 'SiteProfilePanel'], ['checks', 'ChecksPanel']])('?tab=%s renders %s only', async (tab, panel) => {
    setup('edit')
    await renderPage(tab)
    expect(Object.keys(h.props).sort()).toEqual(['LoadBasisBar', 'LoadSubTabs', panel].sort())
    expectJson(h.props[panel]!)
  })
  it('View level gets canEdit false everywhere', async () => {
    setup('view')
    await renderPage('profile')
    expect(h.props.LoadBasisBar!.canEdit).toBe(false)
    expect(h.props.SiteProfilePanel!.canEdit).toBe(false)
  })
  it('a deep link to a meter opens it; stored S3 shows as S2', async () => {
    setup('edit', 'S3')
    await renderPage('meters', 'm9')
    expect(h.props.MetersPanel!.openMeterId).toBe('m9')
    expect(h.props.LoadBasisBar!.basis).toBe('S2')
  })
})
