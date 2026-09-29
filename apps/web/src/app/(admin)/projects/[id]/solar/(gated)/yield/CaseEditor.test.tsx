import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import type { CaseEditorData } from '@/lib/solar/cases/page-data'

const h = vi.hoisted(() => ({ save: vi.fn(), weather: vi.fn(), run: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), source: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ saveSolarCaseAction: h.save, fetchSolarWeatherAction: h.weather, setSolarCasePvSourceAction: h.source }))
vi.mock('../../_components/runCase', () => ({ postRun: h.run, postCancel: h.cancel }))
import { CaseEditor } from './CaseEditor'

const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const data = (over: Partial<CaseEditorData> = {}): CaseEditorData => ({
  caseId: 'c1', name: 'Base', updatedAt: 'T1', config: cfg, buildReasons: [], pvSource: 'manual', layoutId: null, layoutDrift: null, status: 'done', statusLabel: 'Done', running: false,
  weather: { id: 'w1', latRound: -26.2, lngRound: 28.05, fetchedAt: '2026-09-28T10:00:00Z', radiationDb: 'PVGIS-SARAH2', gsaPvoutKwhPerKwp: 1712 },
  studyExport: { mode: 'net_billing', limitKw: 100 },
  siteLoad: { basis: 'S1', referenceYear: 2025, annualKwh: 876_000, peakKw: 180 },
  tariffNote: null, defaultLosses: { racked: cfg.losses, flush: { ...cfg.losses, shadingPct: 1 } }, lastRun: null, ...over,
})
const MOD = '11111111-1111-4111-8111-111111111111'
const equipment = { modules: [{ id: MOD, make: 'Generic', model: 'M', retired: false, specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 } }], inverters: [], batteries: [] }
beforeEach(() => vi.clearAllMocks())

describe('CaseEditor', () => {
  it('renders every §7.2 section; From layout disabled with no usable layout; DC/AC shown as derived', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    for (const s of ['PV system', 'Losses', 'Degradation', 'Weather', 'Battery', 'Grid / export', 'Load', 'Load-shedding value']) expect(screen.getByRole('group', { name: s })).toBeTruthy()
    expect((screen.getByLabelText('From layout') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('DC/AC ratio 1.25 (derived)')).toBeTruthy()
    expect(screen.getByText('Inherited: net billing, export limit 100 kW')).toBeTruthy()
    expect(screen.getByText('S1 load, reference year 2025: 876.0 MWh/yr, peak 180.0 kW')).toBeTruthy()
    expect(screen.getByText(/GSA 1 712 kWh\/kWp/)).toBeTruthy()
  })

  it('View users get a read-only form and no buttons', () => {
    render(<CaseEditor projectId="p1" level="view" data={data()} equipment={equipment} />)
    expect((screen.getByLabelText('DC size (kWp)') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save case' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fetch PVGIS weather' })).toBeNull()
  })

  it('editing enables Save and disables Run ("Save first"); Save sends the config with expectedUpdatedAt', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.change(screen.getByLabelText('Soiling (%)'), { target: { value: '3' } })
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Save first — Run uses the saved inputs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    const arg = h.save.mock.calls[0]![0]
    expect(arg).toMatchObject({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T1' })
    expect(arg.config.losses.soilingPct).toBe(3)
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })

  it('a field error from the server renders beside its field; a stale save shows the sentence', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { 'pv.dcKwp': 'DC size must be at least 0.1 kWp' } })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.change(screen.getByLabelText('DC size (kWp)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await screen.findByText('DC size must be at least 0.1 kWp')
    h.save.mockResolvedValueOnce({ error: 'Someone else saved this case — reload to see their changes.' })
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await screen.findByText('Someone else saved this case — reload to see their changes.')
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('the export override offers "Export earns credit" (Yes, no credit) while export is allowed', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    expect(screen.queryByLabelText('Export earns credit')).toBeNull()
    fireEvent.click(screen.getByLabelText('Override for this case'))
    const credit = screen.getByLabelText('Export earns credit') as HTMLInputElement
    expect(credit.checked).toBe(true)
    fireEvent.click(credit)
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0].config.grid).toMatchObject({ overrideExport: true, exportAllowed: true, exportCredited: false })
    fireEvent.click(screen.getByLabelText('Export allowed'))
    expect((screen.getByLabelText('Export earns credit') as HTMLInputElement).disabled).toBe(true)
  })
  it.each([
    ['no_credit', 250, { exportAllowed: true, exportLimitKw: 250, exportCredited: false }],
    ['net_billing', null, { exportAllowed: true, exportLimitKw: null, exportCredited: true }],
    ['zero_export', null, { exportAllowed: false, exportLimitKw: null, exportCredited: true }],
  ] as const)('turning Override on seeds the export fields from the inherited study export (%s)', async (mode, limitKw, expected) => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    // The case config carries the opposite of what the study says, so an unseeded override would show.
    const stale = { ...cfg, grid: { ...cfg.grid, overrideExport: false, exportAllowed: mode === 'zero_export', exportLimitKw: 999, exportCredited: mode !== 'net_billing' ? true : false } }
    render(<CaseEditor projectId="p1" level="edit" data={data({ config: stale, studyExport: { mode, limitKw } })} equipment={equipment} />)
    fireEvent.click(screen.getByLabelText('Override for this case'))
    expect((screen.getByLabelText('Export allowed') as HTMLInputElement).checked).toBe(expected.exportAllowed)
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0].config.grid).toMatchObject({ overrideExport: true, ...expected })
  })
  it('turning Override off and on again with no inherited mode keeps what was entered', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    const own = { ...cfg, grid: { ...cfg.grid, overrideExport: false, exportAllowed: true, exportLimitKw: 42, exportCredited: false } }
    render(<CaseEditor projectId="p1" level="edit" data={data({ config: own, studyExport: { mode: null, limitKw: null } })} equipment={equipment} />)
    fireEvent.click(screen.getByLabelText('Override for this case'))
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0].config.grid).toMatchObject({ overrideExport: true, exportAllowed: true, exportLimitKw: 42, exportCredited: false })
  })
  it('picking a module stores the catalogue snapshot', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.change(screen.getByLabelText('Module type'), { target: { value: MOD } })
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0].config.pv.module).toEqual({ equipmentId: MOD, make: 'Generic', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 })
  })

  it('blocking reasons are listed and disable Run', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data({ buildReasons: ['Build the site load on the Load tab first.'] })} equipment={equipment} />)
    expect(screen.getByText('Build the site load on the Load tab first.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Run posts, shows Running with a Cancel, and refreshes when done', async () => {
    let finish: (v: unknown) => void = () => {}
    h.run.mockReturnValue(new Promise((r) => { finish = r }))
    h.cancel.mockResolvedValue({ ok: true })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    expect(h.cancel).toHaveBeenCalledWith('p1', 'c1')
    finish({ ok: false, error: 'The run was cancelled.' })
    await screen.findByText('The run was cancelled.')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('a case already running (from the server) offers Cancel run and no Run', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data({ running: true, status: 'running', statusLabel: 'Running' })} equipment={equipment} />)
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy()
  })

  it('Fetch weather sets the dataset (dirty) and shows the fetch date', async () => {
    h.weather.mockResolvedValue({ ok: true, dataset: { id: '33333333-3333-4333-8333-333333333333', fetchedAt: '2026-09-29T08:00:00Z', radiationDb: 'PVGIS-SARAH3', latRound: -26.2, lngRound: 28.05, gsaPvoutKwhPerKwp: null, cached: false } })
    render(<CaseEditor projectId="p1" level="edit" data={data({ weather: null })} equipment={equipment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch PVGIS weather' }))
    await screen.findByText(/PVGIS-SARAH3/)
    expect(screen.getByText(/fetched 2026-09-29/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save case' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Grid charging is only offered for TOU arbitrage; Discard asks twice and restores', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    const battery = screen.getByRole('group', { name: 'Battery' })
    fireEvent.click(within(battery).getByLabelText('Battery enabled'))
    expect((within(battery).getByLabelText('Allow grid charging') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(within(battery).getByLabelText('Strategy'), { target: { value: 'tou-arbitrage' } })
    expect((within(battery).getByLabelText('Allow grid charging') as HTMLInputElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard all changes?' }))
    expect((within(screen.getByRole('group', { name: 'Battery' })).getByLabelText('Battery enabled') as HTMLInputElement).checked).toBe(false)
  })
  it('From layout links the case through its own action and refreshes; the sizes are then locked to the layout', async () => {
    h.source.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    const layouts = [{ id: 'L1', name: 'Roof A', moduleCount: 182, dcKwp: 100.1 }]
    const { unmount } = render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} layouts={layouts} />)
    fireEvent.click(screen.getByLabelText('From layout'))
    await waitFor(() => expect(h.source).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T1', source: { kind: 'layout', layoutId: 'L1' } }))
    expect(h.refresh).toHaveBeenCalled()
    unmount()
    render(<CaseEditor projectId="p1" level="edit" data={data({ pvSource: 'layout', layoutId: 'L1' })} equipment={equipment} layouts={layouts} />)
    expect((screen.getByLabelText('DC size (kWp)') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('AC size (kW)') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/DC and AC size come from Roof A/)).toBeTruthy()
  })
  it('switching the PV source is refused while the draft has unsaved changes', async () => {
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} layouts={[{ id: 'L1', name: 'Roof A', moduleCount: 1, dcKwp: 1 }]} />)
    fireEvent.change(screen.getByLabelText('Tilt (°)'), { target: { value: '20' } })
    fireEvent.click(screen.getByLabelText('From layout'))
    await screen.findByText('Save or discard your changes first.')
    expect(h.source).not.toHaveBeenCalled()
  })
  it('a linked case says when its layout has changed and Refresh from layout re-sizes it from the same layout', async () => {
    h.source.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseEditor projectId="p1" level="edit" data={data({ pvSource: 'layout', layoutId: 'L1', layoutDrift: { dcKwp: 495, acKw: 400 } })} equipment={equipment} layouts={[{ id: 'L1', name: 'Roof A', moduleCount: 900, dcKwp: 495 }]} />)
    expect(screen.getByText('Roof A has changed since this case was sized from it: it is now 495 kWp DC / 400 kW AC. Refresh to use it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from layout' }))
    await waitFor(() => expect(h.source).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T1', source: { kind: 'layout', layoutId: 'L1' } }))
  })
})
