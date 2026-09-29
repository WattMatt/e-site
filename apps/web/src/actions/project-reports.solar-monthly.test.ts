import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), level: vi.fn(),
  requireRole: vi.fn(async () => ({ ok: true })), requireEffectiveRole: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole, requireEffectiveRole: h.requireEffectiveRole }))

import { listProjectReportsAction, getProjectReportUrlAction, deleteProjectReportAction } from './project-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

// Canonical `<org uuid>/<project uuid>/…` paths: the URL action refuses anything else (review round 3).
const O = 'aaaaaaaa-0000-4000-8000-000000000001'
const P = 'bbbbbbbb-0000-4000-8000-000000000001'
// Monthly PDFs live under solar-reports/ so 00216's service-only storage + row policies cover them.
const rows = [{ id: 'm1', project_id: P, organisation_id: O, kind: 'solar_monthly', title: 'March',
  storage_path: `${O}/${P}/solar-reports/solar_monthly-2026-03-v1-abcdef012345.pdf`, status: 'issued', version: 1 }]

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'projects.reports': rows, 'projects.projects': [{ id: P, organisation_id: O }] } }).client)
  h.createServiceClient.mockReturnValue(withStorage(fakeSupabase()).client)
})

describe('solar_monthly follows Edit + financials (00217 mirrors this)', () => {
  it('Edit cannot list or open it; Edit + financials can', async () => {
    h.level.mockResolvedValue('edit')
    await expect(listProjectReportsAction(P, 'solar_monthly')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(getProjectReportUrlAction(P, 'm1')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    h.level.mockResolvedValue('edit_financials')
    const list = await listProjectReportsAction(P, 'solar_monthly')
    expect(Array.isArray(list) && list.map((r) => r.id)).toEqual(['m1'])
    await expect(getProjectReportUrlAction(P, 'm1')).resolves.toEqual({ url: 'https://signed.example/x' })
  })
  it('a View-level kind forged onto a monthly PDF is not signed for an Edit user', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ tables: {
      'projects.reports': [{ ...rows[0]!, id: 't1', kind: 'solar_technical' }], 'projects.projects': [{ id: P, organisation_id: O }] } }).client)
    h.level.mockResolvedValue('edit')
    await expect(getProjectReportUrlAction(P, 't1')).resolves.toEqual({ error: 'This report’s file could not be verified, so it cannot be opened.' })
  })
  it('a monthly report is the record of what the client received and is never deleted', async () => {
    h.level.mockResolvedValue('edit_financials')
    await expect(deleteProjectReportAction(P, 'm1')).resolves.toEqual({
      error: 'A monthly report is kept as the record of what the client received — generate a new version instead.',
    })
  })
})
