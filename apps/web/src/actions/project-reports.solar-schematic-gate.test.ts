// solar_schematic_sheet reads on the Solar level (00214). Kept in its own file,
// not Phase 5's project-reports.solar-gate.test.ts, so the two branches merge
// without an add/add conflict; Phase 5's file covers solar_layout_sheet.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getSolarAccessLevel: vi.fn(),
  requireEffectiveRole: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.getSolarAccessLevel }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole, requireRole: h.requireRole }))

import { listProjectReportsAction, getProjectReportUrlAction, deleteProjectReportAction } from './project-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '00000000-0000-0000-0000-000000000011'
const R = '00000000-0000-0000-0000-000000000055'
const ROW = {
  id: R, project_id: P, organisation_id: 'o', kind: 'solar_schematic_sheet', title: 'Schematic — Main SLD', storage_path: 'o/p/s.pdf',
  mime_type: 'application/pdf', size_bytes: 1, status: 'issued', version: 1, generated_by: null, generated_at: 't', created_at: 't',
}

beforeEach(() => {
  vi.clearAllMocks()
  const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW] } })
  h.createClient.mockResolvedValue(client)
  h.createServiceClient.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed' }, error: null })) }) },
  })
})

describe('Solar report kinds read on the Solar level', () => {
  it('lists solar_schematic_sheet for a caller with a View level (and never asks the role gate)', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    const res = await listProjectReportsAction(P, 'solar_schematic_sheet')
    expect(Array.isArray(res)).toBe(true)
    expect(h.requireEffectiveRole).not.toHaveBeenCalled()
  })
  it('refuses the list without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(listProjectReportsAction(P, 'solar_schematic_sheet')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('refuses the signed URL without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('mints the signed URL with a View level', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ url: 'https://signed' })
  })
  it('does not consult Solar for an ordinary kind', async () => {
    await listProjectReportsAction(P, 'tenant_schedule')
    expect(h.getSolarAccessLevel).not.toHaveBeenCalled()
  })
})

describe('deleteProjectReportAction — Solar kinds need Solar Edit', () => {
  it('an org writer with only Solar View cannot delete a schematic sheet', async () => {
    const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW], 'projects.projects': [{ id: P, organisation_id: 'o' }] } })
    h.createClient.mockResolvedValue(client)
    h.requireRole.mockResolvedValue({ ok: true })
    h.getSolarAccessLevel.mockResolvedValue('view')
    await expect(deleteProjectReportAction(P, R)).resolves.toEqual({ error: 'You do not have Solar edit access on this project.' })
  })
  it('Solar Edit may delete it', async () => {
    const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW], 'projects.projects': [{ id: P, organisation_id: 'o' }] } })
    h.createClient.mockResolvedValue(client)
    h.requireRole.mockResolvedValue({ ok: true })
    h.getSolarAccessLevel.mockResolvedValue('edit')
    h.createServiceClient.mockReturnValue({ storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })) }) } })
    await expect(deleteProjectReportAction(P, R)).resolves.toEqual({ ok: true })
  })
})
