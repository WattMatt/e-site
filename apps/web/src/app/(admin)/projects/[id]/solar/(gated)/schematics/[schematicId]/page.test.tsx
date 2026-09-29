import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(async () => ({})),
  requireSolarLevel: vi.fn(),
  loadSchematicEditor: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  props: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/schematics/load', () => ({ loadSchematicEditor: h.loadSchematicEditor }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('./_components/SchematicWorkspace', () => ({ SchematicWorkspace: (p: Record<string, unknown>) => { h.props = p; return null } }))

import { render } from '@testing-library/react'
import SchematicEditorPage from './page'

const view = {
  schematic: { id: 'sc1', name: 'Main', description: null, kind: 'drawing', pageIndex: 2, updatedAt: 'U0', canvasW: 2400, canvasH: 1600, anchorChanged: true, floorPlanId: 'fp1' },
  sheet: { planId: 'fp1', name: 'SLD', signedUrl: 'https://x/y.pdf', isPdf: true, widthPx: null, heightPx: null },
  doc: { cards: [{ meterId: 'A', x: 1.5, y: -2, w: 180, h: 64, colour: null }], lines: [{ key: 'A>B:supply', fromMeterId: 'A', toMeterId: 'B', waypoints: [10, 20], lineType: 'supply' }] },
  meters: [{ id: 'A', label: 'Bulk', kind: 'bulk', tenantLabel: null, nodeId: null, included: null }],
  externalLines: [{ fromMeterId: 'X', toMeterId: 'A', lineType: 'supply' }],
  drawings: [{ id: 'fp1', name: 'SLD', isPdf: true }],
}
const params = Promise.resolve({ id: 'p1', schematicId: 'sc1' })
beforeEach(() => { vi.clearAllMocks(); h.props = null; h.loadSchematicEditor.mockResolvedValue(view) })

describe('Schematic editor page', () => {
  it('gates on Solar View; every client prop is JSON (no function crosses the boundary)', async () => {
    h.requireSolarLevel.mockResolvedValue('edit')
    render(await SchematicEditorPage({ params }))
    expect(h.requireSolarLevel).toHaveBeenCalledWith('p1', 'view', expect.anything())
    expect(h.loadSchematicEditor).toHaveBeenCalledWith(expect.anything(), 'p1', 'sc1')
    expect(h.props).toMatchObject({ projectId: 'p1', canEdit: true, view })
    expect(JSON.parse(JSON.stringify(h.props))).toEqual(h.props)
  })
  it('View level gets canEdit false', async () => {
    h.requireSolarLevel.mockResolvedValue('view')
    render(await SchematicEditorPage({ params }))
    expect(h.props!.canEdit).toBe(false)
  })
  it('a schematic of another project (or none) is a 404', async () => {
    h.requireSolarLevel.mockResolvedValue('edit')
    h.loadSchematicEditor.mockResolvedValue(null)
    await expect(SchematicEditorPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
