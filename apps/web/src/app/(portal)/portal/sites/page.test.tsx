import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getClientSitesMock = vi.fn()
vi.mock('../../portal-gcr.actions', () => ({
  getClientSitesAction: () => getClientSitesMock(),
}))

import PortalSitesPage from './page'

beforeEach(() => {
  getClientSitesMock.mockReset()
})

describe('PortalSitesPage (My sites picker)', () => {
  it('lists the granted sites with links to the GCR review', async () => {
    getClientSitesMock.mockResolvedValue([
      { project_id: 'p1', project_name: 'Mall A', organisation_name: 'Org A' },
      { project_id: 'p2', project_name: 'Mall B', organisation_name: null },
    ])
    render(await PortalSitesPage())
    expect(screen.getByText('Mall A')).toBeTruthy()
    expect(screen.getByText('Mall B')).toBeTruthy()
    expect(screen.getByText('Org A')).toBeTruthy()
    const link = screen.getByText('Mall A').closest('a')
    expect(link?.getAttribute('href')).toBe('/portal/sites/p1/gcr')
  })

  it('shows a clean empty state when no sites are granted', async () => {
    getClientSitesMock.mockResolvedValue([])
    render(await PortalSitesPage())
    expect(screen.getByText('No sites yet')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('surfaces an action error', async () => {
    getClientSitesMock.mockResolvedValue({ error: 'Not authenticated' })
    render(await PortalSitesPage())
    expect(screen.getByText('Not authenticated')).toBeTruthy()
  })
})
