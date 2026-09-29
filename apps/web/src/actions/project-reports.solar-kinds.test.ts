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

const P = 'bbbbbbbb-0000-4000-8000-000000000001'
const rows = [
  { id: 'r1', project_id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'solar_feasibility', title: 'F', storage_path: 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/f.pdf', status: 'issued', version: 1 },
  { id: 'r2', project_id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'solar_technical', title: 'T', storage_path: 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/t.pdf', status: 'issued', version: 1 },
  { id: 'r3', project_id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'solar_proposal', title: 'Pr', storage_path: 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/p.pdf', status: 'issued', version: 1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  const fake = fakeSupabase({
    tables: { 'projects.reports': rows, 'projects.projects': [{ id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001' }] },
    writes: { 'projects.reports:delete': { data: [{ id: 'deleted' }] } },
  })
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
  it('deleting a Solar report needs OWNER_ADMIN, not just an org write role (spec §9.2, review I4)', async () => {
    h.level.mockResolvedValue('edit_financials')
    h.requireRole.mockImplementation((async (_s: unknown, _o: unknown, roles: readonly string[]) =>
      roles.includes('project_manager') ? { ok: true } : { ok: false, error: 'Your role (project_manager) is not allowed' }) as never)
    await expect(deleteProjectReportAction(P, 'r2')).resolves.toEqual({ error: 'Your role (project_manager) is not allowed' })
    await expect(deleteProjectReportAction(P, 'r1')).resolves.toEqual({ error: 'Your role (project_manager) is not allowed' })
    h.requireRole.mockImplementation(async () => ({ ok: true }))
    await expect(deleteProjectReportAction(P, 'r2')).resolves.toEqual({ ok: true })
  })
  it('deleting a Solar report needs Solar Edit', async () => {
    h.level.mockResolvedValue('view')
    await expect(deleteProjectReportAction(P, 'r2')).resolves.toEqual({ error: 'You do not have Solar edit access on this project.' })
  })
})

// Review round 2 (C1): the URL action gates on a row's KIND and then service-signs its storage_path,
// so a forged row (00117 reports_write lets owner/admin/PM write any row) could point an open or
// View-level kind at a feasibility PDF. 00216 refuses the write; this refuses the sign as well.
describe('a report URL is signed only for a path that belongs to the row (review round 2, C1)', () => {
  const FEAS_PATH = 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/solar-reports/solar_feasibility-v1-run1.pdf'
  const REFUSED = 'This report’s file could not be verified, so it cannot be opened.'
  function withRows(extra: Array<Record<string, unknown>>) {
    const fake = fakeSupabase({ tables: { 'projects.reports': [...rows, ...extra], 'projects.projects': [{ id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001' }] } })
    h.createClient.mockResolvedValue(fake.client)
    const svc = withStorage(fakeSupabase())
    h.createServiceClient.mockReturnValue(svc.client)
    return svc
  }
  const row = (id: string, kind: string, storage_path: string) =>
    ({ id, project_id: P, organisation_id: 'aaaaaaaa-0000-4000-8000-000000000001', kind, title: 'X', storage_path, status: 'issued', version: 1 })

  it('refuses an open kind pointed at a Solar PDF, even for a money user', async () => {
    h.level.mockResolvedValue('edit_financials')
    const svc = withRows([row('f1', 'tenant_schedule', FEAS_PATH)])
    await expect(getProjectReportUrlAction(P, 'f1')).resolves.toEqual({ error: REFUSED })
    expect(svc.bucket.createSignedUrl).not.toHaveBeenCalled()
  })
  it('refuses a technical row pointed at a feasibility PDF for a View/Edit user', async () => {
    h.level.mockResolvedValue('edit')
    const svc = withRows([row('f2', 'solar_technical', FEAS_PATH), row('f3', 'solar_technical', 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/solar-proposals/x-v1.pdf')])
    await expect(getProjectReportUrlAction(P, 'f2')).resolves.toEqual({ error: REFUSED })
    await expect(getProjectReportUrlAction(P, 'f3')).resolves.toEqual({ error: REFUSED })
    expect(svc.bucket.createSignedUrl).not.toHaveBeenCalled()
  })
  it('refuses a path outside the row’s own <org>/<project>/ prefix', async () => {
    h.level.mockResolvedValue('edit_financials')
    const svc = withRows([row('f4', 'tenant_schedule', 'cccccccc-0000-4000-8000-000000000002/dddddddd-0000-4000-8000-000000000009/tenant-schedule-v1.pdf'), row('f5', 'tenant_schedule', 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-00000000000e/tenant-schedule-v1.pdf')])
    await expect(getProjectReportUrlAction(P, 'f4')).resolves.toEqual({ error: REFUSED })
    await expect(getProjectReportUrlAction(P, 'f5')).resolves.toEqual({ error: REFUSED })
    expect(svc.bucket.createSignedUrl).not.toHaveBeenCalled()
  })
  // Review round 3: storage-js does not encode the path and fetch's URL parser canonicalises it,
  // so each of these passes a raw-string prefix + /solar-…/ test yet signs a different object.
  it('refuses a path the URL parser would rewrite, before any prefix or Solar check (review round 3)', async () => {
    h.level.mockResolvedValue('edit_financials')
    const base = 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001'
    const other = 'cccccccc-0000-4000-8000-000000000002/dddddddd-0000-4000-8000-000000000009'
    const forged = [
      `${base}/solar-reports\\f.pdf`,
      `${base}/solar-rep\torts/f.pdf`,
      `${base}/solar-rep\r\norts/f.pdf`,
      `${base}/x/..\\solar-proposals\\f.pdf`,
      `${base}/../../${other}/valuation-x.pdf`,
      `${base}/%2e%2e/%2e%2e/${other}/valuation-x.pdf`,
      `${base}/solar-reports%2Ff.pdf`,
      `${base}//solar-reports/f.pdf`,
    ]
    const svc = withRows(forged.flatMap((p, i) => [row(`c${i}`, 'tenant_schedule', p), row(`s${i}`, 'solar_feasibility', p)]))
    for (let i = 0; i < forged.length; i++) {
      await expect(getProjectReportUrlAction(P, `c${i}`), JSON.stringify(forged[i])).resolves.toEqual({ error: REFUSED })
      await expect(getProjectReportUrlAction(P, `s${i}`), JSON.stringify(forged[i])).resolves.toEqual({ error: REFUSED })
    }
    expect(svc.bucket.createSignedUrl).not.toHaveBeenCalled()
  })
  it('still signs a technical report on its own path for a View user, and a feasibility report for a money user', async () => {
    h.level.mockResolvedValue('view')
    const svc = withRows([row('ok1', 'solar_technical', 'aaaaaaaa-0000-4000-8000-000000000001/bbbbbbbb-0000-4000-8000-000000000001/solar-reports/solar_technical-v1-run1.pdf'), row('ok2', 'solar_feasibility', FEAS_PATH)])
    await expect(getProjectReportUrlAction(P, 'ok1')).resolves.toEqual({ url: 'https://signed.example/x' })
    h.level.mockResolvedValue('edit_financials')
    await expect(getProjectReportUrlAction(P, 'ok2')).resolves.toEqual({ url: 'https://signed.example/x' })
    expect(svc.bucket.createSignedUrl).toHaveBeenCalledTimes(2)
  })
})
