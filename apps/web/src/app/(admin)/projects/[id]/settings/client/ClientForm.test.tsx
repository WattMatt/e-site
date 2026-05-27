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

describe('ClientForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when initial=null', async () => {
    const { ClientForm } = await import('./ClientForm')
    render(<ClientForm projectId="proj-uuid" initial={null} />)

    const nameInput = screen.getByPlaceholderText('e.g. Acme Property Developers') as HTMLInputElement
    expect(nameInput.value).toBe('')

    const contactInput = screen.getByPlaceholderText(/Jane Smith/) as HTMLTextAreaElement
    expect(contactInput.value).toBe('')
  })

  it('marks isDirty=true via context when a field changes', async () => {
    const { ClientForm } = await import('./ClientForm')
    render(
      <ClientForm
        projectId="proj-uuid"
        initial={{ clientName: 'Acme', clientContact: 'jane@acme.co.za' }}
      />,
    )

    const nameInput = screen.getByPlaceholderText('e.g. Acme Property Developers')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Client')

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('client')
    })
  })

  it('calls updateProjectAction with the patch on submit', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })

    const { ClientForm } = await import('./ClientForm')
    render(
      <ClientForm
        projectId="proj-uuid"
        initial={{ clientName: 'Acme Corp', clientContact: 'jane@acme.co.za' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateProjectAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          clientName: 'Acme Corp',
          clientContact: 'jane@acme.co.za',
        }),
      )
    })
  })

  it('shows error banner when action returns { error: "..." }', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { ClientForm } = await import('./ClientForm')
    render(
      <ClientForm
        projectId="proj-uuid"
        initial={{ clientName: 'Acme', clientContact: 'x' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })
})
