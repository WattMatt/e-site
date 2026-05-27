import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockUpdateProjectAction = vi.fn()
vi.mock('@/actions/project.actions', () => ({
  updateProjectAction: (...args: unknown[]) => mockUpdateProjectAction(...args),
}))

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

// ─── Test fixtures ────────────────────────────────────────────────────────────

import type { ProjectSettings } from '@esite/shared'
import { projectSettingsDefaults } from '@esite/shared'

const baseProject = {
  contractValue: 1500000,
  currency: 'ZAR',
}

const baseSettings: ProjectSettings = {
  id: 'set-uuid',
  projectId: 'proj-uuid',
  organisationId: 'org-uuid',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  updatedBy: null,
  ...projectSettingsDefaults,
  contractType: 'jbcc_pba',
  contractSignedDate: '2025-03-01',
  practicalCompletionDate: '2026-06-30',
  retentionPct: 5,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders defaults when project and settings are null', async () => {
    const { ContractForm } = await import('./ContractForm')
    render(<ContractForm projectId="proj-uuid" project={null} settings={null} />)

    // Contract value should be empty (null → no value)
    const valueInput = screen.getByPlaceholderText('0.00') as HTMLInputElement
    expect(valueInput.value).toBe('')

    // Retention should show the default (5)
    const retentionInput = screen.getByPlaceholderText('5') as HTMLInputElement
    expect(Number(retentionInput.value)).toBe(projectSettingsDefaults.retentionPct)

    // Contract type should default to 'jbcc_pba'
    const contractTypeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    expect(contractTypeSelect.value).toBe(projectSettingsDefaults.contractType)
  })

  it('marks dirty when contractType changes', async () => {
    const { ContractForm } = await import('./ContractForm')
    render(<ContractForm projectId="proj-uuid" project={baseProject} settings={baseSettings} />)

    const contractTypeSelect = screen.getAllByRole('combobox')[0]
    await userEvent.selectOptions(contractTypeSelect, 'nec4')

    await waitFor(() => {
      expect(mockMarkDirty).toHaveBeenCalledWith('contract')
    })
  })

  it('calls BOTH updateProjectAction and updateProjectSettingsAction on submit with correctly-split patches', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })
    mockUpdateProjectSettingsAction.mockResolvedValueOnce({ settings: baseSettings })

    const { ContractForm } = await import('./ContractForm')
    render(<ContractForm projectId="proj-uuid" project={baseProject} settings={baseSettings} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      // projects.projects patch
      expect(mockUpdateProjectAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          contractValue: 1500000,
          currency: 'ZAR',
        }),
      )
      // project_settings patch
      expect(mockUpdateProjectSettingsAction).toHaveBeenCalledWith(
        'proj-uuid',
        expect.objectContaining({
          contractType: 'jbcc_pba',
          contractSignedDate: '2025-03-01',
          practicalCompletionDate: '2026-06-30',
          retentionPct: 5,
        }),
      )
    })
  })

  it('shows error banner when either action returns { error }', async () => {
    mockUpdateProjectAction.mockResolvedValueOnce({ ok: true })
    mockUpdateProjectSettingsAction.mockResolvedValueOnce({ error: 'Permission denied' })

    const { ContractForm } = await import('./ContractForm')
    render(<ContractForm projectId="proj-uuid" project={baseProject} settings={baseSettings} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Permission denied')
    })
  })
})
