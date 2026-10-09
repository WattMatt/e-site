import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { StatusPlanPageProps, CanvasShape } from '@/lib/status-plans/types'

// No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent
const canvasText = () => screen.getByTestId('canvas').textContent ?? ''

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }))
vi.mock('next/dynamic', () => ({
  default: () => (props: { shapes: CanvasShape[]; selectedId: string | null; onSelect: (id: string | null) => void; onCreate: (c: unknown) => void; onDeleteRequest: () => void; requestedTool: { tool: string } | null }) => (
    <div data-testid="canvas">
      shapes:{props.shapes.length} selected:{props.selectedId ?? 'none'} tool:{props.requestedTool?.tool ?? 'none'}
      <button onClick={() => props.onSelect('s1')}>stub-select-s1</button>
      <button onClick={() => props.onCreate({ shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })}>stub-create</button>
      <button onClick={() => props.onDeleteRequest()}>stub-delete-key</button>
    </div>
  ),
}))
const actions = vi.hoisted(() => ({
  createStatusPlanShapeAction: vi.fn(),
  updateStatusPlanShapeAction: vi.fn(),
  deleteStatusPlanShapeAction: vi.fn(),
  renameStatusPlanAction: vi.fn(),
  deleteStatusPlanAction: vi.fn(),
  reanchorStatusPlanAction: vi.fn(),
}))
vi.mock('@/actions/status-plan.actions', () => actions)

import { StatusPlanWorkspace } from './StatusPlanWorkspace'

const SHAPE: CanvasShape = { id: 's1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: null, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't1' }

function props(o: Partial<StatusPlanPageProps> = {}): StatusPlanPageProps {
  return {
    projectId: 'p1',
    plan: { id: 'pl1', name: 'Ground floor', purpose: 'tenant_layout', pageIndex: 1, sourceFilePath: 'x/E-100.pdf', updatedAt: 't0' },
    sheet: { floorPlanId: 'fp1', name: 'E-100', signedUrl: 'https://s/x', isPdf: true, widthPx: null, heightPx: null, currentFilePath: 'x/E-100.pdf', pixels_per_meter: 20, page_scales: [] },
    shapes: [SHAPE],
    nodes: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }],
    shopLinks: { n1: { state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } } },
    dbOrders: {},
    today: '2026-06-20',
    canEdit: true,
    initialShapeId: null,
    ...o,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('StatusPlanWorkspace', () => {
  it('shows the legend counts from live facts', () => {
    render(<StatusPlanWorkspace {...props()} />)
    expect(legendRow('Unassigned')).toBe('Unassigned1')
    expect(legendRow('Complete')).toBe('Complete0')
  })

  it('assigning a shop folds the stored shape into state, with no refresh', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, nodeId: 'n1', updatedAt: 't2' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    await waitFor(() => expect(legendRow('Complete')).toBe('Complete1'))
    expect(actions.updateStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1', nodeId: 'n1' })
    expect(refresh).not.toHaveBeenCalled()
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
    expect(actions.deleteStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1' })
  })

  it('a created shape is added and selected', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's2' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create')) })
    expect(canvasText()).toMatch(/shapes:2\s+selected:s2/)
  })

  it('warns when the drawing file changed since the plan was drawn, and re-anchors on request', async () => {
    actions.reanchorStatusPlanAction.mockResolvedValue({ ok: true, data: { sourceFilePath: 'x/E-100 rev C.pdf' } })
    render(<StatusPlanWorkspace {...props({ sheet: { ...props().sheet, currentFilePath: 'x/E-100 rev C.pdf' } })} />)
    expect(screen.getByText(/E-100\.pdf/)).toBeTruthy()
    expect(screen.getByText(/E-100 rev C\.pdf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /shapes checked/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /shapes checked/i })).toBeNull())
  })

  it('no scale: banner, and "Set scale" asks the canvas for the calibrate tool', () => {
    render(<StatusPlanWorkspace {...props({ sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.getByText(/Calibrate this page on the drawing to measure areas/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set scale' }))
    expect(canvasText()).toContain('tool:calibrate')
  })

  it('a schematic plan shows the detection seam and no scale banner', () => {
    render(<StatusPlanWorkspace {...props({ plan: { ...props().plan, purpose: 'distribution_schematic' }, shopLinks: {}, sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.getByText(/Automatic block detection is not available yet/)).toBeTruthy()
    expect(screen.queryByText(/Calibrate this page/)).toBeNull()
  })

  it('read-only: no rename, no delete plan, no Set scale', () => {
    render(<StatusPlanWorkspace {...props({ canEdit: false, sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete plan/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
  })

  it('selection is mirrored to ?shape= without a navigation', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    // history.state may be null in jsdom, so only the URL argument is asserted.
    expect(spy.mock.calls.at(-1)?.[2]).toBe('/projects/p1/status-plans/pl1?shape=s1')
    expect(push).not.toHaveBeenCalled()
  })
})
