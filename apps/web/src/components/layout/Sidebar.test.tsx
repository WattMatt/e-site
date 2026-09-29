import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))
vi.mock('./SolarNavItem', () => ({ SolarNavItem: () => null }))
import { Sidebar } from './Sidebar'

describe('Sidebar — Tariff library link', () => {
  it('only platform tariff admins see it', () => {
    const { unmount } = render(<Sidebar role="owner" />)
    expect(screen.queryByRole('link', { name: 'Tariff library' })).toBeNull()
    unmount()
    render(<Sidebar role="contractor" tariffAdmin />)
    expect(screen.getByRole('link', { name: 'Tariff library' }).getAttribute('href')).toBe('/admin/tariffs')
  })
})
