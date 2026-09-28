import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { computeSolarReadiness } from '@esite/shared'
import { ReadinessChecklist } from './ReadinessChecklist'

describe('ReadinessChecklist', () => {
  it('links live steps to their tab and greys out later phases', () => {
    render(<ReadinessChecklist projectId="p1" steps={computeSolarReadiness(null, 'edit')} />)
    expect(screen.getByRole('link', { name: 'Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByRole('link', { name: 'Load' })).toBeNull()
    expect(screen.getAllByText('Not started — available in a later phase').length).toBe(6)
    expect(screen.getByText('Not started')).toBeDefined()
  })
})
