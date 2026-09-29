import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sel: vi.fn(), tariff: vi.fn(), gz: vi.fn(async () => 'csv'), run: vi.fn(), decode: vi.fn(() => ({ hours: 8760 })) }))
vi.mock('@/lib/solar/reports/selected-case', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/reports/selected-case')>()), loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))
vi.mock('@/lib/solar/cases/storage', () => ({ getGzipText: h.gz, RUNS_BUCKET: 'solar-runs' }))
vi.mock('@esite/shared/solar-cases', async (orig) => ({ ...(await orig<typeof import('@esite/shared/solar-cases')>()), runStoredFinancials: h.run, decodeHourlyCsv: h.decode }))

import { defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { prepareProposalSnapshot, PREPARE_ERRORS } from './prepare'
import { fakeSupabase } from '@/test/fake-supabase'

const STUDY_ESCALATION = { mode: 'published', published: [0.12, 0.1] }

const settings = readSolarOrgSettings(null)
const cfg = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })
const fin = {
  ...defaultFinanceConfig(settings),
  capex: [
    { id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 2, qualifies12b: true, source: 'manual' },
    { id: 'b', category: 'margin', description: 'Old margin line', qty: 1, unit: 'lot', rateZar: 100_000, qualifies12b: false, source: 'manual' },
  ],
  models: { ...defaultFinanceConfig(settings).models, cash: { ...defaultFinanceConfig(settings).models.cash, enabled: true } },
}
const outputs = { kpis: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, deliveredKwh: 840_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.83, solarFraction: 0.58, exportKwh: 140_000 }, provenance: { engineVersion: '0.1.0' } }
const sel = {
  ok: true, shared: { study: { id: 's1', organisation_id: 'o1' } },
  caseRow: { id: 'c1', name: 'Base', pv_source: 'manual', layout_id: null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00Z', inputsHash: 'a'.repeat(64), outputs, configSnapshot: cfg, hourlyPath: 'o1/r1.csv.gz' },
}
const draft = { clientName: 'Acme', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: 'S ≤ Ω', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: 'T', narrative: '' }
const finResult = { year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 1, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_150_000, npvZar: 1, irr: 0.2, simplePaybackYears: 3, discountedPaybackYears: 4, rows: [{ netZar: 390_000, cumulativeZar: -760_000 }] }] }] } }

const args = (over: Record<string, unknown> = {}) => {
  const user = fakeSupabase({ tables: { 'solar.case_financials': [{ case_id: 'c1', config: fin }] } }).client
  const svc = fakeSupabase({ tables: {
    'projects.projects': [{ id: 'p1', name: 'Acme Mall', address: '1 Main Rd', city: null, province: null }],
    'public.organisations': [{ id: 'o1', name: 'Sun Co' }], 'solar.proposal_templates': [{ organisation_id: 'o1', disclaimer_text: 'D' }],
  } }).client
  return {
    user: user as never, svc: svc as never, projectId: 'p1',
    proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft },
    actor: { id: 'u1', name: 'Pat', email: 'pat@sun.example' },
    issuedAt: new Date('2026-09-29T08:00:00.000Z'),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sel.mockResolvedValue(sel)
  h.tariff.mockResolvedValue({
    ok: true, calc: {}, tariffRef: { tariffId: 't', tariffName: 'B1', financialYear: '2026/27', licenseeName: 'City' },
    // The STUDY pricing (I-1): escalation from the Tariff tab, growth from the Load tab, export credit.
    pricing: { escalationPath: STUDY_ESCALATION, loadGrowthPct: 3, exportCredited: false }, pricingHash: 'p'.repeat(64),
  })
  h.run.mockReturnValue(finResult)
})

describe('prepareProposalSnapshot', () => {
  it('prices capex (minus margin lines) + margin, runs finance on the STORED run at the offer price, freezes a sanitised snapshot', async () => {
    const r = await prepareProposalSnapshot(args())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // base = 1 000 000 (modules) — the 100 000 "margin" capex line is excluded; offer = base × 1.15
    expect(r.snapshot.price).toEqual({ offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500 })
    const fi = h.run.mock.calls[0]![1] as { capex: { totalZar: number }; models: Array<{ kind: string }> }
    expect(fi.capex.totalZar).toBe(1_150_000)
    expect(fi.models.map((m) => m.kind)).toEqual(['cash'])
    // Integration fix: the offer is priced on the study pricing, exactly as the Financials run is.
    const analysis = (h.run.mock.calls[0]![1] as { analysis: { loadGrowth: number; escalation: unknown } }).analysis
    expect(analysis.loadGrowth).toBeCloseTo(0.03)
    expect(analysis.escalation).toBe(STUDY_ESCALATION)
    expect((h.run.mock.calls[0]![0] as { exportCredited?: boolean }).exportCredited).toBe(false)
    expect(h.gz).toHaveBeenCalledWith(expect.anything(), 'solar-runs', 'o1/r1.csv.gz')
    expect(r.snapshot.bills).toEqual({ beforeZar: 1_000_000, afterZar: 600_000, savingZar: 400_000 })
    expect(r.snapshot.proposal.validUntil).toBe('2026-10-29T08:00:00.000Z')
    expect(r.snapshot.text.summary).toBe('S <= Ohm')
    expect(r.snapshot.issuer).toEqual({ orgName: 'Sun Co', proposerName: 'Pat', proposerEmail: 'pat@sun.example' })
    expect(r.runId).toBe('r1')
    expect(JSON.stringify(r.snapshot)).not.toContain('marginPct')
  })
  it('refuses when the selected case is Stale', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    await expect(prepareProposalSnapshot(args())).resolves.toEqual({ ok: false, error: 'The selected case is stale — re-run it first.' })
  })
  it('refuses when the draft’s case is no longer the selected case', async () => {
    await expect(prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c-other', draft } })))
      .resolves.toEqual({ ok: false, error: PREPARE_ERRORS.caseChanged })
  })
  it('names an offered model with no inputs on the case', async () => {
    await expect(prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft: { ...draft, financeOptions: ['cash', 'lease'] } } })))
      .resolves.toEqual({ ok: false, error: 'Enable Lease / rent-to-own on the Financials tab first — its inputs live there.' })
  })
  it('passes the tariff reason through (Run financials needs a pinned tariff)', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(prepareProposalSnapshot(args())).resolves.toEqual({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
  it('returns field errors for an incomplete draft', async () => {
    const r = await prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft: { ...draft, clientName: '' } } }))
    expect(r).toMatchObject({ ok: false, error: PREPARE_ERRORS.incomplete, fieldErrors: { clientName: 'Enter the client name' } })
  })
})
