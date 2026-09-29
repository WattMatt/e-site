import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortfolioTable } from './PortfolioTable'
import type { PortfolioRow } from '@/lib/solar/portfolio-model'

const rows: PortfolioRow[] = [
  { projectId: 'a', projectName: 'Acme Mall', province: 'Gauteng', city: 'Pretoria', licenseeName: 'City of Tshwane', stage: 'accepted', selectedCaseName: 'Base', selectedKwp: 500, proposedKwp: 480, year1SavingZar: 400_000, lastActivity: '2026-09-28T10:00:00Z', canSeeMoney: true },
  { projectId: 'b', projectName: 'Beta Park', province: 'Western Cape', city: null, licenseeName: 'City of Cape Town', stage: 'study', selectedCaseName: null, selectedKwp: null, proposedKwp: null, year1SavingZar: null, lastActivity: null, canSeeMoney: false },
]

describe('PortfolioTable (§15)', () => {
  it('rows, Open link to Overview, money only where allowed, text nodes only', () => {
    render(<PortfolioTable rows={rows} isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'Open Acme Mall' }).getAttribute('href')).toBe('/projects/a/solar/overview')
    expect(screen.getByText('R 400 000')).toBeTruthy()
    expect(screen.getByText('500.0 kWp')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Manage access/ })).toBeNull()
  })
  it('Manage access row action for owners/admins only', () => {
    render(<PortfolioTable rows={rows} isAdmin />)
    expect(screen.getByRole('link', { name: 'Manage access for Acme Mall' }).getAttribute('href')).toBe('/projects/a/solar/access')
  })
  it('filters and KPIs', () => {
    render(<PortfolioTable rows={rows} isAdmin={false} />)
    expect(screen.getByText('Projects: 2')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'study' } })
    expect(screen.queryByText('Acme Mall')).toBeNull()
    expect(screen.getByText('Beta Park')).toBeTruthy()
    expect(screen.getByText('kWp operating: available with Operations (Phase 7)')).toBeTruthy()
  })
  it('renders a project name as text, never as markup', () => {
    const hostile = [{ ...rows[1]!, projectName: '<img src=x onerror=alert(1)>' }]
    const { container } = render(<PortfolioTable rows={hostile} isAdmin={false} />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
  it('empty state', () => {
    render(<PortfolioTable rows={[]} isAdmin={false} />)
    expect(screen.getByText('No Solar projects you can see yet — open a project’s Solar tab to start a study.')).toBeTruthy()
  })
})
