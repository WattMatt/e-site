import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/projects/p1/settings/general',
}))

describe('UnsavedChangesGuard', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders children and exposes a context with isDirty=false initially', async () => {
    const { UnsavedChangesGuard, useDirtyForm } = await import('./UnsavedChangesGuard')

    function Probe() {
      const { isDirty } = useDirtyForm()
      return <span data-testid="probe">{String(isDirty)}</span>
    }

    render(
      <UnsavedChangesGuard>
        <Probe />
      </UnsavedChangesGuard>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('false')
  })

  it('flips isDirty=true when a form registers as dirty', async () => {
    const { UnsavedChangesGuard, useDirtyForm } = await import('./UnsavedChangesGuard')

    function Probe() {
      const ctx = useDirtyForm()
      return (
        <div>
          <button onClick={() => ctx.markDirty('general')}>dirty</button>
          <span data-testid="probe">{String(ctx.isDirty)}</span>
          <span data-testid="slug">{ctx.dirtyTab ?? 'none'}</span>
        </div>
      )
    }

    render(
      <UnsavedChangesGuard>
        <Probe />
      </UnsavedChangesGuard>,
    )

    await userEvent.click(screen.getByText('dirty'))

    expect(screen.getByTestId('probe').textContent).toBe('true')
    expect(screen.getByTestId('slug').textContent).toBe('general')
  })

  it('renders the modal when promptNav is invoked while dirty', async () => {
    const { UnsavedChangesGuard, useDirtyForm } = await import('./UnsavedChangesGuard')

    function Probe() {
      const ctx = useDirtyForm()
      return (
        <div>
          <button onClick={() => ctx.markDirty('general')}>dirty</button>
          <button onClick={() => ctx.promptNav('/projects/p1/settings/dates')}>nav</button>
        </div>
      )
    }

    render(
      <UnsavedChangesGuard>
        <Probe />
      </UnsavedChangesGuard>,
    )

    await userEvent.click(screen.getByText('dirty'))
    await userEvent.click(screen.getByText('nav'))

    expect(screen.getByRole('dialog')).toBeDefined()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Unsaved changes')
  })

  it('Stay button closes the modal without navigating', async () => {
    const { UnsavedChangesGuard, useDirtyForm } = await import('./UnsavedChangesGuard')

    function Probe() {
      const ctx = useDirtyForm()
      return (
        <div>
          <button onClick={() => ctx.markDirty('general')}>dirty</button>
          <button onClick={() => ctx.promptNav('/projects/p1/settings/dates')}>nav</button>
        </div>
      )
    }

    render(
      <UnsavedChangesGuard>
        <Probe />
      </UnsavedChangesGuard>,
    )

    await userEvent.click(screen.getByText('dirty'))
    await userEvent.click(screen.getByText('nav'))
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('Discard button clears dirty state and navigates', async () => {
    const { UnsavedChangesGuard, useDirtyForm } = await import('./UnsavedChangesGuard')

    function Probe() {
      const ctx = useDirtyForm()
      return (
        <div>
          <button onClick={() => ctx.markDirty('general')}>dirty</button>
          <button onClick={() => ctx.promptNav('/projects/p1/settings/dates')}>nav</button>
          <span data-testid="probe">{String(ctx.isDirty)}</span>
        </div>
      )
    }

    render(
      <UnsavedChangesGuard>
        <Probe />
      </UnsavedChangesGuard>,
    )

    await userEvent.click(screen.getByText('dirty'))
    await userEvent.click(screen.getByText('nav'))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(pushMock).toHaveBeenCalledWith('/projects/p1/settings/dates')
    expect(screen.getByTestId('probe').textContent).toBe('false')
  })
})
