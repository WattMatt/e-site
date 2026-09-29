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

const P = 'p1'
const rows = [
  { id: 'r1', project_id: P, organisation_id: 'o1', kind: 'solar_feasibility', title: 'F', storage_path: 'o1/p1/f.pdf', status: 'issued', version: 1 },
  { id: 'r2', project_id: P, organisation_id: 'o1', kind: 'solar_technical', title: 'T', storage_path: 'o1/p1/t.pdf', status: 'issued', version: 1 },
  { id: 'r3', project_id: P, organisation_id: 'o1', kind: 'solar_proposal', title: 'Pr', storage_path: 'o1/p1/p.pdf', status: 'issued', version: 1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  const fake = fakeSupabase({ tables: { 'projects.reports': rows, 'projects.projects': [{ id: P, organisation_id: 'o1' }] } })
  h.createClient.mockResolvedValue(fake.client)
  h.createServiceClient.mockReturnValue(withStorage(fakeSupabase()).client)
})

describe('Solar report kinds follow the Solar level (00216 mirrors this)', () => {
  it('feasibility and proposal need Edit + financials; technical needs View', async () => {
    h.level.mockResolvedValue('edit')
    await expect(listProjectReportsAction(P, 'solar_feasibility')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(listProjectReportsAction(P, 'solar_proposal')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    const tech = await listProjectReportsAction(P, 'solar_technical')
    expect(Array.isArray(tech) && tech.map((r) => r.id)).toEqual(['r2'])
    h.level.mockResolvedValue('edit_financials')
    const fea = await listProjectReportsAction(P, 'solar_feasibility')
    expect(Array.isArray(fea) && fea.map((r) => r.id)).toEqual(['r1'])
  })
  it('no Solar level reads no Solar kind, even technical', async () => {
    h.level.mockResolvedValue(null)
    await expect(listProjectReportsAction(P, 'solar_technical')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(getProjectReportUrlAction(P, 'r2')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('a signed URL for a proposal PDF needs Edit + financials', async () => {
    h.level.mockResolvedValue('edit')
    await expect(getProjectReportUrlAction(P, 'r3')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    h.level.mockResolvedValue('edit_financials')
    await expect(getProjectReportUrlAction(P, 'r3')).resolves.toEqual({ url: 'https://signed.example/x' })
  })
  it('an issued proposal PDF is evidence and is never deleted', async () => {
    h.level.mockResolvedValue('edit_financials')
    await expect(deleteProjectReportAction(P, 'r3')).resolves.toEqual({
      error: 'An issued proposal’s PDF is kept as evidence and cannot be deleted — withdraw the proposal instead.',
    })
  })
  it('deleting a Solar report needs Solar Edit', async () => {
    h.level.mockResolvedValue('view')
    await expect(deleteProjectReportAction(P, 'r2')).resolves.toEqual({ error: 'You do not have Solar edit access on this project.' })
  })
})
