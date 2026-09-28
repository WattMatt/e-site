import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ createClient: vi.fn(async () => ({})), requireSolarLevel: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/tariff/load-tariff-tab', () => ({ loadTariffTab: h.load }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
// The panels' actions are exercised in their own tests; here they must not pull server modules in.
vi.mock('@/actions/solar-tariff.actions', () => ({
  selectSolarTariffAction: vi.fn(), saveSolarExportRuleAction: vi.fn(), saveSolarEscalationAction: vi.fn(),
  createSolarTariffOverrideAction: vi.fn(), revertSolarTariffOverrideAction: vi.fn(), editSolarOverrideChargeAction: vi.fn(),
  recordSolarBillCheckAction: vi.fn(), deleteSolarBillCheckAction: vi.fn(), reportTariffErrorAction: vi.fn(),
  getSolarTariffSourceUrlAction: vi.fn(), setStudyLicenseeAction: vi.fn(),
}))

import SolarTariffPage from './page'
import { netBillingRule } from '@esite/shared'

const base = {
  projectId: 'p1', supply: { nmdKva: 500, supplyVoltageV: 400 }, licenseeOptions: [], years: [], selectedYearId: null, yearNote: null,
  tariffs: [], pinned: null, override: null, exportRates: [], exportSourceNote: null, calendar: null, calendarAssumedEskom: false,
  calendarFromEskomFallback: false, holidays: [], escalation: [], analysisYears: 25, billChecks: [],
}

describe('Solar Tariff page', () => {
  it('asks for Edit + financials', async () => {
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith('p1', 'edit_financials', expect.anything())
    expect(h.load).not.toHaveBeenCalled()
  })
  it('no study: points at Site & Supply', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: null, licensee: null })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('link', { name: 'Save Site & Supply first' }).getAttribute('href')).toBe('/projects/p1/solar/site')
  })
  it('no licensee: the spec sentence, with the library link offered', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: { id: 's1', updatedAt: 'T1', licenseeName: 'Unknown Town', tariffId: null, tariffOverrideId: null, exportRule: null }, licensee: null,
      licenseeOptions: [{ id: 'l1', name: 'City of Probe' }] })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Choose the supply authority on Site & Supply')).toBeDefined()
    expect(screen.getByRole('option', { name: 'City of Probe' })).toBeDefined()
  })
  it('municipal hours assumed from Eskom: the banner', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: { id: 's1', updatedAt: 'T1', licenseeName: 'City of Probe', tariffId: null, tariffOverrideId: null, exportRule: null },
      licensee: { id: 'l1', name: 'City of Probe', kind: 'municipal' },
      calendar: { highSeasonMonths: [6, 7, 8], windows: [], holidayTreatedAs: 'sunday', source: 'assumed_eskom' }, calendarAssumedEskom: true })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByText("TOU hours assumed equal to Eskom's — confirm against the municipality's by-law")).toBeDefined()
  })
  it('hands every client component JSON only (no function props across the server boundary)', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    const sseg = netBillingRule('municipal')
    h.load.mockResolvedValue({ ...base,
      study: { id: 's1', updatedAt: 'T1', licenseeName: 'City of Probe', tariffId: '11111111-1111-1111-1111-111111111111', tariffOverrideId: null, exportRule: null },
      licensee: { id: 'l1', name: 'City of Probe', kind: 'municipal' },
      years: [{ id: 'y25', financialYear: '2025/26', state: 'published', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: null }],
      selectedYearId: 'y25',
      pinned: { id: '11111111-1111-1111-1111-111111111111', name: 'Commercial', code: null, structure: 'flat', isTou: false, yearId: 'y25', financialYear: '2025/26',
        yearState: 'published', charges: [], exportTariff: null, sseg, ssegFromLibrary: false, newerYear: null },
      escalation: [{ year: 2, pct: 8, source: 'default', financialYear: null }],
    })
    const tree = await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) })
    const clientNames = new Set(['TariffPicker', 'ChargesTable', 'OverridePanel', 'ExportRulePanel', 'EscalationTable', 'BillCheckPanel', 'ReportTariffError', 'LinkLicensee'])
    const seen: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object' || !('props' in node)) return
      const el = node as { type: unknown; props: Record<string, unknown> }
      const name = typeof el.type === 'function' ? (el.type as { name: string }).name : null
      if (name && clientNames.has(name)) {
        seen.push(name)
        for (const [k, v] of Object.entries(el.props)) {
          expect(typeof v, `${name}.${k}`).not.toBe('function')
          expect(JSON.parse(JSON.stringify(v ?? null)), `${name}.${k}`).toEqual(v ?? null)
        }
      }
      walk(el.props.children)
    }
    walk(tree)
    expect(seen.sort()).toEqual(['BillCheckPanel', 'ChargesTable', 'EscalationTable', 'ExportRulePanel', 'OverridePanel', 'ReportTariffError', 'TariffPicker'])
  })
})
