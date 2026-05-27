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

describe('SiteForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when initial=null', async () => {
    const { SiteForm } = await import('./SiteForm')
    render(<SiteForm projectId="proj-uuid" initial={null} />)

    const cityInput = screen.getByPlaceholderText('e.g. Johannesburg') as HTMLInputElement
    expect(cityInput.value).toBe('')

    const provinceSelect = screen.getByRole('combobox') as HTMLSelectElement
    expect(provinceSelect.value).toBe('')
  })

  it('marks isDirty=true via context when a field changes', async () => {
    const { SiteForm } = await import('./SiteForm')
    render(<SiteForm projectId="proj-uuid" initial={{ city: 'Cape Town', province: 'Western Cape' }} />)

    const cityInput = screen.getByPlaceholderText('e.g. Johannesburg')
    await userEvent.clear(cityInput)
    await userEvent.type(cityInput, 'Durban')

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('site')
    })
  })

  it('calls updateProjectAction with the patch on submit', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })

    const { SiteForm } = await import('./SiteForm')
    render(
      <SiteForm
        projectId="proj-uuid"
        initial={{ address: '1 Main St', city: 'Johannesburg', province: 'Gauteng' }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateProjectAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          city: 'Johannesburg',
          province: 'Gauteng',
        }),
      )
    })
  })

  it('shows error banner when action returns { error: "..." }', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { SiteForm } = await import('./SiteForm')
    render(<SiteForm projectId="proj-uuid" initial={{ city: 'Pretoria', province: 'Gauteng' }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })
})
