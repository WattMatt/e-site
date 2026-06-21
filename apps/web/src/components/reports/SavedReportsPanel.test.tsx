import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectReportRow } from '@/actions/project-reports.actions'

const getUrlMock = vi.fn()
const deleteMock = vi.fn()
const listMock = vi.fn()
vi.mock('@/actions/project-reports.actions', () => ({
  listProjectReportsAction: (...a: unknown[]) => listMock(...a),
  getProjectReportUrlAction: (...a: unknown[]) => getUrlMock(...a),
  deleteProjectReportAction: (...a: unknown[]) => deleteMock(...a),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

const ROW: ProjectReportRow = {
  id: 'rep-3', project_id: PROJECT_ID, organisation_id: 'org-1',
  kind: 'tenant_schedule', title: 'Tenant Schedule Report',
  storage_path: 'org-1/proj/tenant-schedule-v3.pdf', mime_type: 'application/pdf',
  size_bytes: 1000, status: 'issued', version: 3, generated_by: 'u1',
  generated_at: '2026-06-20T08:00:00Z', created_at: '2026-06-20T08:00:00Z',
}

function renderPanel(overrides: Partial<Parameters<typeof import('./SavedReportsPanel').SavedReportsPanel>[0]> = {}) {
  return import('./SavedReportsPanel').then(({ SavedReportsPanel }) =>
    render(<SavedReportsPanel projectId={PROJECT_ID} kind="tenant_schedule" reports={[ROW]} canManage {...overrides} />),
  )
}

describe('SavedReportsPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the empty state when there are no reports', async () => {
    await renderPanel({ reports: [] })
    expect(screen.getByText(/no saved reports yet/i)).toBeDefined()
  })

  it('renders a row with version label and status', async () => {
    await renderPanel()
    expect(screen.getByText('v3')).toBeDefined()
    expect(screen.getByText(/issued/i)).toBeDefined()
  })

  it('Preview opens the viewer with an inline signed URL', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/inline.pdf' })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3')
    const iframe = screen.getByTitle(/v3/) as HTMLIFrameElement
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe.src).toBe('https://signed.example/inline.pdf')
  })

  it('Download requests the attachment disposition', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/dl.pdf' })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3', { download: true }))
  })

  it('Delete requires confirmation then calls the action and refreshes', async () => {
    deleteMock.mockResolvedValue({ ok: true })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3')
      expect(refreshMock).toHaveBeenCalled()
    })
  })

  it('hides Delete when canManage is false', async () => {
    await renderPanel({ canManage: false })
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })

  it('self-loads (source-scoped) when reports is omitted, and defaults canManage to true', async () => {
    listMock.mockResolvedValue([ROW])
    const { SavedReportsPanel } = await import('./SavedReportsPanel')
    render(<SavedReportsPanel projectId={PROJECT_ID} kind="inspection" source={{ table: 'inspections', id: 'i1' }} />)

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(PROJECT_ID, 'inspection', { table: 'inspections', id: 'i1' }),
    )
    expect(await screen.findByText('v3')).toBeDefined()
    // canManage defaults to true → Delete visible
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDefined()
  })
})
