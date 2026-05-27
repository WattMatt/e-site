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

describe('DatesForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when initial=null', async () => {
    const { DatesForm } = await import('./DatesForm')
    render(<DatesForm projectId="proj-uuid" initial={null} />)

    const dateInputs = screen.getAllByDisplayValue('') as HTMLInputElement[]
    // Both start and end date inputs should be empty
    expect(dateInputs.length).toBeGreaterThanOrEqual(2)
  })

  it('marks isDirty=true via context when a field changes', async () => {
    const { DatesForm } = await import('./DatesForm')
    render(<DatesForm projectId="proj-uuid" initial={{ startDate: '2025-01-01', endDate: '2025-12-31' }} />)

    // Clear the start date input (type="date" inputs are controlled via value)
    const inputs = screen.getAllByDisplayValue<HTMLInputElement>(/\d{4}-\d{2}-\d{2}/)
    // Change the end date by clearing and setting a new value
    await userEvent.clear(inputs[0])

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('dates')
    })
  })

  it('calls updateProjectAction with the patch on submit', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })

    const { DatesForm } = await import('./DatesForm')
    render(
      <DatesForm
        projectId="proj-uuid"
        initial={{ startDate: '2025-01-01', endDate: '2025-12-31' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateProjectAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        }),
      )
    })
  })

  it('shows error banner when action returns { error: "..." }', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { DatesForm } = await import('./DatesForm')
    render(
      <DatesForm
        projectId="proj-uuid"
        initial={{ startDate: '2025-01-01', endDate: '2025-12-31' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })
})
