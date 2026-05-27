import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockUpdateProjectSettingsAction = vi.fn()
vi.mock('@/actions/project-settings.actions', () => ({
  updateProjectSettingsAction: (...args: unknown[]) => mockUpdateProjectSettingsAction(...args),
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

// StickySaveBar: always render so we can click Save regardless of isDirty.
// Mirror real StickySaveBar's try/catch so thrown errors don't leak as
// unhandled rejections in the test runner.
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

// ─── Test subjects ────────────────────────────────────────────────────────────

import type { ProjectSettings } from '@esite/shared'
import { projectSettingsDefaults } from '@esite/shared'

// Minimal valid ProjectSettings fixture
const baseSettings: ProjectSettings = {
  id: 'set-uuid',
  projectId: 'proj-uuid',
  organisationId: 'org-uuid',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  updatedBy: null,
  ...projectSettingsDefaults,
  workingDays: [1, 2, 3, 4, 5],
  holidayCalendar: 'ZA',
  buildersHoliday: true,
  extraHolidays: [],
  units: 'metric',
  dateFormat: 'YYYY-MM-DD',
  defaultRfiPriority: 'medium',
  defaultRfiAssigneeId: null,
  defaultRfiDueDays: 7,
  defaultInspectionTemplateId: null,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OperationalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when initial=null', async () => {
    const { OperationalForm } = await import('./OperationalForm')
    render(<OperationalForm projectId="proj-uuid" initial={null} />)

    // Holiday calendar should show the default 'ZA'
    const calInput = screen.getByPlaceholderText('ZA') as HTMLInputElement
    expect(calInput.value).toBe(projectSettingsDefaults.holidayCalendar)

    // Mon chip (day-chip-1) active = aria-pressed true; Sat (day-chip-6) not active
    const monChip = screen.getByTestId('day-chip-1')
    const satChip = screen.getByTestId('day-chip-6')
    expect(monChip.getAttribute('aria-pressed')).toBe('true')
    expect(satChip.getAttribute('aria-pressed')).toBe('false')

    // Default RFI due days
    const dueDaysInput = screen.getByDisplayValue('7') as HTMLInputElement
    expect(Number(dueDaysInput.value)).toBe(projectSettingsDefaults.defaultRfiDueDays)
  })

  it('marks isDirty=true via context when a field changes', async () => {
    const { OperationalForm } = await import('./OperationalForm')
    render(<OperationalForm projectId="proj-uuid" initial={baseSettings} />)

    // Change the holiday calendar text field
    const calInput = screen.getByPlaceholderText('ZA')
    await userEvent.clear(calInput)
    await userEvent.type(calInput, 'GB')

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('operational')
    })
  })

  it('calls updateProjectSettingsAction with the patch on submit', async () => {
    mockUpdateProjectSettingsAction.mockResolvedValueOnce({ settings: baseSettings })

    const { OperationalForm } = await import('./OperationalForm')
    render(<OperationalForm projectId="proj-uuid" initial={baseSettings} />)

    // Click Save (StickySaveBar stub always renders)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateProjectSettingsAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          holidayCalendar: 'ZA',
          workingDays: [1, 2, 3, 4, 5],
          units: 'metric',
          dateFormat: 'YYYY-MM-DD',
          defaultRfiPriority: 'medium',
          defaultRfiDueDays: 7,
          defaultRfiAssigneeId: null,
          extraHolidays: [],
        }),
      )
    })
  })

  it('shows error banner when action returns { error: "..." }', async () => {
    mockUpdateProjectSettingsAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { OperationalForm } = await import('./OperationalForm')
    render(<OperationalForm projectId="proj-uuid" initial={baseSettings} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })
})
