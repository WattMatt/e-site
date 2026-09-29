import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadSchematicEditor, loadSchematicsList } from './load'

const P = 'p1'
const tables = {
  'solar.studies': [{ id: 's1', project_id: P, schematic_waived: false, updated_at: 'T0' }],
  'solar.schematics': [
    { id: 'sc1', study_id: 's1', project_id: P, name: 'Main', description: null, kind: 'drawing', floor_plan_id: 'fp1', page_index: 2, file_path: 'o/p/sld-v1.pdf', canvas_w: 2400, canvas_h: 1600, updated_at: 'U1' },
    { id: 'sc2', study_id: 's1', project_id: P, name: 'Blank', description: null, kind: 'blank', floor_plan_id: null, page_index: 1, file_path: null, canvas_w: 2400, canvas_h: 1600, updated_at: 'U2' },
  ],
  'solar.schematic_cards': [
    { schematic_id: 'sc1', meter_id: 'm1', x: 1, y: 2, w: 180, h: 64, colour: null },
    { schematic_id: 'sc1', meter_id: 'm2', x: 300, y: 2, w: 180, h: 64, colour: '#dc2626' },
  ],
  'solar.schematic_lines': [
    { id: 'l1', schematic_id: 'sc1', project_id: P, from_meter_id: 'm1', to_meter_id: 'm2', waypoints: [10, 20], line_type: 'supply' },
    { id: 'l2', schematic_id: 'sc2', project_id: P, from_meter_id: 'm2', to_meter_id: 'm3', waypoints: [], line_type: 'supply' },
  ],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }, { study_id: 's1', meter_id: 'm3' }],
  'solar.meters': [
    { id: 'm1', label: 'Bulk', kind: 'bulk', node_id: null },
    { id: 'm2', label: 'Pep', kind: 'tenant', node_id: 'n1' },
    { id: 'm3', label: 'KFC', kind: 'tenant', node_id: 'n2' },
  ],
  'solar.tenant_load_basis': [{ study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm2', weight: 1 }] }, { study_id: 's1', node_id: 'n2', source: 'excluded', meters: [] }],
  'structure.nodes': [{ id: 'n1', project_id: P, shop_number: '12', shop_name: 'Pep', name: null, code: 'T1' }, { id: 'n2', project_id: P, shop_number: '13', shop_name: 'KFC', name: null, code: 'T2' }],
  'tenants.floor_plans': [{ id: 'fp1', project_id: P, name: 'SLD', file_path: 'o/p/sld-v2.pdf', is_active: true, width_px: null, height_px: null }],
}
const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed' } }) }) }
const client = () => Object.assign(fakeSupabase({ tables }).client, { storage }) as never

describe('schematic loaders', () => {
  it('list: rows with drawing names and placed counts; drawings for the add dialog', async () => {
    const v = await loadSchematicsList(client(), P)
    expect(v.schematics.map((s) => [s.name, s.drawingName, s.pageIndex, s.placed])).toEqual([['Blank', null, 1, 0], ['Main', 'SLD', 2, 2]])
    expect(v.studyMeterCount).toBe(3)
    expect(v.drawings).toEqual([{ id: 'fp1', name: 'SLD', isPdf: true }])
  })
  it('editor: doc, include states, other schematics’ lines, and the anchor-changed warning', async () => {
    const v = await loadSchematicEditor(client(), P, 'sc1')
    if (!v) throw new Error('expected a view')
    expect(v.schematic.anchorChanged).toBe(true)
    expect(v.sheet).toMatchObject({ planId: 'fp1', signedUrl: 'https://signed', isPdf: true })
    expect(v.doc.lines).toEqual([{ key: 'm1>m2:supply', fromMeterId: 'm1', toMeterId: 'm2', waypoints: [10, 20], lineType: 'supply' }])
    expect(v.externalLines).toEqual([{ fromMeterId: 'm2', toMeterId: 'm3', lineType: 'supply' }])
    expect(v.meters.find((m) => m.id === 'm2')).toMatchObject({ included: true, tenantLabel: '12 · Pep' })
    expect(v.meters.find((m) => m.id === 'm3')?.included).toBe(false)
    expect(v.meters.find((m) => m.id === 'm1')?.included).toBeNull()
  })
  it('editor: a schematic of another project is null', async () => {
    expect(await loadSchematicEditor(client(), 'other', 'sc1')).toBeNull()
  })
})
