import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let pathname = '/dashboard'
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }))
vi.mock('./SolarNavItem', () => ({ SolarNavItem: () => null }))
import { Sidebar } from './Sidebar'

beforeEach(() => { pathname = '/dashboard' })

describe('Sidebar — Tariff library link', () => {
  it('only platform tariff admins see it', () => {
    const { unmount } = render(<Sidebar role="owner" />)
    expect(screen.queryByRole('link', { name: 'Tariff library' })).toBeNull()
    unmount()
    render(<Sidebar role="contractor" tariffAdmin />)
    expect(screen.getByRole('link', { name: 'Tariff library' }).getAttribute('href')).toBe('/admin/tariffs')
  })
})

describe('Sidebar — site capture is project-scoped', () => {
  const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'))

  it('has no global Site capture entry and no link to /site, for any role', () => {
    for (const role of ['owner', 'contractor'] as const) {
      const { unmount } = render(<Sidebar role={role} />)
      expect(screen.queryByRole('link', { name: /site capture/i })).toBeNull()
      expect(hrefs()).not.toContain('/site')
      unmount()
    }
  })

  it('offers no Capture entry outside a project', () => {
    render(<Sidebar role="owner" />)
    expect(screen.queryByRole('link', { name: 'Capture' })).toBeNull()
  })

  it('offers Capture inside a project, scoped to that project, right after Overview', () => {
    pathname = '/projects/p1/snags'
    render(<Sidebar role="contractor" />)
    expect(screen.getByRole('link', { name: 'Capture' }).getAttribute('href')).toBe('/projects/p1/capture')
    expect(hrefs()).not.toContain('/site')
    const order = hrefs()
    expect(order.indexOf('/projects/p1/capture')).toBe(order.indexOf('/projects/p1') + 1)
  })

  it('marks Capture active on the capture page', () => {
    pathname = '/projects/p1/capture'
    render(<Sidebar role="owner" />)
    expect(screen.getByRole('link', { name: 'Capture' }).getAttribute('aria-current')).toBe('page')
  })
describe('Sidebar — Tariffs link (E7)', () => {
  it('every org role sees the public tariff explorer, admin or not', () => {
    for (const role of ['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier'] as const) {
      const { unmount } = render(<Sidebar role={role} />)
      expect(screen.getByRole('link', { name: 'Tariffs' }).getAttribute('href')).toBe('/tariffs')
      unmount()
    }
  })
})
