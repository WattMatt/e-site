import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock factories are hoisted to top of file — they run before any const
// declarations. Use vi.hoisted() to create refs that can be referenced inside
// the factory without being in the TDZ.

const { refreshFn } = vi.hoisted(() => ({ refreshFn: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshFn }),
}))

vi.mock('@/actions/active-organisation.actions', () => ({
  setActiveOrganisation: vi.fn(),
}))

import { OrgSwitcher } from './OrgSwitcher'
import { setActiveOrganisation } from '@/actions/active-organisation.actions'

const setActiveOrganisationMock = vi.mocked(setActiveOrganisation)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = {
  organisation_id:   '00000000-0000-0000-0000-000000000001',
  organisation_name: 'Alpha Corp',
  role:              'owner',
  is_active_context: true,
}

const ORG_B = {
  organisation_id:   '00000000-0000-0000-0000-000000000002',
  organisation_name: 'Beta Corp',
  role:              'admin',
  is_active_context: false,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrgSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when memberships array is empty', () => {
    const { container } = render(<OrgSwitcher memberships={[]} />)
    // Empty memberships: memberships.length <= 1 and current is null → returns null
    expect(container.firstChild).toBeNull()
  })

  it('renders static label (no button) when memberships.length === 1', () => {
    render(<OrgSwitcher memberships={[ORG_A]} />)
    // Should show org name as static text
    expect(screen.getByText('Alpha Corp')).toBeTruthy()
    // Single-org path returns a <div>, not a button
    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(0)
  })

  it('renders a button with current org name when memberships.length >= 2', () => {
    render(<OrgSwitcher memberships={[ORG_A, ORG_B]} />)
    // The toggle button should show the current (is_active_context=true) org name
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('Alpha Corp')
  })

  it('clicking the button reveals the dropdown menu with all org options', async () => {
    render(<OrgSwitcher memberships={[ORG_A, ORG_B]} />)

    // Dropdown not visible yet
    expect(screen.queryByRole('menu')).toBeNull()

    const toggleButton = screen.getByRole('button')
    await act(async () => { fireEvent.click(toggleButton) })

    // Menu should now be visible
    expect(screen.getByRole('menu')).toBeTruthy()
    // Both org names appear after opening
    const betaOccurrences = screen.getAllByText('Beta Corp')
    expect(betaOccurrences.length).toBeGreaterThan(0)
  })

  it('clicking a different org row calls setActiveOrganisation with that org id and triggers router.refresh', async () => {
    setActiveOrganisationMock.mockResolvedValueOnce({ ok: true })

    render(<OrgSwitcher memberships={[ORG_A, ORG_B]} />)

    // Open dropdown
    const toggleButton = screen.getByRole('button')
    await act(async () => { fireEvent.click(toggleButton) })

    // Find the Beta Corp button inside the menu and click it
    const allButtons = screen.getAllByRole('button')
    const betaButton = allButtons.find((b) => b.textContent?.includes('Beta Corp'))
    expect(betaButton).toBeTruthy()

    await act(async () => { fireEvent.click(betaButton!) })

    expect(setActiveOrganisationMock).toHaveBeenCalledWith(ORG_B.organisation_id)
    expect(refreshFn).toHaveBeenCalled()
  })
})
