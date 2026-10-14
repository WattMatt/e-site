import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SCHEMATIC_LEGEND, TENANT_LEGEND } from '@esite/shared/status-plans'
import { CanvasLegend, canvasLegendEntries } from './CanvasLegend'

const key = () => screen.getByRole('list', { name: 'Colour key' })

describe('CanvasLegend', () => {
  it('lists every colour with its label and live count, each swatch solid', () => {
    const entries = canvasLegendEntries(SCHEMATIC_LEGEND, { received: 3, ordered: 2, required: 9 })
    render(<CanvasLegend entries={entries} />)
    const rows = within(key()).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Received3', 'Ordered2', 'Required — not yet ordered9', 'Supplied by tenant0', 'No order line0', 'Not linked to a board0',
    ])
    const swatch = rows[0]!.querySelector('[data-swatch]') as HTMLElement
    expect(swatch.style.backgroundColor).toBe('rgba(46, 158, 79, 0.5)')
    expect(swatch.style.backgroundImage).toBe('')
  })

  it('collapses to a single button and opens again', () => {
    render(<CanvasLegend entries={canvasLegendEntries(TENANT_LEGEND, { overdue: 1 })} />)
    const toggle = screen.getByRole('button', { name: 'Hide colour key' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(screen.queryByRole('list', { name: 'Colour key' })).toBeNull()
    const open = screen.getByRole('button', { name: 'Show colour key' })
    expect(open.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(open)
    expect(within(key()).getByText('Overdue (past BO date)').closest('li')!.textContent).toBe('Overdue (past BO date)1')
  })

  it('takes board rows as they are (main-board colouring)', () => {
    const style = { fill: '#1F5FBF', fillOpacity: 0.45, stroke: '#1F5FBF', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }
    render(<CanvasLegend entries={[{ key: 'board:a', label: 'MB 1.1', style, count: 4 }]} />)
    expect(within(key()).getByRole('listitem').textContent).toBe('MB 1.14')
  })
})
