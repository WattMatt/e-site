import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { RunView } from '@/lib/solar/cases/page-data'
import { RunResults } from './RunResults'

const zeros = () => new Array(24).fill(0)
const run: RunView = {
  id: 'r1', startedAt: '2026-09-28T09:00:00Z', finishedAt: '2026-09-28T09:00:05Z', runByName: 'Arno',
  outputs: {
    version: 1,
    kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_200_000, importBeforeKwh: 1_200_000, importAfterKwh: 500_000, solarFraction: 0.58, selfConsumption: 0.83, peakDemandBeforeKw: 320, peakDemandAfterKw: 290, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 70_000, loadKwh: 100_000, importBeforeKwh: 100_000, importKwh: 42_000, exportKwh: 12_000, maxDemandBeforeKw: 320, maxDemandAfterKw: 290, touImportBefore: null, touImportAfter: null })),
    typicalDays: Array.from({ length: 12 }, (_, m) => (['all', 'weekday', 'saturday', 'sunday'] as const).map((d) => ({ month: m + 1, dayType: d, pv: zeros(), load: zeros(), import: zeros(), export: zeros(), batteryNet: zeros() }))).flat(),
    daily: Array.from({ length: 365 }, (_, d) => ({ day: d, pvKwh: 2300, loadKwh: 3300, importKwh: 1400, exportKwh: 380 })),
    waterfall: [{ key: 'reference', label: 'Nameplate × POA', kwh: 1_000_000, kind: 'start' }, { key: 'dc_losses', label: 'DC losses', kwh: 80_000, kind: 'loss' }, { key: 'ac_output', label: 'AC output', kwh: 845_000, kind: 'end' }],
    checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio', status: 'pass', detail: 'DC/AC ratio 1.25 (expected 1.00 to 1.40).' }, { id: 'string_voltage', label: 'String voltage checks', status: 'n/a', detail: 'String checks need a layout — this case uses a manual system size.' }],
    provenance: { engineVersion: '0.1.0', inputsHash: 'f'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY (PVGIS-SARAH2)', weatherFetchedAt: '2026-09-28T08:00:00Z', gsaPvoutKwhPerKwp: 1712, tariffRef: null, loadBasis: 'S1', loadReferenceYear: 2025 },
  },
}
beforeEach(() => { vi.restoreAllMocks() })

describe('RunResults (every figure from the stored run)', () => {
  it('KPI strip', () => {
    const { container } = render(<RunResults projectId="p1" caseId="c1" run={run} />)
    const kpis = within(container.querySelector('dl')!)
    for (const t of ['1 690 kWh/kWp', '81.0 %', '845.0 MWh', '700.0 MWh', '140.0 MWh', '5.0 MWh', '1 200.0 MWh → 500.0 MWh', '58.0 %', '83.0 %', '320.0 kW → 290.0 kW (hourly)']) expect(kpis.getByText(t)).toBeTruthy()
  })
  it('monthly table has 12 rows, TOU split says why it is empty, and a CSV link to the stored export', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(screen.getByText('TOU split needs a pinned tariff (Tariff tab).')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download monthly CSV' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=monthly')
    expect(screen.getByRole('link', { name: 'Download 8760 CSV' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=hourly')
  })
  it('a pinned tariff shows the P/S/O split columns', () => {
    const tou = { peak: 10_000, standard: 20_000, offPeak: 30_000 }
    const withTou: RunView = { ...run, outputs: { ...run.outputs, monthly: run.outputs.monthly.map((m) => ({ ...m, touImportBefore: tou, touImportAfter: tou })) } }
    render(<RunResults projectId="p1" caseId="c1" run={withTou} />)
    expect(screen.queryByText('TOU split needs a pinned tariff (Tariff tab).')).toBeNull()
    expect(screen.getAllByText('10.0 / 20.0 / 30.0')).toHaveLength(24)
  })
  it('checks and provenance footer', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    expect(screen.getByText('String checks need a layout — this case uses a manual system size.')).toBeTruthy()
    const foot = screen.getByRole('contentinfo')
    for (const t of ['Engine 0.1.0', 'PVGIS TMY (PVGIS-SARAH2)', 'Inputs ffffffffffff', 'Run by Arno', 'No tariff pinned', 'Load S1 2025']) expect(foot.textContent).toContain(t)
  })
  it('the provenance footer says where the TOU hours came from', () => {
    const tariffRef = { tariffId: 't1', tariffName: 'Business TOU', financialYear: '2026/27', licenseeName: 'Midvaal',
      touHours: { source: 'assumed_eskom' as const, calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 0 } }
    render(<RunResults projectId="p1" caseId="c1" run={{ ...run, outputs: { ...run.outputs, provenance: { ...run.outputs.provenance, tariffRef } } }} />)
    const foot = screen.getByRole('contentinfo')
    expect(foot.textContent).toContain('Tariff Midvaal Business TOU 2026/27')
    expect(foot.textContent).toContain("TOU hours assumed equal to Eskom's — confirm against the municipality's by-law (Eskom from 2025-04-01)")
  })
  it('energy-flow month and day-type selects switch the typical day', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Day type'), { target: { value: 'sunday' } })
    expect(screen.getByRole('img', { name: 'Typical Sunday in July' })).toBeTruthy()
  })
  it('zooming the annual chart fetches the stored hourly slice', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rows: [{ hour: 0, startSast: '2025-01-01T00:00+02:00', loadKw: 1, pvAcKw: 0, importKw: 1, exportKw: 0, socKwh: 0 }] })))
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    fireEvent.change(screen.getByLabelText('Zoom from day'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Zoom span'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show hourly' }))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=slice&from=10&to=16'))
    await screen.findByRole('img', { name: 'Hourly, days 11 to 17' })
  })
  it('a refused slice shows the route’s sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'The stored hourly file for this run is missing — re-run the case.' }), { status: 404 }))
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show hourly' }))
    await screen.findByText('The stored hourly file for this run is missing — re-run the case.')
  })
})
