import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const list = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('@/lib/portal/data', () => ({ listPortalTenantPlans: list }))
vi.mock('next/navigation', () => ({ redirect }))

import PortalTenantPlansPage from './page'
import OldPortalStatusPlans from '../status-plans/page'

describe('portal tenant plans', () => {
  it('lists the floor plan and the line diagram, each opening as one PDF', async () => {
    list.mockResolvedValue([
      { id: 'fp', name: 'Floor plan', purpose: 'tenant_layout', updated_at: '2026-10-12T00:00:00Z', sheets: 3 },
      { id: 'ld', name: 'Line diagram', purpose: 'distribution_schematic', updated_at: '2026-10-12T00:00:00Z', sheets: 1 },
    ])
    render(await PortalTenantPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(list).toHaveBeenCalledWith('p1')
    expect(screen.getByText('Tenant floor plan')).toBeTruthy()
    expect(screen.getByText('Line diagram')).toBeTruthy()
    expect(screen.getByText('3 sheets')).toBeTruthy()
    const link = screen.getByRole('link', { name: /open tenant floor plan/i })
    expect(link.getAttribute('href')).toBe('/api/portal/p1/status-plans/fp/pdf')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('empty state', async () => {
    list.mockResolvedValue([])
    render(await PortalTenantPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(screen.getByText(/no tenant plans on this site yet/i)).toBeTruthy()
  })

  it('the old portal address redirects here', async () => {
    await expect(OldPortalStatusPlans({ params: Promise.resolve({ projectId: 'p1' }) })).rejects.toThrow('NEXT_REDIRECT /portal/p1/tenant-plans')
  })
})
