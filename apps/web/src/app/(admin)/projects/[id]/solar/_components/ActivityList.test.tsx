import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityList } from './ActivityList'

const items = [
  { id: 2, at: '2026-09-28T09:00:00Z', actorName: 'Ann', text: 'Site & Supply saved', target: 'site' as const },
  { id: 1, at: '2026-09-28T08:00:00Z', actorName: 'Ben', text: 'Solar access granted (View)', target: 'access' as const },
]

describe('ActivityList', () => {
  it('empty state', () => {
    render(<ActivityList projectId="p1" items={[]} isGrantor={false} />)
    expect(screen.getByText('No activity yet')).toBeDefined()
  })

  it('links Site & Supply for everyone, the Access panel only for grantors', () => {
    const { rerender } = render(<ActivityList projectId="p1" items={items} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Site & Supply saved' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByRole('link', { name: 'Solar access granted (View)' })).toBeNull()
    expect(screen.getByText('Solar access granted (View)')).toBeDefined()
    rerender(<ActivityList projectId="p1" items={items} isGrantor />)
    expect(screen.getByRole('link', { name: 'Solar access granted (View)' }).getAttribute('href')).toBe('/projects/p1/solar/access')
  })

  it('shows who and when', () => {
    render(<ActivityList projectId="p1" items={items} isGrantor={false} />)
    expect(screen.getByText('28 Sep 2026 · Ann')).toBeDefined()
  })
  it('links report and proposal events to the Reports tab', () => {
    render(<ActivityList projectId="p1" items={[{ id: 3, at: '2026-09-29T09:00:00Z', actorName: 'The client', text: 'Proposal v2 accepted by the client', target: 'reports' as const }]} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Proposal v2 accepted by the client' }).getAttribute('href')).toBe('/projects/p1/solar/reports')
  })
  it('links operations activity to the Operations tab', () => {
    render(<ActivityList projectId="p1" items={[{ id: 4, at: '2026-09-29T09:00:00Z', actorName: 'Ann', text: 'Downtime recorded (2 h)', target: 'operations' as const }]} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Downtime recorded (2 h)' }).getAttribute('href')).toBe('/projects/p1/solar/operations')
  })
})
