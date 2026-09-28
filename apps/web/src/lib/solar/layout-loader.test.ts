import { describe, it, expect, vi } from 'vitest'
import { loadRoofSources, loadLayoutEditor, scaleForSource } from './layout-loader'
import { fakeSupabase } from '@/test/fake-supabase'
import { GENERIC_MODULE_550 } from '@esite/shared'

const P = 'p1'
const tables = {
  'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', latitude: -26.2, longitude: 28.05 }],
  'solar.roof_sources': [
    { id: 'rs1', project_id: P, study_id: 's1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, file_path: 'a/v1.pdf', north_bearing_deg: 10, storage_path: null, m_per_px: null, attribution: null, updated_at: 'T1' },
    { id: 'rs2', project_id: P, study_id: 's1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 2, file_path: 'a/v1.pdf', north_bearing_deg: null, storage_path: null, m_per_px: null, attribution: null, updated_at: 'T1' },
    { id: 'rs3', project_id: P, study_id: 's1', kind: 'satellite', floor_plan_id: null, page_index: 1, file_path: null, north_bearing_deg: 0, storage_path: 'o1/p1/sat.png', m_per_px: 0.05, attribution: '© Mapbox', updated_at: 'T1' },
  ],
  'tenants.floor_plans': [{ id: 'fp1', name: 'Roof', file_path: 'a/v2.pdf', pixels_per_meter: 50 }],
  'tenants.floor_plan_page_scales': [],
  'solar.layouts': [{ id: 'L1', project_id: P, name: 'A', roof_source_id: 'rs1', module_spec: GENERIC_MODULE_550, default_tilt_deg: 10, design_t_min_c: -5, design_t_amb_max_c: 35, summary: { dcKwp: 1.1 }, updated_at: 'T2' }],
  'solar.layout_objects': [{ id: 'o1', layout_id: 'L1', kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'I' }, pixels_per_meter: 50 }],
  'structure.nodes': [{ id: 'n1', project_id: P, code: 'MB1', name: 'Main', status: 'active' }],
  'solar.org_settings': [{ organisation_id: 'o1', settings: { version: 1, values: { edge_setback_flat_m: 0.6 } } }],
}

describe('scaleForSource', () => {
  it('page 1 uses the drawing scale, page 2 needs its own, satellite is 1 / m per px', () => {
    expect(scaleForSource({ kind: 'drawing', page_index: 1, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map())).toBe(50)
    expect(scaleForSource({ kind: 'drawing', page_index: 2, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map())).toBeNull()
    expect(scaleForSource({ kind: 'drawing', page_index: 2, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map([['fp1#2', 25]]))).toBe(25)
    expect(scaleForSource({ kind: 'satellite', page_index: 1, floor_plan_id: null, m_per_px: 0.05 }, new Map(), new Map())).toBe(20)
  })
})

describe('loadRoofSources', () => {
  it('labels, scale, north and the drawing-changed flag', async () => {
    const { client } = fakeSupabase({ tables })
    const r = await loadRoofSources(client as never, P)
    expect(r.studyId).toBe('s1')
    expect(r.sources.map((s) => [s.id, s.label, s.pixelsPerMeter, s.northSet, s.drawingChanged])).toEqual([
      ['rs1', 'Roof · page 1', 50, true, true],
      ['rs2', 'Roof · page 2', null, false, true],
      ['rs3', 'Satellite capture', 20, true, false],
    ])
  })
})

describe('loadLayoutEditor', () => {
  it('returns JSON the client can take, with a signed sheet URL and org defaults', async () => {
    const { client } = fakeSupabase({ tables })
    const sign = vi.fn(async (bucket: string, path: string) => `https://signed/${bucket}/${path}`)
    const d = await loadLayoutEditor(client as never, client as never, P, 'L1', sign)
    expect(d).not.toBeNull()
    expect(d!.source.sheet).toEqual({ key: 'rs1', signedUrl: 'https://signed/drawings/a/v2.pdf', isPdf: true, pageIndex: 1 })
    expect(d!.sheetPixelsPerMeter).toBe(50)
    expect(d!.drawingChanged).toBe(true)
    expect(d!.objects).toEqual([{ id: 'o1', kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'I' }, pixelsPerMeter: 50 }])
    expect(d!.setbackDefaults.flatM).toBe(0.6)
    expect(d!.shadeFree).toEqual({ fromHour: 9, toHour: 15 })
    expect(d!.nodes).toEqual([{ id: 'n1', label: 'MB1 — Main' }])
    expect(JSON.parse(JSON.stringify(d))).toEqual(d) // nothing a client component cannot receive
  })
  it('null for a layout of another project', async () => {
    const { client } = fakeSupabase({ tables })
    expect(await loadLayoutEditor(client as never, client as never, 'other', 'L1', vi.fn())).toBeNull()
  })
})
