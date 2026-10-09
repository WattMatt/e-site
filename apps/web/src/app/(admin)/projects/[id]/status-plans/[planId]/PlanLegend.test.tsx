import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlanLegend } from './PlanLegend'

/** The text of one legend row. No jest-dom here, so textContent, not toHaveTextContent. */
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent

describe('PlanLegend', () => {
  const summary = { counts: { complete: 2, in_progress: 3, overdue: 1, decommissioned: 0, unlinked: 1, common: 1, plant_room: 0, services: 0, vacant: 0 }, totalM2: 1234.56, unmeasured: 0 }

  it('lists every tenant legend entry with its live count and the total area', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete2')
    expect(legendRow('Overdue (past BO date)')).toBe('Overdue (past BO date)1')
    expect(screen.getByText(/Total measured: 1234\.6 m²/)).toBeTruthy()
  })

  it('without a scale says how to get one instead of a total', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale={false} attention={[]} onSelectShape={vi.fn()} />)
    expect(screen.getByText(/Set the page scale to measure areas/)).toBeTruthy()
  })

  it('needs-attention rows select their shape', () => {
    const onSelectShape = vi.fn()
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[{ shapeId: 's9', label: 'ZZ09', reason: 'Area differs' }]} onSelectShape={onSelectShape} />)
    fireEvent.click(screen.getByRole('button', { name: /ZZ09/ }))
    expect(onSelectShape).toHaveBeenCalledWith('s9')
  })

  it('a schematic legend has the DB order entries and no area line', () => {
    render(<PlanLegend purpose="distribution_schematic" summary={{ counts: { required: 4 }, totalM2: 0, unmeasured: 0 }} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Required')).toBe('Required4')
    expect(screen.queryByText(/Total measured/)).toBeNull()
  })
})
