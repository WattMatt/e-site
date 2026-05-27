import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const usePathnameMock = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: usePathnameMock }))

describe('SettingsTabs', () => {
  it('renders all 12 sub-pages in spec order', async () => {
    usePathnameMock.mockReturnValue('/projects/p1/settings/general')
    const { SettingsTabs } = await import('./SettingsTabs')

    render(<SettingsTabs projectId="p1" role="owner" dirtyTab={null} />)

    const expected = [
      'General', 'Site', 'Dates', 'Client', 'Contract', 'Members',
      'JBCC Parties', 'Operational', 'Contacts', 'Integrations',
      'Danger', 'History',
    ]
    const links = screen.getAllByRole('link')
    expect(links.map(a => a.textContent?.replace(/[●🔒⚠]/g, '').trim())).toEqual(expected)
  })

  it('marks the active tab from pathname', async () => {
    usePathnameMock.mockReturnValue('/projects/p1/settings/dates')
    const { SettingsTabs } = await import('./SettingsTabs')

    render(<SettingsTabs projectId="p1" role="owner" dirtyTab={null} />)

    const active = screen.getByRole('link', { current: 'page' })
    expect(active.textContent).toContain('Dates')
  })

  it('shows lock 🔒 marker on admin-only tabs when user is project_manager', async () => {
    usePathnameMock.mockReturnValue('/projects/p1/settings/general')
    const { SettingsTabs } = await import('./SettingsTabs')

    render(<SettingsTabs projectId="p1" role="project_manager" dirtyTab={null} />)

    // Contract, Members, Integrations should have the lock marker for PMs.
    expect(screen.getByText(/Contract/).textContent).toContain('🔒')
    expect(screen.getByText(/Members/).textContent).toContain('🔒')
    expect(screen.getByText(/Integrations/).textContent).toContain('🔒')
    // Danger is owner-only — for PMs, even more locked.
    expect(screen.getByText(/Danger/).textContent).toContain('🔒')
  })

  it('shows unsaved-dot ● on the dirty tab', async () => {
    usePathnameMock.mockReturnValue('/projects/p1/settings/general')
    const { SettingsTabs } = await import('./SettingsTabs')

    render(<SettingsTabs projectId="p1" role="owner" dirtyTab="dates" />)

    expect(screen.getByText(/Dates/).textContent).toContain('●')
    expect(screen.getByText(/General/).textContent).not.toContain('●')
  })
})
