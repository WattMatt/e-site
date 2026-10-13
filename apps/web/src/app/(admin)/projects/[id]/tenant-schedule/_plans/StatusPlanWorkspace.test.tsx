import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { StatusPlanPageProps, CanvasShape, SheetSummary } from '@/lib/status-plans/types'

// No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent
const canvasText = () => screen.getByTestId('canvas').textContent ?? ''

const SHEET: SheetSummary = {
  id: 'sh1', label: 'Ground floor', sortOrder: 0, fileName: 'E-100.pdf', mime: 'application/pdf', pageIndex: 1, revision: 1,
  replacedAt: null, pixelsPerMeter: 20, updatedAt: 'u0',
}
const SHEET2: SheetSummary = { ...SHEET, id: 'sh2', label: 'Level 1', sortOrder: 1, pageIndex: 2 }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))
vi.mock('next/dynamic', () => ({
  default: () => (props: { shapes: CanvasShape[]; selectedId: string | null; pageIndex: number; onSelect: (id: string | null) => void; onCreate: (c: unknown) => void; onDeleteRequest: () => void; onCalibrated: (s: SheetSummary) => void; requestedTool: { tool: string } | null }) => (
    <div data-testid="canvas">
      shapes:{props.shapes.length} selected:{props.selectedId ?? 'none'} tool:{props.requestedTool?.tool ?? 'none'} page:{props.pageIndex}
      <button onClick={() => props.onSelect('s1')}>stub-select-s1</button>
      <button onClick={() => props.onCreate({ shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })}>stub-create</button>
      <button onClick={() => props.onDeleteRequest()}>stub-delete-key</button>
      <button onClick={() => props.onCalibrated({ ...SHEET, pixelsPerMeter: 25, updatedAt: 'u2' })}>stub-calibrated</button>
    </div>
  ),
}))
const actions = vi.hoisted(() => ({
  createStatusPlanShapeAction: vi.fn(),
  updateStatusPlanShapeAction: vi.fn(),
  deleteStatusPlanShapeAction: vi.fn(),
}))
vi.mock('@/actions/status-plan.actions', () => actions)
const sheetActions = vi.hoisted(() => ({
  reanchorTenantPlanSheetAction: vi.fn(),
  renameTenantPlanSheetAction: vi.fn(),
  deleteTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanSheetReplaceAction: vi.fn(),
  replaceTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanUploadAction: vi.fn(),
  registerTenantPlanSheetsAction: vi.fn(),
}))
vi.mock('@/actions/tenant-plan-sheets.actions', () => sheetActions)
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }) }))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: vi.fn() }))
const detection = vi.hoisted(() => ({ extractPageText: vi.fn(), acceptDetectedBlocksAction: vi.fn() }))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: detection.extractPageText }))
vi.mock('@/actions/status-plan-detection.actions', () => ({ acceptDetectedBlocksAction: detection.acceptDetectedBlocksAction }))

import { StatusPlanWorkspace } from './StatusPlanWorkspace'

const SHAPE: CanvasShape = { id: 's1', sheetId: 'sh1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: null, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't1' }

function props(o: Partial<StatusPlanPageProps> = {}): StatusPlanPageProps {
  return {
    projectId: 'p1',
    plan: { id: 'pl1', name: 'Floor plan', purpose: 'tenant_layout', updatedAt: 't0' },
    sheets: [SHEET],
    sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true },
    shapes: [SHAPE],
    nodes: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }],
    shopLinks: { n1: { state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } } },
    dbOrders: {},
    today: '2026-06-20',
    canEdit: true,
    initialShapeId: null,
    feed: null,
    initialColourBy: 'status',
    ...o,
  }
}
const schematic = (o: Partial<StatusPlanPageProps> = {}) =>
  props({ plan: { ...props().plan, purpose: 'distribution_schematic', name: 'Line diagram' }, shopLinks: {}, ...o })

beforeEach(() => vi.clearAllMocks())

describe('StatusPlanWorkspace', () => {
  it('shows the legend counts from live facts', () => {
    render(<StatusPlanWorkspace {...props()} />)
    expect(legendRow('Unassigned')).toBe('Unassigned1')
    expect(legendRow('Complete')).toBe('Complete0')
  })

  it('assigning a shop folds the stored shape into state', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, nodeId: 'n1', updatedAt: 't2' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    await waitFor(() => expect(legendRow('Complete')).toBe('Complete1'))
    expect(actions.updateStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1', nodeId: 'n1' })
  })

  it('a conflict shows the sentence and a Reload button', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('deleting a shape takes two presses (Delete key arms, panel confirms)', async () => {
    actions.deleteStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { id: 's1' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByText('stub-delete-key'))
    expect(actions.deleteStatusPlanShapeAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Press again to delete' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:0'))
  })

  it('a new shape is created on the current sheet, added and selected', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's2' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create')) })
    expect(actions.createStatusPlanShapeAction).toHaveBeenCalledWith({ sheetId: 'sh1', shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })
    expect(canvasText()).toMatch(/shapes:2\s+selected:s2/)
  })

  it('the canvas shows this sheet only; the legend shows this sheet and all sheets', () => {
    render(<StatusPlanWorkspace {...props({
      sheets: [SHEET, SHEET2],
      shapes: [SHAPE, { ...SHAPE, id: 's2', sheetId: 'sh2', nodeId: 'n1' }],
    })} />)
    expect(canvasText()).toContain('shapes:1')
    expect(legendRow('Complete')).toBe('Complete01')
    expect(legendRow('Unassigned')).toBe('Unassigned11')
    expect(screen.getByRole('navigation', { name: 'Sheets' })).toBeTruthy()
  })

  it('a replaced sheet warns, and "Shapes checked" re-anchors it in place', async () => {
    sheetActions.reanchorTenantPlanSheetAction.mockResolvedValue({ ok: true, data: { ...SHEET, revision: 2, replacedAt: null, updatedAt: 'u1' } })
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, revision: 2, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Shapes checked/ }))
    await waitFor(() => expect(screen.queryByText(/file was replaced/)).toBeNull())
    expect(sheetActions.reanchorTenantPlanSheetAction).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0' })
  })

  it('no scale: banner, "Set scale" asks the canvas for the calibrate tool, and a saved scale clears it', () => {
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true }, sheets: [{ ...SHEET, pixelsPerMeter: null }] })} />)
    expect(screen.getByText(/Set this sheet.s scale to measure areas\. Until then/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set scale' }))
    expect(canvasText()).toContain('tool:calibrate')
    fireEvent.click(screen.getByText('stub-calibrated'))
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
  })

  it('a line diagram offers Detect blocks and no scale banner; a floor plan does not', () => {
    const { unmount } = render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByRole('button', { name: 'Detect blocks' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
    unmount()
    render(<StatusPlanWorkspace {...props()} />)
    expect(screen.queryByRole('button', { name: 'Detect blocks' })).toBeNull()
  })

  it('detection reads the sheet\'s own page and accepted blocks fold into the canvas', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 2000, height: 2000 })
    detection.acceptDetectedBlocksAction.mockResolvedValue({
      ok: true,
      data: [{ id: 's9', sheetId: 'sh1', shape: 'rect', points: [495, 485, 585, 485, 585, 601, 495, 601], nodeId: 'n1', areaType: null, detectedTag: 'DB-ZZ01', source: 'detected', updatedAt: 't9' }],
    })
    render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pageIndex: 2, signedUrl: 'https://s/x', isPdf: true } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept 1 matched' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:2'))
    expect(detection.extractPageText).toHaveBeenCalledWith({ url: 'https://s/x' }, 2)
    expect(detection.acceptDetectedBlocksAction.mock.calls[0][0].sheetId).toBe('sh1')
  })

  it('read-only: no sheet controls, no Add sheets, no Set scale, no re-anchor', () => {
    render(<StatusPlanWorkspace {...props({ canEdit: false, sheet: { ...SHEET, pixelsPerMeter: null, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    for (const name of ['Rename', 'Replace file', 'Delete sheet', 'Add sheets', 'Set scale']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /Shapes checked/ })).toBeNull()
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
  })

  it('selection is mirrored to ?sheet=&shape= without a navigation', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    expect(spy.mock.calls.at(-1)?.[2]).toBe('/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=s1')
  })
})
