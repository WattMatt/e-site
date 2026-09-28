import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn(),
  upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { exportLayoutSheetAction } from './solar-layout-export.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const L = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  const session = fakeSupabase({ userId: 'u1', tables: {
    'solar.layouts': [{ id: L, project_id: P, organisation_id: 'o1', name: 'Option A', roof_source_id: 'rs1', design_t_min_c: -5, design_t_amb_max_c: 35 }],
    'solar.roof_sources': [{ id: 'rs1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, m_per_px: null, north_bearing_deg: 0, attribution: null }],
    'tenants.floor_plans': [{ id: 'fp1', name: 'Roof', pixels_per_meter: 50 }],
    'tenants.floor_plan_page_scales': [],
    'solar.layout_objects': [],
    'projects.projects': [{ id: P, name: '(P1) Mall' }],
  } })
  h.createClient.mockResolvedValue(session.client)
  const service = fakeSupabase({ tables: { 'projects.reports': [] }, writes: { 'projects.reports:insert': { data: [{ id: 'rep1' }] } } })
  h.createServiceClient.mockReturnValue({ ...service.client, storage: { from: () => ({ upload: h.upload, remove: h.remove }) } })
  ;(globalThis as { __svcCalls?: unknown }).__svcCalls = service.calls
})

describe('exportLayoutSheetAction', () => {
  it('re-checks Edit, renders, stores v1 under org/project and inserts kind solar_layout_sheet', async () => {
    const res = await exportLayoutSheetAction({ projectId: P, layoutId: L, jpegBase64: JPEG_1PX, crop: { x: 0, y: 0, w: 1, h: 1 } })
    expect(res).toEqual({ ok: true, version: 1, reportId: 'rep1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect((h.upload.mock.calls[0] as unknown[])[0]).toBe(`o1/${P}/solar-layout-sheets/${L}-v1.pdf`)
    const calls = (globalThis as { __svcCalls?: Parameters<typeof callsTo>[0] }).__svcCalls!
    expect(callsTo(calls, 'projects.reports', 'insert')[0]!.payload).toMatchObject({
      kind: 'solar_layout_sheet', source_table: 'solar.layouts', source_id: L, version: 1, status: 'issued', organisation_id: 'o1', project_id: P,
    })
  })
  it('refuses a malformed image', async () => {
    await expect(exportLayoutSheetAction({ projectId: P, layoutId: L, jpegBase64: 'x', crop: { x: 0, y: 0, w: 1, h: 1 } }))
      .resolves.toEqual({ error: 'The sheet image could not be read — try again.' })
  })
})
