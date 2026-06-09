import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// ─── Why this test exists ──────────────────────────────────────────────────────
// The generator SettingsForm is rendered OUTSIDE the settings shell, so it must
// stand alone — it must NOT depend on the <UnsavedChangesGuard> context provider
// that only wraps the settings/* subtree. We deliberately do NOT mock
// useDirtyForm here: before the decoupling fix, SettingsForm calls the real hook,
// which throws "useDirtyForm must be used inside <UnsavedChangesGuard>" with no
// provider present — so this render crashes and the test fails. After the fix
// (the hook dependency removed) it renders cleanly.

// Server action: mocked so the test never pulls in server-only code.
vi.mock('./gcr.actions', () => ({
  saveGcrSettingsAction: vi.fn(),
}))

// StickySaveBar is presentational; stub it (same convention as the settings tests).
vi.mock('../settings/_components/StickySaveBar', () => ({
  StickySaveBar: () => <div data-testid="save-bar" />,
}))

describe('gcr SettingsForm', () => {
  it('renders standalone without an UnsavedChangesGuard provider', async () => {
    const { SettingsForm } = await import('./SettingsForm')
    render(<SettingsForm projectId="proj-uuid" settings={null} />)

    // Form body rendered — no crash …
    expect(screen.getByText('Loading rates')).toBeDefined()
    // … with the category-rate defaults wired through react-hook-form.
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0].value).toBe('0.03') // standard_kw_per_sqm default
  })

  it('reflects saved settings values', async () => {
    const { SettingsForm } = await import('./SettingsForm')
    render(<SettingsForm projectId="proj-uuid" settings={{ standard_kw_per_sqm: 0.05 }} />)

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0].value).toBe('0.05')
  })
})
