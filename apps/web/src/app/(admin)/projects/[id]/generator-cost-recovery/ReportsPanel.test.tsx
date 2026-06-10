import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GcrReportRevisionRow, GcrSettingsRow, TenantNodeRow } from '@esite/shared'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const getUrlMock = vi.fn()
const deleteMock = vi.fn()
vi.mock('./gcr-reports.actions', () => ({
  getGcrReportUrlAction: (...args: unknown[]) => getUrlMock(...args),
  deleteGcrReportRevisionAction: (...args: unknown[]) => deleteMock(...args),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

const REVISION: GcrReportRevisionRow = {
  id: 'rev-1',
  project_id: PROJECT_ID,
  organisation_id: 'org-1',
  revision_number: 3,
  storage_path: 'org-1/proj/generator-cost-recovery/x.pdf',
  file_name: 'mall-generator-cost-recovery-rev3.pdf',
  note: null,
  summary: {
    monthlyCapitalRepayment: 65710.68,
    finalTariff: 6.6,
    totalCapitalCost: 4455360,
    tenantCount: 70,
  },
  created_by: 'user-1',
  created_at: '2026-06-10T08:00:00Z',
}

const READY_SETTINGS = { standard_kw_per_sqm: 0.03 } as unknown as GcrSettingsRow
const READY_ZONES = [{ id: 'z1', zone_name: 'North', zone_number: 1, display_order: 0 }]
const READY_GENERATORS = [{ id: 'g1', zone_id: 'z1', generator_number: 1, generator_size: '250 kVA', generator_cost: 1 }]
const READY_TENANTS: TenantNodeRow[] = [
  { id: 't1', shop_number: 'T01', shop_name: 'Alpha', shop_area_m2: 100, shop_category: 'standard', generator_participation: 'shared' },
]

function renderPanel(overrides: Partial<Parameters<typeof import('./ReportsPanel').ReportsPanel>[0]> = {}) {
  return import('./ReportsPanel').then(({ ReportsPanel }) =>
    render(
      <ReportsPanel
        projectId={PROJECT_ID}
        revisions={[REVISION]}
        settings={READY_SETTINGS}
        zones={READY_ZONES}
        generators={READY_GENERATORS}
        tenants={READY_TENANTS}
        {...overrides}
      />,
    ),
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReportsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the revision list with rev number and summary numbers', async () => {
    await renderPanel()
    expect(screen.getByText('Rev 3')).toBeDefined()
    expect(screen.getByText(REVISION.file_name)).toBeDefined()
    expect(screen.getByText(/65[\s,]?710[.,]68/)).toBeDefined()
  })

  it('disables Generate and lists gaps when data is not ready', async () => {
    await renderPanel({ settings: null, zones: [], generators: [] })
    const btn = screen.getByRole('button', { name: /generate report/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText('Generator settings not configured')).toBeDefined()
    expect(screen.getByText('No generator zones configured')).toBeDefined()
  })

  it('enables Generate when data is ready', async () => {
    await renderPanel()
    const btn = screen.getByRole('button', { name: /generate report/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('View fetches an inline URL and opens the contained viewer with an iframe', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/inline.pdf' })
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined()
    })
    expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, REVISION.id)
    const iframe = screen.getByTitle(/Rev 3/) as HTMLIFrameElement
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe.src).toBe('https://signed.example/inline.pdf')
  })

  it('Preview draft opens in the contained viewer modal (no new tab)', async () => {
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /preview draft/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined()
    })
    const iframe = screen.getByTitle(/Draft/) as HTMLIFrameElement
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe.src).toContain(`/api/projects/${PROJECT_ID}/generator-cost-recovery/report-preview`)
    // No anchor pointing at the preview route remains (the old new-tab path)
    expect(document.querySelector('a[target="_blank"]')).toBeNull()
  })

  it('Download requests the attachment disposition', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/dl.pdf' })
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, REVISION.id, { download: true })
    })
  })

  it('Delete requires confirmation and refreshes on success', async () => {
    deleteMock.mockResolvedValue({ ok: true })
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(PROJECT_ID, REVISION.id)
      expect(refreshMock).toHaveBeenCalled()
    })
  })
})
