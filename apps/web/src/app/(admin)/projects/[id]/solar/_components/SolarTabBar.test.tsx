import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeSolarReadiness } from '@esite/shared'

const h = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/p1/solar/overview',
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
}))

import { SolarTabBar } from './SolarTabBar'
import { setSolarDirty } from '@/lib/solar/dirty-store'

const site = { latitude: -26, longitude: 28, licenseeName: null, nmdKva: 400 }

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { setSolarDirty(false) })

describe('SolarTabBar', () => {
  it('links built tabs, disables the rest with "Coming in a later phase"', () => {
    render(<SolarTabBar projectId="p1" level="view" readiness={computeSolarReadiness(site, 'view')} />)
    expect(screen.getByRole('link', { name: /Overview/ }).getAttribute('href')).toBe('/projects/p1/solar/overview')
    expect(screen.getByRole('link', { name: /Site & Supply/ }).getAttribute('href')).toBe('/projects/p1/solar/site')
    const load = screen.getByText('Load').closest('[aria-disabled="true"]') as HTMLElement
    expect(load.getAttribute('title')).toBe('Coming in a later phase')
    expect(screen.queryByRole('link', { name: /Load/ })).toBeNull()
  })

  it('hides Tariff and Financials below Edit + financials, shows them at it; never Operations', () => {
    const { rerender } = render(<SolarTabBar projectId="p1" level="edit" readiness={[]} />)
    expect(screen.queryByText('Tariff')).toBeNull()
    expect(screen.queryByText('Financials')).toBeNull()
    rerender(<SolarTabBar projectId="p1" level="edit_financials" readiness={[]} />)
    expect(screen.getByText('Tariff')).toBeDefined()
    expect(screen.getByText('Financials')).toBeDefined()
    expect(screen.queryByText('Operations')).toBeNull()
  })

  it('puts the rule outcome on the Site & Supply dot', () => {
    render(<SolarTabBar projectId="p1" level="view" readiness={computeSolarReadiness(site, 'view')} />)
    expect(screen.getByLabelText('Incomplete: Missing: supply authority')).toBeDefined()
  })

  it('with unsaved changes, asks "Discard unsaved changes?" inline before leaving', async () => {
    const user = userEvent.setup()
    setSolarDirty(true)
    render(<SolarTabBar projectId="p1" level="view" readiness={[]} />)
    await user.click(screen.getByRole('link', { name: /Site & Supply/ }))
    expect(screen.getByText('Discard unsaved changes?')).toBeDefined()
    expect(h.push).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/site')
  })

  it('Stay keeps the user on the page', async () => {
    const user = userEvent.setup()
    setSolarDirty(true)
    render(<SolarTabBar projectId="p1" level="view" readiness={[]} />)
    await user.click(screen.getByRole('link', { name: /Site & Supply/ }))
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
    expect(h.push).not.toHaveBeenCalled()
  })
})
