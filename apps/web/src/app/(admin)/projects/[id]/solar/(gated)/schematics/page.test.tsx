import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(async () => ({})),
  requireSolarLevel: vi.fn(),
  loadSchematicsList: vi.fn(),
  props: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/schematics/load', () => ({ loadSchematicsList: h.loadSchematicsList }))
vi.mock('./_components/SchematicsList', () => ({ SchematicsList: (p: Record<string, unknown>) => { h.props = p; return null } }))

import { render } from '@testing-library/react'
import SolarSchematicsPage from './page'

const view = {
  studyId: 's1', studyUpdatedAt: 'T0', waived: false, studyMeterCount: 2,
  schematics: [{ id: 'sc1', name: 'Main', description: null, kind: 'drawing', drawingName: 'SLD', pageIndex: 1, placed: 1, updatedAt: 'U1' }],
  drawings: [{ id: 'fp1', name: 'SLD', isPdf: true }],
}
beforeEach(() => { vi.clearAllMocks(); h.props = null; h.loadSchematicsList.mockResolvedValue(view) })

describe('Solar Schematics list page', () => {
  it('gates on Solar View; every client prop is JSON (no function crosses the boundary)', async () => {
    h.requireSolarLevel.mockResolvedValue('edit')
    render(await SolarSchematicsPage({ params: Promise.resolve({ id: 'p1' }) }))
    expect(h.requireSolarLevel).toHaveBeenCalledWith('p1', 'view', expect.anything())
    expect(h.props).toMatchObject({ projectId: 'p1', canEdit: true, view })
    expect(JSON.parse(JSON.stringify(h.props))).toEqual(h.props)
  })
  it('View level gets canEdit false', async () => {
    h.requireSolarLevel.mockResolvedValue('view')
    render(await SolarSchematicsPage({ params: Promise.resolve({ id: 'p1' }) }))
    expect(h.props!.canEdit).toBe(false)
  })
})
