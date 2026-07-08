// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { upsertMock, deleteMock, quickAddMock, headerMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  deleteMock: vi.fn(),
  quickAddMock: vi.fn(),
  headerMock: vi.fn(),
}))

vi.mock('@/actions/db-legend.actions', () => ({
  upsertCircuitAction: upsertMock,
  deleteCircuitAction: deleteMock,
  quickAddWaysAction: quickAddMock,
  updateLegendHeaderAction: headerMock,
}))

import { DbLegendPanel } from './DbLegendPanel'
import type { LegendCircuit } from '@esite/shared'

const circuits: LegendCircuit[] = [
  { id: 'c1', node_id: 'n1', circuit_no: '1', description: 'Lights shop 5', phase: 'L1', breaker_rating_a: 20, poles: 1, curve: 'C', cable_size: '2.5mm²', is_spare: false, sort_order: 1 },
  { id: 'c2', node_id: 'n1', circuit_no: '2', description: null, phase: null, breaker_rating_a: null, poles: null, curve: null, cable_size: null, is_spare: true, sort_order: 2 },
]

function renderPanel(overrides: Partial<Parameters<typeof DbLegendPanel>[0]> = {}) {
  return render(
    <DbLegendPanel
      projectId="11111111-1111-1111-1111-111111111111"
      nodeId="n1"
      shopName="Test Tenant"
      mainBreaker="63 A TP"
      header={null}
      circuits={circuits}
      readOnly={false}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  upsertMock.mockReset(); deleteMock.mockReset(); quickAddMock.mockReset(); headerMock.mockReset()
})

describe('DbLegendPanel', () => {
  it('renders existing circuits with spare marking', () => {
    renderPanel()
    expect(screen.getByDisplayValue('Lights shop 5')).toBeTruthy()
    expect(screen.getAllByDisplayValue('1').length).toBeGreaterThan(0)
    // spare row: its checkbox is checked
    const spares = screen.getAllByLabelText(/spare/i) as HTMLInputElement[]
    expect(spares.some((el) => el.checked)).toBe(true)
  })

  it('shows the node main breaker read-only', () => {
    renderPanel()
    expect(screen.getByText('63 A TP')).toBeTruthy()
  })

  it('quick-adds N ways via the action and appends returned rows', async () => {
    quickAddMock.mockResolvedValue({
      ok: true,
      circuits: [{ id: 'c3', node_id: 'n1', circuit_no: '3', description: null, phase: null, breaker_rating_a: null, poles: null, curve: null, cable_size: null, is_spare: true, sort_order: 3 }],
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /add ways/i }))
    await waitFor(() => expect(quickAddMock).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'n1', 6))
    await waitFor(() => expect(screen.getAllByDisplayValue('3').length).toBeGreaterThan(0))
  })

  it('hides all mutating controls when readOnly', () => {
    renderPanel({ readOnly: true })
    expect(screen.queryByRole('button', { name: /add ways/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add way$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    // print stays available
    expect(screen.getByRole('link', { name: /print legend card/i })).toBeTruthy()
  })

  it('surfaces action errors in the banner', async () => {
    quickAddMock.mockResolvedValue({ error: 'Circuit 3 already exists on this board' })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /add ways/i }))
    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy())
  })
})
