/**
 * The measure workspace's job, tested without Konva: show the worklist,
 * open a run on the sheet its last leg was traced on, and address that view
 * in the URL. The canvas itself is stubbed — its props are what matter here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ActiveSheet, PlanRow, RunRow } from './types'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/cables/r1/measure',
}))
vi.mock('next/dynamic', () => ({
  default: () => (props: { sheet: ActiveSheet; run: { label: string; savedLegs: unknown[] }; initialPage: number }) => (
    <div data-testid="route-canvas">
      canvas:{props.run.label}:{props.sheet.name}:page{props.initialPage}:legs{props.run.savedLegs.length}
    </div>
  ),
}))
vi.mock('@/components/cable-route/AssignRoutePanel', () => ({
  AssignRoutePanel: (p: { supplyId: string }) => <div data-testid="assign-panel">assign:{p.supplyId}</div>,
}))
vi.mock('@/actions/cable-route.actions', () => ({
  saveSupplyRouteAction: vi.fn(),
  exportRouteSheetAction: vi.fn(),
  listRouteHistoryAction: vi.fn(),
  restoreRouteHistoryAction: vi.fn(),
  remeasureRouteLegsAction: vi.fn(),
  deleteSupplyRouteAction: vi.fn(),
}))

import { RouteMeasureWorkspace } from './RouteMeasureWorkspace'

const plans: PlanRow[] = [
  { id: 'plan-a', name: 'E-100 Ground', isPdf: true, renderable: true, filePath: 'a.pdf', pixelsPerMeter: 20 },
  { id: 'plan-b', name: 'E-101 First', isPdf: true, renderable: true, filePath: 'b.pdf', pixelsPerMeter: null },
]
const sheetA: ActiveSheet = {
  id: 'plan-a', name: 'E-100 Ground', signedUrl: 'https://x/a.pdf', isPdf: true, width_px: null, height_px: null,
  pixels_per_meter: 20, calibration_points: null, calibration_metres: null, calibration_page_index: null, page_scales: [],
}
const untraced: RunRow = { supplyId: 's-1', fromCode: 'MB 1.1', toCode: 'DB-07', voltageV: 400, section: null, strands: 1, scheduleLengthM: null, route: null }
const traced: RunRow = {
  supplyId: 's-2', fromCode: 'MB 2.1', toCode: 'DB-12', voltageV: 400, section: null, strands: 2, scheduleLengthM: 41.2,
  route: {
    riseM: 1, dropM: 1, tracedM: 39.2, totalM: 41.2, updatedAt: '2026-09-21T10:00:00Z',
    segments: [
      { id: 'g1', seq: 1, floorPlanId: 'plan-a', floorPlanName: 'E-100 Ground', pageIndex: 1, points: [0, 0, 10, 0], pixelsPerMeter: 20, lengthM: 20 },
      { id: 'g2', seq: 2, floorPlanId: 'plan-b', floorPlanName: 'E-101 First', pageIndex: 3, points: [0, 0, 10, 0], pixelsPerMeter: 20, lengthM: 19.2 },
    ],
  },
}

beforeEach(() => replace.mockClear())

describe('RouteMeasureWorkspace', () => {
  it('shows the outstanding list and no canvas until a run is picked', () => {
    render(<RouteMeasureWorkspace revisionId="r1" runs={[untraced, traced]} plans={plans} activeSheet={sheetA} initialPage={1} otherLegsOnSheet={[]} />)
    expect(screen.getByRole('button', { name: /outstanding \(1\)/ })).toBeTruthy()
    expect(screen.getByText('MB 1.1 → DB-07')).toBeTruthy()
    // The traced run is filtered out of "outstanding".
    expect(screen.queryByText('MB 2.1 → DB-12')).toBeNull()
    expect(screen.queryByTestId('route-canvas')).toBeNull()
    expect(screen.getByText(/Pick a run from the list/)).toBeTruthy()
  })

  it('opens a picked run on the current sheet and writes the address to the URL', () => {
    render(<RouteMeasureWorkspace revisionId="r1" runs={[untraced, traced]} plans={plans} activeSheet={sheetA} initialPage={1} otherLegsOnSheet={[]} />)
    fireEvent.click(screen.getByText('MB 1.1 → DB-07'))
    expect(replace).toHaveBeenCalledWith('/projects/p1/cables/r1/measure?supply=s-1&sheet=plan-a', { scroll: false })
    expect(screen.getByTestId('route-canvas').textContent).toBe('canvas:MB 1.1 → DB-07:E-100 Ground:page1:legs0')
    expect(screen.getByTestId('assign-panel').textContent).toBe('assign:s-1')
    expect(screen.getByText(/Nothing traced yet/)).toBeTruthy()
  })

  it('a deep-linked traced run is visible (filter widened) and continues on its LAST sheet and page', () => {
    render(<RouteMeasureWorkspace revisionId="r1" runs={[untraced, traced]} plans={plans} initialSupplyId="s-2" activeSheet={sheetA} initialPage={1} otherLegsOnSheet={[]} />)
    // Widened to "all": both runs listed, the traced one current.
    expect(screen.getByText('MB 2.1 → DB-12').closest('button')?.getAttribute('aria-current')).toBe('true')
    expect(screen.getByText('MB 1.1 → DB-07')).toBeTruthy()
    // The rail lists both legs; the leg on another sheet offers to open it.
    expect(screen.getByText(/2\. E-101 First/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /open · page 3/ }))
    expect(replace).toHaveBeenCalledWith('/projects/p1/cables/r1/measure?supply=s-2&sheet=plan-b&page=3', { scroll: false })
    // Re-picking the run itself goes to its last sheet, not the one open.
    fireEvent.click(screen.getByText('MB 2.1 → DB-12'))
    expect(replace).toHaveBeenLastCalledWith('/projects/p1/cables/r1/measure?supply=s-2&sheet=plan-b&page=3', { scroll: false })
  })

  it('refuses to trace when the project has no drawings, but still lists the runs', () => {
    render(<RouteMeasureWorkspace revisionId="r1" runs={[untraced]} plans={[]} initialSupplyId="s-1" activeSheet={null} initialPage={1} otherLegsOnSheet={[]} />)
    expect(screen.getByText(/no drawings loaded/)).toBeTruthy()
    expect(screen.queryByTestId('route-canvas')).toBeNull()
  })
})
