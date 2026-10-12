import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BillTabs, splitBillName } from './BillTabs'

const tabs = [
  { key: 'A - P&G', progress: { done: 2, total: 2 } },
  { key: 'C - Reticulation', progress: { done: 1, total: 3 } },
  { key: 'Daywork rates' },
]

describe('BillTabs', () => {
  it('shows each bill as a tab with its letter, name and pricing progress', () => {
    render(<BillTabs tabs={tabs} active="C - Reticulation" onSelect={() => {}} label="Bills" panelId="p" />)
    const all = screen.getAllByRole('tab')
    expect(all).toHaveLength(3)
    expect(all[1].getAttribute('aria-selected')).toBe('true')
    expect(all[1].getAttribute('aria-label')).toBe('C - Reticulation, 1 of 3 priced')
    expect(all[0].getAttribute('aria-label')).toBe('A - P&G, all priced')
    expect(all[0].className).toContain('is-complete')
    expect(screen.getByText('1 of 3 priced')).toBeTruthy()
    expect(screen.getByText('✓ All priced')).toBeTruthy()
    // Only the selected tab is in the tab order (roving tabindex).
    expect(all.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('moves with the arrow keys, Home and End, wrapping at the ends', () => {
    const onSelect = vi.fn()
    render(<BillTabs tabs={tabs} active="A - P&G" onSelect={onSelect} label="Bills" panelId="p" />)
    const list = screen.getByRole('tablist')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    fireEvent.keyDown(list, { key: 'End' })
    fireEvent.keyDown(list, { key: 'Home' })
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['C - Reticulation', 'Daywork rates', 'Daywork rates', 'A - P&G'])
  })

  it('selects on click', () => {
    const onSelect = vi.fn()
    render(<BillTabs tabs={tabs} active="A - P&G" onSelect={onSelect} label="Bills" panelId="p" />)
    fireEvent.click(screen.getAllByRole('tab')[2])
    expect(onSelect).toHaveBeenCalledWith('Daywork rates')
  })
})

describe('splitBillName', () => {
  it('reads the bill letter from common sheet names, and keeps any other name whole', () => {
    expect(splitBillName('C - Reticulation')).toEqual({ code: 'C', name: 'Reticulation' })
    expect(splitBillName('b: Lighting')).toEqual({ code: 'B', name: 'Lighting' })
    expect(splitBillName('12 – Earthing')).toEqual({ code: '12', name: 'Earthing' })
    expect(splitBillName('Daywork rates')).toEqual({ code: null, name: 'Daywork rates' })
  })
})
