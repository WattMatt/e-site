import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { defaultFinanceConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import type { FinancialsPageData } from '@/lib/solar/cases/financials-page-data'

const h = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), run: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }))
vi.mock('@/actions/solar-financials.actions', () => ({ saveSolarFinancialsAction: h.save, applySolarRateCardAction: h.apply, runSolarFinancialsAction: h.run }))
import { FinancialsEditor } from './FinancialsEditor'

const fin = defaultFinanceConfig(solarOrgSettingDefaults())
const data = (over: Partial<FinancialsPageData> = {}): FinancialsPageData => ({
  hasStudy: true, cases: [{ id: 'c1', name: 'Base', hasRun: true }, { id: 'c2', name: 'Big', hasRun: false }], caseId: 'c1', caseName: 'Base',
  config: fin, configUpdatedAt: 'F1', isDefault: false, runSize: { dcKwp: 100, acKw: 80, batteryKwh: null }, caseLoadSheddingEnabled: false,
  runReasons: [], tariffReason: null, energyStale: false, financialsStale: false, results: null, vatRate: 0.15, ...over,
})
beforeEach(() => vi.clearAllMocks())

describe('FinancialsEditor', () => {
  it('capex: add a line, totals excl./incl. VAT and R/Wp on the correct scale', () => {
    render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
    const row = screen.getAllByRole('row').at(-1)!
    fireEvent.change(within(row).getByLabelText('Quantity'), { target: { value: '100000' } })
    fireEvent.change(within(row).getByLabelText('Rate (R)'), { target: { value: '12' } })
    expect(screen.getByText('Total excl. VAT R 1 200 000')).toBeTruthy()
    expect(screen.getByText('VAT (15 %) R 180 000')).toBeTruthy()
    expect(screen.getByText('Total incl. VAT R 1 380 000')).toBeTruthy()
    expect(screen.getByText('R 12.00/Wp (capex ÷ DC Wp)')).toBeTruthy()
  })
  it('Import BOM from layout is disabled with its reason; Apply org rate card fills lines or names missing rates', async () => {
    h.apply.mockResolvedValueOnce({ error: 'Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).' })
    render(<FinancialsEditor projectId="p1" data={data()} />)
    const bom = screen.getByRole('button', { name: 'Import BOM from layout' }) as HTMLButtonElement
    expect(bom.disabled).toBe(true)
    expect(bom.title).toBe('Arrives with the Layout tab')
    fireEvent.click(screen.getByRole('button', { name: 'Apply org rate card' }))
    await screen.findByText('Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).')
    expect(h.apply).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', config: fin })
  })
  it('Apply org rate card replaces the draft lines (unsaved → Run disabled until Save)', async () => {
    const line = { id: 'r1', category: 'modules' as const, description: 'PV system', qty: 100, unit: 'kWp' as const, rateZar: 12_000, qualifies12b: true, source: 'rate_card' as const }
    h.apply.mockResolvedValueOnce({ ok: true, config: { ...fin, capex: [line] } })
    render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply org rate card' }))
    await screen.findByText('Total excl. VAT R 1 200 000')
    expect((screen.getByRole('button', { name: 'Run financials' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('finance models: any combination, each with its own inputs (D-15); 12B only with tax on (D-16)', () => {
    render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.click(screen.getByLabelText('Debt-financed'))
    fireEvent.click(screen.getByLabelText('PPA'))
    fireEvent.click(screen.getByLabelText('Lease / rent-to-own'))
    for (const l of ['Loan share (%)', 'Interest rate (%)', 'Starting tariff (R/kWh)', 'Monthly payment (R)']) expect(screen.getByLabelText(l)).toBeTruthy()
    expect((screen.getByLabelText('Section 12B accelerated allowance') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Apply company tax'))
    expect((screen.getByLabelText('Section 12B accelerated allowance') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('Company tax rate (%)') as HTMLInputElement).value).toBe('27')
  })
  it('insurance is annual % of capex (no ×12, D-05); opex escalation is shown as CPI', () => {
    render(<FinancialsEditor projectId="p1" data={data()} />)
    expect((screen.getByLabelText('Insurance, per year (% of capex)') as HTMLInputElement).value).toBe('0.5')
    expect(screen.getByText('Opex escalates with CPI (5 %/yr)')).toBeTruthy()
  })
  it('Save (first save sends expectedUpdatedAt null); Run financials disabled with the stated tariff reason', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'F2' })
    render(<FinancialsEditor projectId="p1" data={data({ isDefault: true, configUpdatedAt: null, tariffReason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })} />)
    expect((screen.getByRole('button', { name: 'Run financials' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(screen.getByRole('list', { name: 'Before financials can run' })).getByText('No tariff is pinned for this study — pin one on the Tariff tab.')).toBeTruthy()
    expect(screen.getByText('Using org defaults — review, then Save.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save financials' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', config: fin, expectedUpdatedAt: null }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })
  it('a tariff reason alone keeps Run financials disabled even when saved and clean', () => {
    render(<FinancialsEditor projectId="p1" data={data({ tariffReason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })} />)
    expect((screen.getByRole('button', { name: 'Run financials' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('server field errors and the stale sentence show', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { 'models.ppa.buyoutPriceZar': 'Enter a buy-out price with the buy-out year.' } })
    h.save.mockResolvedValueOnce({ error: 'Someone else saved this first — reload to see their changes.' })
    render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.click(screen.getByLabelText('PPA'))
    fireEvent.click(screen.getByRole('button', { name: 'Save financials' }))
    await screen.findByText('Enter a buy-out price with the buy-out year.')
    fireEvent.click(screen.getByRole('button', { name: 'Save financials' }))
    await screen.findByText('Someone else saved this first — reload to see their changes.')
  })
  it('Run financials refreshes on success', async () => {
    h.run.mockResolvedValue({ ok: true, id: 'f1' })
    render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run financials' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(h.run).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1' })
  })
  it('case select navigates; the load-shedding value appears only when the case enables it', () => {
    const { rerender } = render(<FinancialsEditor projectId="p1" data={data()} />)
    fireEvent.change(screen.getByLabelText('Case'), { target: { value: 'c2' } })
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/financials?case=c2')
    expect(screen.queryByLabelText('Value of load-shedding avoided (R/kWh)')).toBeNull()
    rerender(<FinancialsEditor projectId="p1" data={data({ caseLoadSheddingEnabled: true })} />)
    expect(screen.getByLabelText('Value of load-shedding avoided (R/kWh)')).toBeTruthy()
  })
})
