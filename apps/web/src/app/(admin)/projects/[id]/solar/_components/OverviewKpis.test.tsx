import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OverviewKpis } from './OverviewKpis'

describe('OverviewKpis (spec §2.4 empty state + §2.2 case controls)', () => {
  it('View: the empty state only — controls above the level are hidden', () => {
    render(<OverviewKpis projectId="p1" level="view" />)
    expect(screen.getByText('No case has been run yet — start at Site & Supply.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Go to Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByLabelText('Change selected case')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })

  it('Edit: the selected-case control, disabled with its reason; no report button', () => {
    render(<OverviewKpis projectId="p1" level="edit" />)
    expect((screen.getByLabelText('Change selected case') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('Run a case on Yield & Scenarios first')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })

  it('Edit + financials: the report shortcut too, disabled with its reason', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" />)
    const btn = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('Available once a case has been run')
  })
})
