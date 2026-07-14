import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/portal/p1',
}))

import { PortalProjectNav } from './PortalProjectNav'

describe('PortalProjectNav', () => {
  it('renders exactly the client-approved aspects — nothing financial or admin', () => {
    render(<PortalProjectNav projectId="p1" />)
    const labels = screen.getAllByRole('link').map((a) => a.textContent)
    expect(labels).toEqual([
      'Overview',
      'Site Diary',
      'Snags',
      'Quality Control',
      'Inspections',
      'Cable Schedule',
      'Equipment & Materials',
      'Generator Recovery',
      'Floor Plans',
      'Handover',
      'Tenant Schedule',
    ])
  })

  it('never links to financial or admin surfaces', () => {
    render(<PortalProjectNav projectId="p1" />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '')
    for (const banned of ['valuation', 'variation', 'boq', 'settings', 'members', 'marketplace', 'jbcc', 'rates', 'billing']) {
      expect(hrefs.join(' ')).not.toContain(banned)
    }
    // All links stay inside this project's portal space.
    for (const href of hrefs) expect(href.startsWith('/portal/p1')).toBe(true)
  })
})
