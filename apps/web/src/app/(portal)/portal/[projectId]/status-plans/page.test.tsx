import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/portal/data', () => ({ listPortalStatusPlans: list }))

import PortalStatusPlansPage from './page'

describe('portal status plans', () => {
  it('lists each plan with a link that opens its PDF', async () => {
    list.mockResolvedValue([{ id: 's1', name: 'Ground floor', purpose: 'tenant_layout', page_index: 1, updated_at: '2026-10-09T00:00:00Z', floor_plans: { name: 'Mall GF layout' } }])
    render(await PortalStatusPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(list).toHaveBeenCalledWith('p1')
    const link = screen.getByRole('link', { name: /open ground floor/i })
    expect(link.getAttribute('href')).toBe('/api/portal/p1/status-plans/s1/pdf')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Tenant layout')).toBeDefined()
    expect(screen.getByText('Mall GF layout')).toBeDefined()
  })
  it('empty state', async () => {
    list.mockResolvedValue([])
    render(await PortalStatusPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(screen.getByText(/no status plans on this site yet/i)).toBeDefined()
  })
})
