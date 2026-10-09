import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { resolveShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import type { CanvasShape, PlanNode } from '@/lib/status-plans/types'
import { ShapePanel, type ShapePanelProps } from './ShapePanel'

const NODE: PlanNode = { id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 70, decommissioned: false }
const OTHER: PlanNode = { ...NODE, id: 'n2', code: 'DB-ZZ02', shopNumber: 'ZZ02', shopName: 'Copper Kettle' }
const SHAPE: CanvasShape = { id: 's1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: 'n1', areaType: null, detectedTag: null, source: 'manual', updatedAt: 't' }
const OPEN = { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: 'ordered', lights: null, boDate: '2026-05-01' } } as const

function props(o: Partial<ShapePanelProps> = {}): ShapePanelProps {
  const view = resolveShapeView(SHAPE, {
    purpose: 'tenant_layout', nodesById: new Map([['n1', NODE]]), shopLinks: { n1: OPEN }, dbOrders: {}, today: '2026-06-20', pixelsPerMeter: 20,
  })
  return {
    purpose: 'tenant_layout', shape: SHAPE, view, node: NODE, link: OPEN,
    options: buildNodeOptions([NODE, OTHER], [SHAPE], 's1', 'tenant_layout'),
    canEdit: true, busy: false, deleteArmed: false, hasScale: true,
    onAssignNode: vi.fn(), onSetAreaType: vi.fn(), onUnassign: vi.fn(), onDelete: vi.fn(),
    ...o,
  }
}

describe('ShapePanel', () => {
  it('shows the shop, its status facts and the area check', () => {
    render(<ShapePanel {...props()} />)
    expect(screen.getByRole('heading', { name: /ZZ01/ })).toBeTruthy()
    expect(screen.getByText('In progress · overdue')).toBeTruthy()
    expect(screen.getByText('Awaited')).toBeTruthy()          // scope
    expect(screen.getByText('Ordered')).toBeTruthy()          // DB order
    expect(screen.getByText('No order yet')).toBeTruthy()     // lights
    expect(screen.getByText('80.0 m²')).toBeTruthy()
    expect(screen.getByText(/differs from the schedule by \+10\.0 m² \(\+14\.3 %\)/)).toBeTruthy()
  })

  it('assigns from the searchable list', () => {
    const onAssignNode = vi.fn()
    render(<ShapePanel {...props({ onAssignNode })} />)
    fireEvent.change(screen.getByLabelText(/find a shop/i), { target: { value: 'kettle' } })
    fireEvent.click(screen.getByRole('button', { name: /ZZ02 — Copper Kettle/ }))
    expect(onAssignNode).toHaveBeenCalledWith('n2')
  })

  it('a board used by another shape is listed but disabled with the reason', () => {
    const p = props({ options: buildNodeOptions([NODE, OTHER], [SHAPE, { ...SHAPE, id: 's2', nodeId: 'n2' }], 's1', 'tenant_layout') })
    render(<ShapePanel {...p} />)
    const btn = screen.getByRole('button', { name: /ZZ02 — Copper Kettle/ })
    expect(btn).toHaveProperty('disabled', true)
    expect(screen.getByText(/Already on this plan/)).toBeTruthy()
  })

  it('area types are offered on a tenant layout', () => {
    const onSetAreaType = vi.fn()
    render(<ShapePanel {...props({ onSetAreaType })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Plant / electrical room' }))
    expect(onSetAreaType).toHaveBeenCalledWith('plant_room')
  })

  it('delete reads as a two-step confirm', () => {
    const { rerender } = render(<ShapePanel {...props()} />)
    expect(screen.getByRole('button', { name: 'Delete shape' })).toBeTruthy()
    rerender(<ShapePanel {...props({ deleteArmed: true })} />)
    expect(screen.getByRole('button', { name: 'Press again to delete' })).toBeTruthy()
  })

  it('read-only: facts, no controls', () => {
    render(<ShapePanel {...props({ canEdit: false })} />)
    expect(screen.queryByLabelText(/find a shop/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete shape' })).toBeNull()
  })

  it('renders the extra slot (slice 3 seam) with or without a selection', () => {
    render(<ShapePanel {...props({ shape: null, view: null, node: null, link: null, extra: <p>detect here</p> })} />)
    expect(screen.getByText('detect here')).toBeTruthy()
  })
})
