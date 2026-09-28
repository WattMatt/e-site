import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_BILLS_FORM } from '@esite/shared'
import { siteProfileCharts, HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn(async () => true), refresh: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ saveLoadSettingsAction: h.save }))
vi.mock('@/lib/solar/load/use-rebuild', async (orig) => ({ ...(await orig<object>()), useRebuild: () => ({ state: { running: false, message: null, error: null, done: null }, run: h.run }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { SiteProfilePanel } from './SiteProfilePanel'
import type { ProfileView } from '@/lib/solar/load/view-types'

const charts = siteProfileCharts(new Float64Array(HOURS_PER_YEAR).fill(10), 2025)
const view: ProfileView = {
  studyId: 's1', studyUpdatedAt: 'T0', diversityApplies: false, years: [2024, 2025],
  form: { loadBasis: 'S2', referenceYear: '', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '' }, bills: EMPTY_BILLS_FORM,
  siteLoad: {
    basis: 'S2', referenceYear: 2025, builtAt: '2025-09-01T10:00:00Z', stale: true, charts, md: [], designMdKw: null,
    coverage: { window: null, commonShare: 1, meetsThreshold: true, metered: 3, synthesised: 1, excluded: 0, unassigned: 0, coveredByChildren: 0, shapeOnlyMeters: [], fullYearFromData: true, peakKw: 42.5, peakSource: 'interval', resolutionMin: 30 },
    bulkRecon: [{ meterId: 'b', label: 'Bulk', months: [{ month: 1, bulkKwh: 1000, tenantsKwh: 850, ratio: 0.85, flagged: true }] }], parentRecon: [],
  },
}
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('SiteProfilePanel', () => {
  it('shows the stale banner, the KPI strip with units and no rand, and the five charts', () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    expect(screen.getByText(/Inputs changed since this profile was built/)).toBeTruthy()
    expect(screen.getByText('87 600 kWh')).toBeTruthy()
    expect(screen.getByText('42.5 kW')).toBeTruthy()
    expect(screen.getByText('50 % / 50 %')).toBeTruthy()
    expect(screen.getByText(/Pin a tariff on the Tariff tab/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\bR\s?\d/)
    for (const t of ['Annual (8,760 hours)', 'Average day by month', 'Weekday / Saturday / Sunday', 'Monthly energy', 'Load duration curve']) {
      expect(screen.getByRole('heading', { name: t })).toBeTruthy()
    }
    expect(screen.getByText('85 %')).toBeTruthy()
  })
  it('diversity is disabled for measured data with the reason', () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    expect((screen.getByLabelText('Diversity factor') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Measured data already reflects diversity')).toBeTruthy()
  })
  it('saves settings on the loaded version, then rebuilds', async () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    await userEvent.selectOptions(screen.getByLabelText('Reference year'), '2024')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', expectedUpdatedAt: 'T0', form: expect.objectContaining({ referenceYear: '2024' }) }))
    expect(h.run).toHaveBeenCalled()
  })
  it('a save refreshes the page; a refreshed study version is what the next save sends', async () => {
    const { rerender } = render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    await userEvent.selectOptions(screen.getByLabelText('Reference year'), '2024')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(h.refresh).toHaveBeenCalled()
    // The Load basis bar (or the Tenants tab) then saved the same study row → T7.
    rerender(<SiteProfilePanel projectId="p1" view={{ ...view, studyUpdatedAt: 'T7', form: { ...view.form, referenceYear: '2024' } }} canEdit />)
    await userEvent.selectOptions(screen.getByLabelText('Reference year'), '2025')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T7', form: expect.objectContaining({ referenceYear: '2025' }) }))
  })
  it('unsaved edits survive a refresh that only moved the version (another control saved), and the save uses the new version', async () => {
    const { rerender } = render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    await userEvent.type(screen.getByLabelText('Load growth'), '2')
    rerender(<SiteProfilePanel projectId="p1" view={{ ...view, studyUpdatedAt: 'T8', form: { ...view.form, loadBasis: 'S4', commonAreaPct: '9' } }} canEdit />)
    expect((screen.getByLabelText('Load growth') as HTMLInputElement).value).toBe('2')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T8', form: expect.objectContaining({ loadGrowthPct: '2' }) }))
  })
  it('the bills section follows the SAVED basis prop, not the form copy', () => {
    const { rerender } = render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    expect(screen.queryByLabelText('January kWh')).toBeNull()
    // The bar saved S4; the refreshed view carries it (same study version seen by this panel is irrelevant).
    rerender(<SiteProfilePanel projectId="p1" view={{ ...view, studyUpdatedAt: 'T9', form: { ...view.form, loadBasis: 'S4' } }} canEdit />)
    expect(screen.getByLabelText('January kWh')).toBeTruthy()
  })
  it('a refused save shows the field sentence and does not rebuild', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { loadGrowthPct: 'Load growth must be between -10 and 20 %/yr' } })
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    await userEvent.type(screen.getByLabelText('Load growth'), '99')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(screen.getByText('Load growth must be between -10 and 20 %/yr')).toBeTruthy()
    expect(h.run).not.toHaveBeenCalled()
  })
  it('the bills table (S4) is kWh and kVA only — never a rand amount', () => {
    render(<SiteProfilePanel projectId="p1" view={{ ...view, form: { ...view.form, loadBasis: 'S4' } }} canEdit={false} />)
    expect(screen.getByLabelText('January kWh')).toBeTruthy()
    expect(screen.getByLabelText('January kVA')).toBeTruthy()
    expect((screen.getByLabelText('January kWh') as HTMLInputElement).disabled).toBe(true)
    expect(document.body.textContent).not.toMatch(/\bR\s?\d|ZAR|rand/i)
  })
  it('an empty study says how to start; View has no save or rebuild', () => {
    render(<SiteProfilePanel projectId="p1" view={{ ...view, siteLoad: null }} canEdit={false} />)
    expect(screen.getByText(/No site profile yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /rebuild/i })).toBeNull()
  })
})
