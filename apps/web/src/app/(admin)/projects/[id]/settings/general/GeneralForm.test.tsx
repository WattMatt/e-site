import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockUpdateProjectAction = vi.fn()
vi.mock('@/actions/project.actions', () => ({
  updateProjectAction: (...args: unknown[]) => mockUpdateProjectAction(...args),
}))

const mockMarkDirty = vi.fn()
const mockMarkClean = vi.fn()
vi.mock('../_components/UnsavedChangesGuard', () => ({
  useDirtyForm: () => ({
    isDirty: false,
    dirtyTab: null,
    markDirty: mockMarkDirty,
    markClean: mockMarkClean,
    promptNav: vi.fn(),
  }),
}))

vi.mock('../_components/StickySaveBar', () => ({
  StickySaveBar: ({
    onSave,
    onDiscard,
  }: {
    isDirty: boolean
    onSave: () => Promise<void>
    onDiscard: () => void
  }) => (
    <div data-testid="save-bar">
      <button onClick={() => { onSave().catch(() => {}) }} type="button">Save</button>
      <button onClick={onDiscard} type="button">Discard</button>
    </div>
  ),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GeneralForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when initial=null', async () => {
    const { GeneralForm } = await import('./GeneralForm')
    render(<GeneralForm projectId="proj-uuid" initial={null} />)

    // Name field should be empty
    const nameInput = screen.getByPlaceholderText('e.g. Sandton Towers Phase 2') as HTMLInputElement
    expect(nameInput.value).toBe('')

    // Status should default to 'active'
    const statusSelect = screen.getByRole('combobox') as HTMLSelectElement
    expect(statusSelect.value).toBe('active')
  })

  it('marks isDirty=true via context when a field changes', async () => {
    const { GeneralForm } = await import('./GeneralForm')
    render(<GeneralForm projectId="proj-uuid" initial={{ name: 'Old Name', status: 'active' }} />)

    const nameInput = screen.getByPlaceholderText('e.g. Sandton Towers Phase 2')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Name')

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('general')
    })
  })

  it('calls updateProjectAction with the patch on submit', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })

    const { GeneralForm } = await import('./GeneralForm')
    render(
      <GeneralForm
        projectId="proj-uuid"
        // 'TP01' matches the DB CHECK projects_code_format
        // (^[A-Z][A-Z0-9]{1,11}$ — letters + digits, no hyphens).
        initial={{ name: 'Test Project', description: 'Desc', code: 'TP01', status: 'active' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateProjectAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          name: 'Test Project',
          status: 'active',
        }),
      )
    })
  })

  it('shows error banner when action returns { error: "..." }', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { GeneralForm } = await import('./GeneralForm')
    render(<GeneralForm projectId="proj-uuid" initial={{ name: 'X', code: 'TP01', status: 'active' }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })

  // Regression: DB CHECK rejects codes that don't match ^[A-Z][A-Z0-9]{1,11}$.
  // Form must reject the same input client-side with a useful error before
  // hitting the action.
  it('blocks submit when code is invalid (e.g. starts with a digit)', async () => {
    const { GeneralForm } = await import('./GeneralForm')
    render(
      <GeneralForm
        projectId="proj-uuid"
        initial={{ name: 'Test', code: '643', status: 'active' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Action should never be called — Zod blocks submission.
    await waitFor(() => {
      expect(screen.getByText(/must start with an uppercase letter/i)).toBeDefined()
    })
    expect(mockUpdateProjectAction).not.toHaveBeenCalled()
  })
})
