import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { computeSolarReadiness } from '@esite/shared'
import { ReadinessChecklist } from './ReadinessChecklist'

describe('ReadinessChecklist', () => {
  it('links live steps to their tab and greys out later phases', () => {
    render(<ReadinessChecklist projectId="p1" steps={computeSolarReadiness(null, 'edit')} />)
    expect(screen.getByRole('link', { name: 'Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.getByRole('link', { name: 'Load' }).getAttribute('href')).toBe('/projects/p1/solar/load')
    expect(screen.getByRole('link', { name: 'Yield & Scenarios' }).getAttribute('href')).toBe('/projects/p1/solar/yield')
    // Every tab is built once phases 1–7 are assembled: no step is a later phase.
    expect(screen.queryAllByText('Not started — available in a later phase').length).toBe(0)
    expect(screen.getByRole('link', { name: 'Reports & Proposal' }).getAttribute('href')).toBe('/projects/p1/solar/reports')
    expect(screen.getByRole('link', { name: 'Schedule' }).getAttribute('href')).toBe('/projects/p1/solar/schedule')
    expect(screen.getByRole('link', { name: 'Operations' }).getAttribute('href')).toBe('/projects/p1/solar/operations')
  })
})
