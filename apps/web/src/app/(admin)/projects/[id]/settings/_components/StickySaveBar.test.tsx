import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('StickySaveBar', () => {
  it('renders nothing when isDirty=false', async () => {
    const { StickySaveBar } = await import('./StickySaveBar')
    const onSave = vi.fn()
    const onDiscard = vi.fn()

    const { container } = render(
      <StickySaveBar isDirty={false} onSave={onSave} onDiscard={onDiscard} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders bar with Save + Discard when isDirty=true', async () => {
    const { StickySaveBar } = await import('./StickySaveBar')

    render(
      <StickySaveBar isDirty={true} onSave={vi.fn()} onDiscard={vi.fn()} />,
    )

    expect(screen.getByText(/Unsaved changes/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Discard/i })).toBeDefined()
  })

  it('transitions to "Saving…" while onSave is pending then "✓ Saved" on success', async () => {
    const { StickySaveBar } = await import('./StickySaveBar')

    let resolveSave: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>(r => { resolveSave = r }))

    render(<StickySaveBar isDirty={true} onSave={onSave} onDiscard={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }))
    expect(screen.getByText(/Saving/i)).toBeDefined()

    resolveSave()
    await waitFor(() => expect(screen.getByText(/Saved/i)).toBeDefined())
  })

  it('shows ⚠ Retry + error on failed save', async () => {
    const { StickySaveBar } = await import('./StickySaveBar')

    const onSave = vi.fn().mockRejectedValue(new Error('Network error'))

    render(<StickySaveBar isDirty={true} onSave={onSave} onDiscard={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Retry/i })).toBeDefined()
    })
  })

  // Regression: previously the component returned null BEFORE a useEffect was
  // declared, so flipping isDirty false→true changed the hook count and
  // React threw #310 ("Rendered fewer hooks than expected"). All hooks must
  // sit above any conditional return.
  it('does not throw when isDirty toggles false → true → false', async () => {
    const { StickySaveBar } = await import('./StickySaveBar')

    const { rerender } = render(
      <StickySaveBar isDirty={false} onSave={vi.fn()} onDiscard={vi.fn()} />,
    )
    rerender(<StickySaveBar isDirty={true} onSave={vi.fn()} onDiscard={vi.fn()} />)
    rerender(<StickySaveBar isDirty={false} onSave={vi.fn()} onDiscard={vi.fn()} />)

    // If hook order had changed across renders, React would have thrown
    // before reaching this assertion. Reaching here = no #310.
    expect(true).toBe(true)
  })
})
