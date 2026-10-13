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
    expect(screen.getByText(/Measured GLA: 1234\.6 m²/)).toBeTruthy()
  })

  it('without a scale says how to get one instead of a total', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale={false} attention={[]} onSelectShape={vi.fn()} />)
    expect(screen.getByText(/Set this sheet.s scale to measure areas/)).toBeTruthy()
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
  it('with several sheets, each row shows this sheet then all sheets, and the plan total area', () => {
    const plan = { ...summary, counts: { ...summary.counts, complete: 5 }, totalM2: 4000, unmeasured: 1 }
    render(<PlanLegend purpose="tenant_layout" summary={summary} planSummary={plan} sheetCount={3} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete25')
    expect(screen.getByText('this sheet · all 3')).toBeTruthy()
    expect(screen.getByText(/All sheets: Measured GLA: 4000\.0 m²/)).toBeTruthy()
  })

  it('one sheet: no second column', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} planSummary={summary} sheetCount={1} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete2')
  })

  it('board mode lists each main board with its count and measured area, then the rest', () => {
    const style = { fill: '#1F5FBF', fillOpacity: 0.45, stroke: '#1F5FBF', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }
    const rows = [
      { key: 'board:mb1', label: 'MB 1.1', style, count: 2, m2: 120 },
      { key: 'feed_unknown', label: 'Feed not in the cable schedule', style, count: 1, m2: null },
    ]
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[]} onSelectShape={vi.fn()} board={{ rows, planRows: null, revisionCode: 'Rev 2' }} />)
    expect(legendRow('MB 1.1')).toContain('120.0 m²')
    expect(legendRow('MB 1.1')!.endsWith('2')).toBe(true)
    expect(legendRow('Feed not in the cable schedule')).toBe('Feed not in the cable schedule1')
    expect(screen.queryByText('Complete')).toBeNull()
    expect(screen.getByText(/from cable schedule Rev 2/)).toBeTruthy()
  })
})
