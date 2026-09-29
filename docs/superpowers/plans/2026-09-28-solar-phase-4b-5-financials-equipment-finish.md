# Solar Phase 4b — Part 5: Financials tab, equipment catalogue page, Overview/readiness wiring, RBAC matrix, verification, review, PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-4b-0-index.md` first; Parts 1–4 must be done.

**Goal:** `/solar/financials` (capex, opex, four finance models side by side, analysis settings incl. tax/12B, Run financials on stored energy, results table, cashflow chart, XLSX, tornado), `/settings/solar/equipment`, live Overview KPIs + readiness dots, the RBAC matrix rows — then the full verification, two foreground reviewers, push and a draft PR onto `feat/solar-integration`.

**Architecture:** Same shape as Yield: a server loader builds a JSON view model (every result number precomputed server-side from the stored `case_run_financials` row); client components edit inputs and render stored results; actions from Part 3 write.

**Tech Stack:** as Part 4.

---

### Task 30: Financials view model

**Files:**
- Create: `apps/web/src/lib/solar/cases/financials-page-data.ts`
- Test: `apps/web/src/lib/solar/cases/financials-page-data.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ shared: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', () => ({ loadStudyInputs: h.shared, contextForCase: h.ctx }))
import { loadFinancialsPageData } from './financials-page-data'
import { finInputsHash } from './financials'
import { buildFinanceInput } from '@esite/shared/solar-cases'

const P = 'p1', ORG = 'o1', H = 'a'.repeat(64)
const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 100, acKw: 80 })
const fin = { ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 100_000, unit: 'Wp', rateZar: 12, qualifies12b: true, source: 'manual' }] }
const tariffRef = { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' }
const results = {
  capex: { exclVatZar: 1_200_000, vatZar: 180_000, inclVatZar: 1_380_000, zarPerWp: 12 },
  year1Bills: { beforeZar: 876_000, afterZar: 613_200, afterPvOnlyZar: 613_200, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_200_000, npvZar: 900_000, irr: 0.21, simplePaybackYears: 4.6, discountedPaybackYears: 6.2,
    rows: [{ year: 1, energyKwh: 1, billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, opexZar: 21_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 241_800, cumulativeZar: -958_200 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 900_000, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 1_140_000, highNpvZar: 660_000, spreadZar: 480_000 }] },
  engineVersion: '0.1.0',
}
const built = buildFinanceInput(fin as never, cfg, { dcKwp: 100, acKw: 80 })
const tables = (over: Record<string, unknown[]> = {}) => ({
  'solar.cases': [{ id: 'c1', study_id: 's1', project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1' }],
  'solar.case_runs': [{ id: 'r1', case_id: 'c1', project_id: P, status: 'succeeded', inputs_hash: H, started_at: '2026-09-28T09:00:00Z', config_snapshot: cfg, outputs: { kpis: { dcKwp: 100, acKw: 80, batteryKwh: null } } }],
  'solar.case_financials': [{ case_id: 'c1', config: fin, updated_at: 'F1' }],
  'solar.case_run_financials': [{ case_id: 'c1', case_run_id: 'r1', created_at: '2026-09-28T10:00:00Z', engine_version: '0.1.0', tariff_ref: tariffRef, fin_inputs_hash: built.ok ? finInputsHash(built.input, tariffRef, 'r1') : '', results }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.shared.mockResolvedValue({ study: { id: 's1', organisation_id: ORG, selected_case_id: 'c1' }, siteLoad: null, touPeriods: null, tariff: { ok: true, tariffRef } })
  h.ctx.mockResolvedValue({ ok: true, ctx: { currentHash: H, build: { ok: true } } })
})

describe('loadFinancialsPageData', () => {
  it('stored results become display columns (saving precomputed server-side); current → not stale', async () => {
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, undefined)
    expect(d.caseId).toBe('c1')
    expect(d.isDefault).toBe(false)
    expect(d.runReasons).toEqual([])
    expect(d.tariffReason).toBeNull()
    expect(d.financialsStale).toBe(false)
    expect(d.energyStale).toBe(false)
    expect(d.results!.year1).toEqual({ billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, exportCreditUsedZar: 0 })
    expect(d.results!.columns).toEqual([expect.objectContaining({ key: 'cash-owner', label: 'Cash purchase — owner', npvZar: 900_000, irr: 0.21, cumulativeZar: -958_200 })])
    expect(d.results!.tornado.bars[0]).toMatchObject({ variable: 'capex', label: 'Capex' })
  })
  it('a changed saved config makes the stored financials stale; a new run too', async () => {
    const changed = { ...fin, analysis: { ...fin.analysis, discountRatePct: 12 } }
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_financials': [{ case_id: 'c1', config: changed, updated_at: 'F2' }] }) }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(d.financialsStale).toBe(true)
  })
  it('no saved financials → org defaults, flagged, with the reason; no run → reason; no tariff → reason', async () => {
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_financials': [], 'solar.case_runs': [], 'solar.case_run_financials': [] }) }).client as never,
      fakeSupabase({ tables: { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { discount_rate_pct: 10 } } }] } }).client as never, P, 'c1')
    expect(d.isDefault).toBe(true)
    expect(d.config.analysis.discountRatePct).toBe(10)
    expect(d.runReasons).toEqual(['Run the case on Yield & Scenarios first.'])
    h.shared.mockResolvedValueOnce({ study: { id: 's1', organisation_id: ORG, selected_case_id: 'c1' }, siteLoad: null, touPeriods: null, tariff: { ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' } })
    const t = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(t.tariffReason).toBe('No tariff is pinned for this study — pin one on the Tariff tab.')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `financials-page-data.ts`:

```ts
import 'server-only'
/**
 * Financials tab view model (functional spec §8). Every result figure is taken from the latest stored
 * solar.case_run_financials row (read under money RLS) and shaped here, server-side, so the browser only
 * formats. Callers must have passed requireSolarLevel(project, 'edit_financials').
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings } from '@esite/shared'
import { buildFinanceInput, caseStatus, defaultFinanceConfig, parseCaseConfig, parseFinanceConfig, VAT_RATE, type CaseFinanceConfig, type CaseRunOutputs } from '@esite/shared/solar-cases'
import { contextForCase, loadStudyInputs, type CaseRow } from './run-context'
import { runsByCase } from './page-data'
import { FIN_RUN_REASONS, finInputsHash } from './financials'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const MODEL_LABEL: Record<string, string> = { cash: 'Cash purchase', debt: 'Debt-financed', ppa: 'PPA', lease: 'Lease / rent-to-own' }
const TORNADO_LABEL: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }

export interface CashflowRowView { year: number; energyKwh: number; billBeforeZar: number; billAfterZar: number; savingZar: number; opexZar: number; replacementZar: number; taxZar: number; financeZar: number; netZar: number; cumulativeZar: number }
export interface FinancialModelColumn {
  key: string; label: string; upfrontZar: number; npvZar: number; irr: number | null
  simplePaybackYears: number | null; discountedPaybackYears: number | null; cumulativeZar: number; rows: CashflowRowView[]
}
export interface FinancialResultsView {
  computedAt: string; engineVersion: string; tariffLabel: string
  capex: { exclVatZar: number; vatZar: number; inclVatZar: number; zarPerWp: number | null }
  year1: { billBeforeZar: number; billAfterZar: number; savingZar: number; exportCreditUsedZar: number }
  lcoeZarPerKwh: number | null
  columns: FinancialModelColumn[]
  tornado: { title: string; baseNpvZar: number; bars: Array<{ variable: string; label: string; lowNpvZar: number; highNpvZar: number; spreadZar: number }> }
  loadShedding: { year1Zar: number; npvZar: number } | null
}
export interface FinancialsPageData {
  hasStudy: boolean
  cases: Array<{ id: string; name: string; hasRun: boolean }>
  caseId: string | null; caseName: string
  config: CaseFinanceConfig; configUpdatedAt: string | null; isDefault: boolean
  runSize: { dcKwp: number; acKw: number; batteryKwh: number | null } | null
  caseLoadSheddingEnabled: boolean
  runReasons: string[]; tariffReason: string | null
  energyStale: boolean; financialsStale: boolean
  results: FinancialResultsView | null
  vatRate: number
}

export function resultsView(row: Row): FinancialResultsView {
  const r = row.results
  const columns: FinancialModelColumn[] = (r.finance.models as Row[]).flatMap((m) => (m.views as Row[]).map((v) => ({
    key: `${m.model}-${v.view}`, label: `${MODEL_LABEL[m.model] ?? m.model} — ${v.view}`,
    upfrontZar: v.upfrontZar, npvZar: v.npvZar, irr: v.irr ?? null, simplePaybackYears: v.simplePaybackYears ?? null, discountedPaybackYears: v.discountedPaybackYears ?? null,
    cumulativeZar: (v.rows as CashflowRowView[]).at(-1)?.cumulativeZar ?? 0, rows: v.rows as CashflowRowView[],
  })))
  const t = row.tariff_ref ?? {}
  return {
    computedAt: row.created_at, engineVersion: row.engine_version,
    tariffLabel: `${t.licenseeName ?? ''} ${t.tariffName ?? ''} ${t.financialYear ?? ''}`.trim(),
    capex: { exclVatZar: r.capex.exclVatZar, vatZar: r.capex.vatZar, inclVatZar: r.capex.inclVatZar, zarPerWp: r.capex.zarPerWp ?? null },
    year1: { billBeforeZar: r.year1Bills.beforeZar, billAfterZar: r.year1Bills.afterZar, savingZar: r.year1Bills.beforeZar - r.year1Bills.afterZar, exportCreditUsedZar: r.year1Bills.exportCreditUsedZar },
    lcoeZarPerKwh: r.finance.lcoeZarPerKwh ?? null,
    columns,
    tornado: {
      title: `NPV sensitivity (${MODEL_LABEL[r.tornado.model] ?? r.tornado.model} — ${r.tornado.view}), ±20 %`,
      baseNpvZar: r.tornado.baseNpvZar,
      bars: (r.tornado.bars as Row[]).map((b) => ({ variable: b.variable, label: TORNADO_LABEL[b.variable] ?? b.variable, lowNpvZar: b.lowNpvZar, highNpvZar: b.highNpvZar, spreadZar: b.spreadZar })),
    },
    loadShedding: r.finance.loadShedding ? { year1Zar: r.finance.loadShedding.annualZar[0] ?? 0, npvZar: r.finance.loadShedding.npvZar } : null,
  }
}

export async function loadFinancialsPageData(user: AnyClient, svc: AnyClient, projectId: string, caseIdParam: string | undefined): Promise<FinancialsPageData> {
  const empty: FinancialsPageData = { hasStudy: false, cases: [], caseId: null, caseName: '', config: defaultFinanceConfig({}), configUpdatedAt: null, isDefault: true, runSize: null, caseLoadSheddingEnabled: false, runReasons: [], tariffReason: null, energyStale: false, financialsStale: false, results: null, vatRate: VAT_RATE }
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return empty
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at').eq('project_id', projectId)
  const rows = (caseData ?? []) as CaseRow[]
  const { latest, ok } = await runsByCase(user, projectId)
  const cases = rows.map((r) => ({ id: r.id, name: r.name, hasRun: ok.has(r.id) }))
  const caseId = [caseIdParam, shared.study.selected_case_id, cases.find((c) => c.hasRun)?.id, cases[0]?.id].find((id) => id && rows.some((r) => r.id === id)) ?? null
  if (!caseId) return { ...empty, hasStudy: true, cases }
  const row = rows.find((r) => r.id === caseId)!

  const { data: finRows } = await user.schema('solar').from('case_financials').select('config, updated_at').eq('case_id', caseId)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  const parsedFin = finRow ? parseFinanceConfig(finRow.config) : null
  let config: CaseFinanceConfig
  let isDefault = false
  if (parsedFin?.ok) config = parsedFin.fin
  else {
    const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', shared.study.organisation_id).maybeSingle()
    config = defaultFinanceConfig(readSolarOrgSettings((os as Row | null)?.settings ?? null))
    isDefault = true
  }

  const lastOkMeta = ok.get(caseId) ?? null
  let lastOk: Row | null = null
  if (lastOkMeta) {
    const { data } = await user.schema('solar').from('case_runs').select('id, config_snapshot, outputs').eq('id', lastOkMeta.id).maybeSingle()
    lastOk = (data as Row | null) ?? null
  }
  const kpis = (lastOk?.outputs as CaseRunOutputs | undefined)?.kpis
  const snap = lastOk ? parseCaseConfig(lastOk.config_snapshot) : null
  const runReasons: string[] = []
  let currentFinHash: string | null = null
  if (!lastOk || !kpis || !snap?.ok) runReasons.push(FIN_RUN_REASONS.noRun)
  else {
    const built = buildFinanceInput(config, snap.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw })
    if (!built.ok) runReasons.push(...built.reasons)
    else if (shared.tariff.ok) currentFinHash = finInputsHash(built.input, shared.tariff.tariffRef, lastOk.id)
  }
  if (isDefault && lastOk) runReasons.push(FIN_RUN_REASONS.noFinancials)

  const c = await contextForCase(svc, shared, row)
  const last = latest.get(caseId)
  const energyStale = caseStatus(last ? { status: last.status, inputsHash: last.inputs_hash, startedAt: last.started_at } : null,
    lastOkMeta ? { inputsHash: lastOkMeta.inputs_hash } : null, c.ok ? c.ctx.currentHash : null, Date.now()).status === 'stale'

  const { data: resRows } = await user.schema('solar').from('case_run_financials').select('case_id, case_run_id, created_at, engine_version, tariff_ref, fin_inputs_hash, results')
    .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1)
  const res = Array.isArray(resRows) ? (resRows[0] as Row | undefined) : undefined
  const financialsStale = Boolean(res) && (res!.case_run_id !== lastOk?.id || (currentFinHash !== null && res!.fin_inputs_hash !== currentFinHash))
  const caseCfg = parseCaseConfig(row.config)

  return {
    hasStudy: true, cases, caseId, caseName: row.name,
    config, configUpdatedAt: parsedFin?.ok ? (finRow!.updated_at as string) : null, isDefault,
    runSize: kpis ? { dcKwp: kpis.dcKwp, acKw: kpis.acKw, batteryKwh: kpis.batteryKwh ?? null } : null,
    caseLoadSheddingEnabled: caseCfg.ok ? caseCfg.config.loadShedding.enabled : false,
    runReasons, tariffReason: shared.tariff.ok ? null : shared.tariff.reason,
    energyStale, financialsStale,
    results: res ? resultsView(res) : null,
    vatRate: VAT_RATE,
  }
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): Financials view model from stored results").

---

### Task 31: Financials page (editor + results)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/financials/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/financials/FinancialsEditor.tsx` (+ `FinancialsEditor.test.tsx`)
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/financials/FinancialResults.tsx` (+ `FinancialResults.test.tsx`)

- [ ] **Step 1: Failing tests.**

`FinancialsEditor.test.tsx`:
```tsx
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
    expect(screen.getByText('R 12.00/Wp (capex ÷ DC Wp)')).toBeTruthy()
  })
  it('Import BOM from layout is disabled with its reason; Apply org rate card fills lines or names missing rates', async () => {
    h.apply.mockResolvedValueOnce({ error: 'Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).' })
    render(<FinancialsEditor projectId="p1" data={data()} />)
    expect((screen.getByRole('button', { name: 'Import BOM from layout' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Apply org rate card' }))
    await screen.findByText('Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).')
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
  it('Save (first save sends expectedUpdatedAt null); Run financials disabled while dirty or with reasons', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'F2' })
    render(<FinancialsEditor projectId="p1" data={data({ isDefault: true, configUpdatedAt: null, tariffReason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })} />)
    expect((screen.getByRole('button', { name: 'Run financials' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('No tariff is pinned for this study — pin one on the Tariff tab.')).toBeTruthy()
    expect(screen.getByText('Using org defaults — review, then Save.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save financials' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', config: fin, expectedUpdatedAt: null }))
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
```

`FinancialResults.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FinancialResults } from './FinancialResults'
import type { FinancialResultsView } from '@/lib/solar/cases/financials-page-data'

const row = (y: number, net: number, cum: number) => ({ year: y, energyKwh: 1, billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, opexZar: 21_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: net, cumulativeZar: cum })
const view: FinancialResultsView = {
  computedAt: '2026-09-28T10:00:00Z', engineVersion: '0.1.0', tariffLabel: 'City Power Flat 2025/26',
  capex: { exclVatZar: 1_200_000, vatZar: 180_000, inclVatZar: 1_380_000, zarPerWp: 12 },
  year1: { billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, exportCreditUsedZar: 0 },
  lcoeZarPerKwh: 0.95,
  columns: [
    { key: 'cash-owner', label: 'Cash purchase — owner', upfrontZar: 1_200_000, npvZar: 900_000, irr: 0.21, simplePaybackYears: 4.6, discountedPaybackYears: 6.2, cumulativeZar: 3_500_000, rows: [row(1, 241_800, -958_200), row(2, 250_000, -708_200)] },
    { key: 'ppa-client', label: 'PPA — client', upfrontZar: 0, npvZar: 400_000, irr: null, simplePaybackYears: null, discountedPaybackYears: null, cumulativeZar: 1_000_000, rows: [row(1, 50_000, 50_000)] },
  ],
  tornado: { title: 'NPV sensitivity (Cash purchase — owner), ±20 %', baseNpvZar: 900_000, bars: [{ variable: 'capex', label: 'Capex', lowNpvZar: 1_140_000, highNpvZar: 660_000, spreadZar: 480_000 }] },
  loadShedding: { year1Zar: 40_000, npvZar: 250_000 },
}

describe('FinancialResults', () => {
  it('one results column per finance model/view; n/a where there is no IRR', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['KPI', 'Cash purchase — owner', 'PPA — client'])
    expect(screen.getByText('21.0 %')).toBeTruthy()
    expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('R 262 800')).toHaveLength(2)
  })
  it('load-shedding value is a separate line, never in the IRR (D-14)', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(screen.getByText('Load-shedding value (separate, not in IRR): R 40 000 in year 1, NPV R 250 000')).toBeTruthy()
  })
  it('cashflow table switches with the model/view; chart, tornado and XLSX link present', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(screen.getByRole('img', { name: 'Cashflow — Cash purchase — owner' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cashflow for'), { target: { value: 'ppa-client' } })
    expect(screen.getByRole('img', { name: 'Cashflow — PPA — client' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'NPV sensitivity (Cash purchase — owner), ±20 %' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download XLSX' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/financials/xlsx')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`FinancialResults.tsx`:
```tsx
'use client'
/** Stored financial results (functional spec §8 Results + Sensitivity). Formatting only. */
import { useState } from 'react'
import type { FinancialResultsView } from '@/lib/solar/cases/financials-page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { CashflowChart } from '@/components/solar/charts/CashflowChart'
import { TornadoChart } from '@/components/solar/charts/TornadoChart'
import { num, pct, rand, years } from '@/components/solar/format'

export function FinancialResults({ projectId, caseId, view }: { projectId: string; caseId: string; view: FinancialResultsView }) {
  const [key, setKey] = useState(view.columns[0]?.key ?? '')
  const col = view.columns.find((c) => c.key === key) ?? view.columns[0]
  const rows: Array<[string, (c: FinancialResultsView['columns'][number]) => string]> = [
    ['Capex (excl. VAT)', () => rand(view.capex.exclVatZar)],
    ['Upfront (this party)', (c) => rand(c.upfrontZar)],
    ['Year-1 saving', () => rand(view.year1.savingZar)],
    ['Simple payback', (c) => years(c.simplePaybackYears)],
    ['Discounted payback', (c) => years(c.discountedPaybackYears)],
    ['IRR', (c) => (c.irr === null ? 'n/a' : pct(c.irr))],
    ['NPV', (c) => rand(c.npvZar)],
    ['LCOE', () => (view.lcoeZarPerKwh === null ? 'n/a' : `R ${num(view.lcoeZarPerKwh, 2)}/kWh`)],
    ['Cumulative saving', (c) => rand(c.cumulativeZar)],
  ]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card><CardHeader><span className="data-panel-title">Results</span></CardHeader><CardBody>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th scope="col">KPI</th>{view.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row">{label}</th>{view.columns.map((c) => <td key={c.key}>{f(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p style={{ fontSize: 12 }}>Year-1 bill {rand(view.year1.billBeforeZar)} → {rand(view.year1.billAfterZar)} (excl. VAT); export credit used {rand(view.year1.exportCreditUsedZar)}.</p>
        {view.loadShedding && <p>{`Load-shedding value (separate, not in IRR): ${rand(view.loadShedding.year1Zar)} in year 1, NPV ${rand(view.loadShedding.npvZar)}`}</p>}
        <a href={`/api/projects/${projectId}/solar/cases/${caseId}/financials/xlsx`}>Download XLSX</a>
      </CardBody></Card>

      {col && (
        <Card><CardHeader><span className="data-panel-title">Cashflow</span></CardHeader><CardBody>
          <label>Cashflow for <select aria-label="Cashflow for" value={col.key} onChange={(e) => setKey(e.target.value)}>{view.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <CashflowChart title={`Cashflow — ${col.label}`} rows={col.rows.map((r) => ({ year: r.year, netZar: r.netZar, cumulativeZar: r.cumulativeZar }))} />
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{['Year', 'Energy (kWh)', 'Energy saving (R)', 'Opex (R)', 'Replacements (R)', 'Finance (R)', 'Tax (R)', 'Net (R)', 'Cumulative (R)'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{col.rows.map((r) => <tr key={r.year}><td>{r.year}</td><td>{num(r.energyKwh, 0)}</td><td>{num(r.savingZar, 0)}</td><td>{num(r.opexZar, 0)}</td><td>{num(r.replacementZar, 0)}</td><td>{num(r.financeZar, 0)}</td><td>{num(r.taxZar, 0)}</td><td>{num(r.netZar, 0)}</td><td>{num(r.cumulativeZar, 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </CardBody></Card>
      )}

      <Card><CardHeader><span className="data-panel-title">Sensitivity</span></CardHeader><CardBody>
        <TornadoChart title={view.tornado.title} baseNpvZar={view.tornado.baseNpvZar} bars={view.tornado.bars} />
      </CardBody></Card>
      <footer style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Computed {new Date(view.computedAt).toLocaleString('en-ZA')} · engine {view.engineVersion} · tariff {view.tariffLabel}</footer>
    </div>
  )
}
```
The export income and demand saving are inside `savingZar` (the engine prices both bills with the export credit and demand charges) — the column header says "Energy saving (R)" to match spec §8's "energy saving"; the XLSX carries bill before/after per year.

`FinancialsEditor.tsx`:
```tsx
'use client'
/** Financials inputs (functional spec §8). Money inputs; the server validates and computes. */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaseFinanceConfig, CapexLine } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { saveSolarFinancialsAction, applySolarRateCardAction, runSolarFinancialsAction } from '@/actions/solar-financials.actions'
import type { FinancialsPageData } from '@/lib/solar/cases/financials-page-data'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { num, rand } from '@/components/solar/format'
import { Check, NumField, Section } from '../yield/editor-fields'

const CATEGORIES: Array<[CapexLine['category'], string]> = [
  ['modules', 'Modules'], ['inverters', 'Inverters'], ['mounting', 'Mounting'], ['dc_bos', 'DC BOS'], ['ac_bos', 'AC BOS'], ['battery', 'Battery'],
  ['grid_connection', 'Grid connection / protection'], ['civils', 'Civils'], ['labour', 'Labour'], ['design_fees', 'Design & professional fees'],
  ['project_management', 'Project management'], ['contingency', 'Contingency'], ['margin', 'Margin'],
]
const UNITS: CapexLine['unit'][] = ['Wp', 'kWp', 'kW', 'kWh', 'item', 'lot', 'm']

export function FinancialsEditor({ projectId, data }: { projectId: string; data: FinancialsPageData }) {
  const router = useRouter()
  const [cfg, setCfg] = useState<CaseFinanceConfig>(data.config)
  const [saved, setSaved] = useState<CaseFinanceConfig | null>(data.isDefault ? null : data.config)
  const [updatedAt, setUpdatedAt] = useState<string | null>(data.configUpdatedAt)
  const [busy, setBusy] = useState<'save' | 'apply' | 'run' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = useMemo(() => saved === null || JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved])
  useSolarDirtyGuard(saved !== null && dirty)
  const setGroup = <K extends 'opex' | 'analysis' | 'loadShedding'>(k: K, patch: Partial<CaseFinanceConfig[K]>) => setCfg((c) => ({ ...c, [k]: { ...c[k], ...patch } }))
  const setModel = <K extends keyof CaseFinanceConfig['models']>(k: K, patch: Partial<CaseFinanceConfig['models'][K]>) => setCfg((c) => ({ ...c, models: { ...c.models, [k]: { ...c.models[k], ...patch } } }))
  const setLine = (i: number, patch: Partial<CapexLine>) => setCfg((c) => ({ ...c, capex: c.capex.map((l, j) => (j === i ? { ...l, ...patch, source: 'manual' } : l)) }))
  const nn = (v: number | null) => (v === null ? Number.NaN : v)

  // Totals of the INPUT lines (not a result): shown live while editing.
  const excl = cfg.capex.reduce((a, l) => a + l.qty * l.rateZar, 0)
  const wp = data.runSize ? data.runSize.dcKwp * 1000 : 0

  const save = async () => {
    setBusy('save'); setMsg(null); setErrors({})
    const r = await saveSolarFinancialsAction({ projectId, caseId: data.caseId!, config: cfg, expectedUpdatedAt: updatedAt })
    setBusy(null)
    if ('ok' in r) { setSaved(cfg); setUpdatedAt(r.updatedAt); setMsg('Saved.'); router.refresh() }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setMsg(r.error)
  }
  const apply = async () => {
    setBusy('apply'); setMsg(null)
    const r = await applySolarRateCardAction({ projectId, caseId: data.caseId!, config: cfg })
    setBusy(null)
    if ('ok' in r) setCfg(r.config); else if ('fieldErrors' in r) setErrors(r.fieldErrors); else setMsg(r.error)
  }
  const run = async () => {
    setBusy('run'); setMsg(null)
    const r = await runSolarFinancialsAction({ projectId, caseId: data.caseId! })
    setBusy(null)
    if ('ok' in r) router.refresh(); else setMsg(r.error)
  }
  const reasons = [...data.runReasons.filter((r) => !(r === 'Save the financials first.' && !dirty)), ...(data.tariffReason ? [data.tariffReason] : [])]
  const m = cfg.models, o = cfg.opex, a = cfg.analysis

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12 }}>
      <label>Case <select aria-label="Case" value={data.caseId ?? ''} onChange={(e) => router.push(`/projects/${projectId}/solar/financials?case=${e.target.value}`)}>
        {data.cases.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hasRun ? '' : ' (not run)'}</option>)}
      </select></label>
      {data.isDefault && <span>Using org defaults — review, then Save.</span>}

      <Section title="Capex">
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" size="sm" variant="secondary" onClick={() => setCfg((c) => ({ ...c, capex: [...c.capex, { id: `l${Date.now().toString(36)}`, category: 'modules', description: '', qty: 0, unit: 'item', rateZar: 0, qualifies12b: true, source: 'manual' }] }))}>Add line</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={apply}>{busy === 'apply' ? 'Applying…' : 'Apply org rate card'}</Button>
          <Button type="button" size="sm" variant="secondary" disabled title="Arrives with the Layout tab">Import BOM from layout</Button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Category</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate (R)</th><th>Amount (R)</th><th>12B</th><th /></tr></thead>
            <tbody>{cfg.capex.map((l, i) => (
              <tr key={l.id}>
                <td><select aria-label="Category" value={l.category} onChange={(e) => setLine(i, { category: e.target.value as CapexLine['category'] })}>{CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                <td><input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input aria-label="Quantity" type="number" step="any" value={Number.isNaN(l.qty) ? '' : l.qty} onChange={(e) => setLine(i, { qty: e.target.value === '' ? Number.NaN : Number(e.target.value) })} /></td>
                <td><select aria-label="Unit" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as CapexLine['unit'] })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></td>
                <td><input aria-label="Rate (R)" type="number" step="any" value={Number.isNaN(l.rateZar) ? '' : l.rateZar} onChange={(e) => setLine(i, { rateZar: e.target.value === '' ? Number.NaN : Number(e.target.value) })} /></td>
                <td>{num(l.qty * l.rateZar, 0)}</td>
                <td><input type="checkbox" aria-label="Qualifies for 12B" checked={l.qualifies12b} onChange={(e) => setLine(i, { qualifies12b: e.target.checked })} /></td>
                <td><Button type="button" size="sm" variant="secondary" onClick={() => setCfg((c) => ({ ...c, capex: c.capex.filter((_, j) => j !== i) }))}>Delete line</Button></td>
              </tr>))}</tbody>
          </table>
        </div>
        <span>{`Total excl. VAT ${rand(excl)}`}</span>
        <span>{`VAT (${num(data.vatRate * 100, 0)} %) ${rand(excl * data.vatRate)}`}</span>
        <span>{`Total incl. VAT ${rand(excl * (1 + data.vatRate))}`}</span>
        {wp > 0 && <span>{`R ${num(excl / wp, 2)}/Wp (capex ÷ DC Wp)`}</span>}
      </Section>

      <Section title="Opex">
        <label>O&amp;M basis <select aria-label="O&M basis" value={o.omMode} onChange={(e) => setGroup('opex', { omMode: e.target.value as 'per_kwp' | 'pct_capex' })}><option value="per_kwp">R/kWp/yr</option><option value="pct_capex">% of capex per year</option></select></label>
        {o.omMode === 'per_kwp'
          ? <NumField label="O&M" unit="R/kWp/yr" value={o.omZarPerKwpYear} onChange={(v) => setGroup('opex', { omZarPerKwpYear: nn(v) })} />
          : <NumField label="O&M" unit="% of capex/yr" value={o.omPctOfCapex} onChange={(v) => setGroup('opex', { omPctOfCapex: nn(v) })} />}
        <NumField label="Insurance, per year" unit="% of capex" value={o.insurancePctOfCapex} onChange={(v) => setGroup('opex', { insurancePctOfCapex: nn(v) })} />
        <NumField label="Monitoring / data" unit="R/yr" value={o.monitoringZarPerYear} onChange={(v) => setGroup('opex', { monitoringZarPerYear: nn(v) })} />
        <NumField label="Inverter replacement year" unit="year" value={o.inverterReplacementYear} onChange={(v) => setGroup('opex', { inverterReplacementYear: v })} />
        <NumField label="Inverter replacement" unit="% of inverter cost" value={o.inverterReplacementPct} onChange={(v) => setGroup('opex', { inverterReplacementPct: nn(v) })} />
        <NumField label="Battery replacement year" unit="year" value={o.batteryReplacementYear} onChange={(v) => setGroup('opex', { batteryReplacementYear: v })} />
        <NumField label="Battery replacement" unit="% of battery cost" value={o.batteryReplacementPct} onChange={(v) => setGroup('opex', { batteryReplacementPct: nn(v) })} />
        <span>{`Opex escalates with CPI (${num(a.cpiPct, 0)} %/yr)`}</span>
      </Section>

      <Section title="Finance models">
        <Check label="Cash purchase" checked={m.cash.enabled} onChange={(v) => setModel('cash', { enabled: v })} />
        <Check label="Debt-financed" checked={m.debt.enabled} onChange={(v) => setModel('debt', { enabled: v })} />
        {m.debt.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Loan share" unit="%" value={m.debt.loanPct} onChange={(v) => setModel('debt', { loanPct: nn(v) })} />
          <NumField label="Interest rate" unit="%" value={m.debt.ratePct} onChange={(v) => setModel('debt', { ratePct: nn(v) })} />
          <NumField label="Term" unit="years" value={m.debt.termYears} onChange={(v) => setModel('debt', { termYears: nn(v) })} />
          <NumField label="Grace" unit="months" value={m.debt.graceMonths} onChange={(v) => setModel('debt', { graceMonths: nn(v) })} />
        </div>}
        <Check label="PPA" checked={m.ppa.enabled} onChange={(v) => setModel('ppa', { enabled: v })} />
        {m.ppa.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Starting tariff" unit="R/kWh" value={m.ppa.startTariffZarPerKwh} onChange={(v) => setModel('ppa', { startTariffZarPerKwh: nn(v) })} />
          <NumField label="PPA escalation" unit="%/yr" value={m.ppa.escalationPct} onChange={(v) => setModel('ppa', { escalationPct: nn(v) })} />
          <NumField label="PPA term" unit="years" value={m.ppa.termYears} onChange={(v) => setModel('ppa', { termYears: nn(v) })} />
          <NumField label="Buy-out year" unit="year" value={m.ppa.buyoutYear} error={errors['models.ppa.buyoutPriceZar']} onChange={(v) => setModel('ppa', { buyoutYear: v })} />
          <NumField label="Buy-out price" unit="R" value={m.ppa.buyoutPriceZar} onChange={(v) => setModel('ppa', { buyoutPriceZar: v })} />
        </div>}
        <Check label="Lease / rent-to-own" checked={m.lease.enabled} onChange={(v) => setModel('lease', { enabled: v })} />
        {m.lease.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Monthly payment" unit="R" value={m.lease.monthlyPaymentZar} onChange={(v) => setModel('lease', { monthlyPaymentZar: nn(v) })} />
          <NumField label="Lease escalation" unit="%/yr" value={m.lease.escalationPct} onChange={(v) => setModel('lease', { escalationPct: nn(v) })} />
          <NumField label="Lease term" unit="years" value={m.lease.termYears} onChange={(v) => setModel('lease', { termYears: nn(v) })} />
          <NumField label="Residual / transfer value" unit="R" value={m.lease.residualZar} onChange={(v) => setModel('lease', { residualZar: nn(v) })} />
        </div>}
        {errors.models && <span role="alert">{errors.models}</span>}
      </Section>

      <Section title="Analysis settings">
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <NumField label="Analysis period" unit="years" value={a.years} onChange={(v) => setGroup('analysis', { years: nn(v) })} />
          <NumField label="Discount rate" unit="%" value={a.discountRatePct} onChange={(v) => setGroup('analysis', { discountRatePct: nn(v) })} />
          <NumField label="CPI" unit="%" value={a.cpiPct} onChange={(v) => setGroup('analysis', { cpiPct: nn(v) })} />
          <NumField label="Tariff escalation, year 1" unit="%" value={a.escalationStartPct} onChange={(v) => setGroup('analysis', { escalationStartPct: nn(v) })} />
          <NumField label="Tariff escalation, year 10" unit="%" value={a.escalationYear10Pct} onChange={(v) => setGroup('analysis', { escalationYear10Pct: nn(v) })} />
          <NumField label="Tariff escalation after year 10 (CPI plus)" unit="%" value={a.escalationAfterCpiPlusPct} onChange={(v) => setGroup('analysis', { escalationAfterCpiPlusPct: nn(v) })} />
          <NumField label="Load growth" unit="%/yr" value={a.loadGrowthPct} onChange={(v) => setGroup('analysis', { loadGrowthPct: nn(v) })} />
        </div>
        <Check label="Apply company tax" checked={a.taxEnabled} onChange={(v) => setGroup('analysis', { taxEnabled: v, section12b: v ? a.section12b : false })} />
        <NumField label="Company tax rate" unit="%" value={a.companyTaxRatePct} disabled={!a.taxEnabled} onChange={(v) => setGroup('analysis', { companyTaxRatePct: nn(v) })} />
        <Check label="Section 12B accelerated allowance" checked={a.section12b} disabled={!a.taxEnabled} onChange={(v) => setGroup('analysis', { section12b: v })} />
        <span style={{ fontSize: 12 }}>Escalation beyond the published tariff years; the published approved increases arrive with the Tariff tab.</span>
      </Section>

      {data.caseLoadSheddingEnabled && (
        <Section title="Load-shedding value">
          <NumField label="Value of load-shedding avoided" unit="R/kWh" value={cfg.loadShedding.valueZarPerKwh} onChange={(v) => setGroup('loadShedding', { valueZarPerKwh: v })} />
          <span style={{ fontSize: 12 }}>Reported as a separate line, never in the IRR (D-14).</span>
        </Section>
      )}

      {reasons.length > 0 && <ul aria-label="Before financials can run">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {msg && <span role="alert">{msg}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" disabled={busy !== null || !data.caseId || (!dirty && !data.isDefault)} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save financials'}</Button>
        <Button type="button" disabled={busy !== null || dirty || reasons.length > 0} onClick={run}>{busy === 'run' ? 'Computing…' : 'Run financials'}</Button>
      </div>
    </form>
  )
}
```
Test notes: the NumField accessible names are `"<label> (<unit>)"` — e.g. "Insurance, per year (% of capex)", "Company tax rate (%)", "Loan share (%)", "Starting tariff (R/kWh)", "Monthly payment (R)", "Value of load-shedding avoided (R/kWh)". The first-save test: `isDefault` → `saved === null` → dirty → Save enabled; Run disabled (dirty + tariff reason).

`financials/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadFinancialsPageData } from '@/lib/solar/cases/financials-page-data'
import { EmptyState } from '@/components/ui/EmptyState'
import { StaleBanner } from '../../_components/StaleBanner'
import { FinancialsEditor } from './FinancialsEditor'
import { FinancialResults } from './FinancialResults'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Financials (functional spec §8) — Edit + financials only (COST_VIEW legend). */
export default async function SolarFinancialsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ case?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(id, 'edit_financials', supabase)
  const data = await loadFinancialsPageData(supabase, createServiceClient() as unknown as AnyClient, id, sp.case)
  if (!data.hasStudy) return <EmptyState title="Save Site & Supply first" />
  if (!data.caseId) return <EmptyState title="No cases yet" description="Create and run a case on Yield & Scenarios first." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {data.energyStale && <StaleBanner projectId={id} caseId={data.caseId} caseName={data.caseName} canRun />}
      {data.financialsStale && <div role="status">These financials were computed on older inputs — press Run financials to update them.</div>}
      <FinancialsEditor projectId={id} data={data} />
      {data.results ? <FinancialResults projectId={id} caseId={data.caseId} view={data.results} /> : <EmptyState dense title="No financial results yet" description="Save the financials, then press Run financials." />}
    </div>
  )
}
```

- [ ] **Step 3: Run the two component tests — PASS; commit** ("feat(solar): Financials tab — capex, opex, four finance models, tax/12B, results, cashflow, tornado, XLSX").

---

### Task 32: Equipment catalogue page (`/settings/solar/equipment`) + settings page update

**Files:**
- Create: `apps/web/src/app/(admin)/settings/solar/equipment/page.tsx`
- Create: `apps/web/src/app/(admin)/settings/solar/equipment/EquipmentCatalogue.tsx` (+ `EquipmentCatalogue.test.tsx`)
- Modify: `apps/web/src/app/(admin)/settings/solar/page.tsx` (`LATER` list; equipment link)

- [ ] **Step 1: Failing test** `EquipmentCatalogue.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(), retire: vi.fn(), importCsv: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/actions/solar-equipment.actions', () => ({ saveSolarEquipmentAction: h.save, retireSolarEquipmentAction: h.retire, importSolarEquipmentCsvAction: h.importCsv }))
import { EquipmentCatalogue, type EquipmentRowView } from './EquipmentCatalogue'

const rows: EquipmentRowView[] = [
  { id: 'p1', kind: 'module', make: 'Generic', model: 'Mono PERC 550 W', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 }, platform: true, retired: false, source: 'seed', updatedAt: 'T' },
  { id: 'e1', kind: 'module', make: 'Acme', model: 'M-600', specs: { pmaxW: 600, gammaPmaxPctPerC: -0.34 }, platform: false, retired: false, source: 'manual', updatedAt: 'T1' },
  { id: 'e2', kind: 'battery', make: 'Acme', model: 'B-1', specs: { usableKwh: 100, powerKw: 50, rtePct: 90 }, platform: false, retired: true, source: 'csv', updatedAt: 'T1' },
]
const header = 'kind,make,model,pmaxW'
beforeEach(() => vi.clearAllMocks())

describe('EquipmentCatalogue', () => {
  it('lists by kind; platform rows are read-only; retired rows are marked', () => {
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.getByText('E-Site catalogue')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retire' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Batteries' }))
    expect(screen.getByText('Retired')).toBeTruthy()
  })
  it('Retire arms then commits; there is no Delete anywhere', async () => {
    h.retire.mockResolvedValue({ ok: true })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retire Acme M-600?' }))
    await waitFor(() => expect(h.retire).toHaveBeenCalledWith({ id: 'e1' }))
  })
  it('Add module sends kind-specific specs; field errors show', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { pmaxW: 'Number must be greater than or equal to 1' } })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }))
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'M-700' } })
    fireEvent.change(screen.getByLabelText('Pmax (W)'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Temp. coefficient of Pmax (%/°C)'), { target: { value: '-0.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }))
    await screen.findByText('Number must be greater than or equal to 1')
    expect(h.save).toHaveBeenCalledWith({ id: null, kind: 'module', make: 'Acme', model: 'M-700', specs: { pmaxW: 0, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })
  })
  it('CSV import reports per-line errors, or the count added; template download uses the server-given header', async () => {
    h.importCsv.mockResolvedValueOnce({ errors: [{ line: 2, message: 'kind must be module, inverter or battery' }] })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.getByRole('link', { name: 'Download CSV template' }).getAttribute('href')).toBe(`data:text/csv;charset=utf-8,${encodeURIComponent(header + '\n')}`)
    const file = new File(['x'], 'e.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Import from CSV'), { target: { files: [file] } })
    await screen.findByText('Line 2: kind must be module, inverter or battery')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `EquipmentCatalogue.tsx`:

```tsx
'use client'
/** Equipment catalogue (functional spec §11): add, edit, retire (never delete), import from CSV. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { saveSolarEquipmentAction, retireSolarEquipmentAction, importSolarEquipmentCsvAction } from '@/actions/solar-equipment.actions'
import { useArmedConfirm } from '../../../projects/[id]/solar/_components/useArmedConfirm'

type Kind = 'module' | 'inverter' | 'battery'
export interface EquipmentRowView { id: string; kind: Kind; make: string; model: string; specs: Record<string, number | boolean>; platform: boolean; retired: boolean; source: string; updatedAt: string }

const FIELDS: Record<Kind, Array<[string, string]>> = {
  module: [['pmaxW', 'Pmax (W)'], ['vocV', 'Voc (V)'], ['iscA', 'Isc (A)'], ['vmpV', 'Vmp (V)'], ['impA', 'Imp (A)'], ['gammaPmaxPctPerC', 'Temp. coefficient of Pmax (%/°C)'], ['betaVocPctPerC', 'Temp. coefficient of Voc (%/°C)'], ['lengthMm', 'Length (mm)'], ['widthMm', 'Width (mm)']],
  inverter: [['acKw', 'AC rating (kW)'], ['euroEfficiencyPct', 'Euro efficiency (%)'], ['mppts', 'MPPTs'], ['vDcMax', 'Max DC voltage (V)'], ['vMpptMin', 'MPPT min (V)'], ['vMpptMax', 'MPPT max (V)'], ['iMpptMaxA', 'Max current per MPPT (A)']],
  battery: [['usableKwh', 'Usable capacity (kWh)'], ['powerKw', 'Power (kW)'], ['rtePct', 'Round-trip efficiency (%)'], ['warrantyCycles', 'Warranty cycles']],
}
const TABS: Array<[Kind, string]> = [['module', 'Modules'], ['inverter', 'Inverters'], ['battery', 'Batteries']]
const summary = (r: EquipmentRowView) => FIELDS[r.kind].filter(([k]) => r.specs[k] !== undefined).slice(0, 3).map(([k, l]) => `${l.replace(/ \(.*\)/, '')} ${r.specs[k]}`).join(' · ')
const readText = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(f) })

function Editor({ kind, row, onDone }: { kind: Kind; row: EquipmentRowView | null; onDone: () => void }) {
  const [make, setMake] = useState(row?.make ?? ''), [model, setModel] = useState(row?.model ?? '')
  const [specs, setSpecs] = useState<Record<string, string>>(Object.fromEntries(Object.entries(row?.specs ?? {}).map(([k, v]) => [k, String(v)])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const parsed = Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))
    const r = await saveSolarEquipmentAction({ id: row?.id ?? null, kind, make, model, specs: parsed, expectedUpdatedAt: row?.updatedAt ?? null })
    if ('ok' in r) onDone(); else if ('fieldErrors' in r) setErrors(r.fieldErrors); else setError(r.error)
  }
  return (
    <div role="group" aria-label="Equipment editor" style={{ display: 'grid', gap: 6, border: '1px solid var(--c-border, #e5e7eb)', padding: 10, borderRadius: 8 }}>
      <label>Make <input aria-label="Make" value={make} onChange={(e) => setMake(e.target.value)} /></label>
      {errors.make && <span role="alert">{errors.make}</span>}
      <label>Model <input aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} /></label>
      {errors.model && <span role="alert">{errors.model}</span>}
      {FIELDS[kind].map(([k, label]) => (
        <label key={k}>{label} <input aria-label={label} type="number" step="any" value={specs[k] ?? ''} onChange={(e) => setSpecs((s) => ({ ...s, [k]: e.target.value }))} />
          {errors[k] && <span role="alert">{errors[k]}</span>}</label>
      ))}
      {error && <span role="alert">{error}</span>}
      <div style={{ display: 'flex', gap: 6 }}><Button type="button" size="sm" onClick={save}>Save equipment</Button><Button type="button" size="sm" variant="secondary" onClick={onDone}>Cancel</Button></div>
    </div>
  )
}

function Row({ r, onEdit }: { r: EquipmentRowView; onEdit: () => void }) {
  const router = useRouter()
  const confirm = useArmedConfirm()
  const [error, setError] = useState<string | null>(null)
  return (
    <tr>
      <td>{r.make} {r.model}</td><td>{summary(r)}</td>
      <td>{r.platform ? <Badge variant="ghost">E-Site catalogue</Badge> : r.retired ? <Badge variant="warning">Retired</Badge> : <Badge variant="success">Active</Badge>}</td>
      <td>{!r.platform && !r.retired && <>
        <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Edit</Button>{' '}
        <Button type="button" size="sm" variant="secondary" onClick={async () => {
          if (!confirm.armed) return confirm.arm()
          confirm.disarm()
          const res = await retireSolarEquipmentAction({ id: r.id })
          if ('ok' in res) router.refresh(); else setError(res.error)
        }}>{confirm.armed ? `Retire ${r.make} ${r.model}?` : 'Retire'}</Button>
      </>}{error && <span role="alert">{error}</span>}</td>
    </tr>
  )
}

export function EquipmentCatalogue({ rows, csvHeader }: { rows: EquipmentRowView[]; csvHeader: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<Kind>('module')
  const [editing, setEditing] = useState<EquipmentRowView | 'new' | null>(null)
  const [importMsg, setImportMsg] = useState<string[]>([])
  const done = () => { setEditing(null); router.refresh() }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const r = await importSolarEquipmentCsvAction({ text: await readText(f) })
    if ('ok' in r) { setImportMsg([`${r.added} added, ${r.skipped} already in the catalogue.`]); router.refresh() }
    else if ('errors' in r) setImportMsg(r.errors.map((e) => `Line ${e.line}: ${e.message}`))
    else setImportMsg([r.error])
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div role="tablist" style={{ display: 'flex', gap: 6 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setEditing(null) }}>{l}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="button" size="sm" onClick={() => setEditing('new')}>{`Add ${tab}`}</Button>
        <label>Import from CSV <input aria-label="Import from CSV" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvHeader + '\n')}`} download="solar-equipment-template.csv">Download CSV template</a>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>PAN/OND import comes later.</span>
      </div>
      {importMsg.map((m) => <span key={m} role="status">{m}</span>)}
      {editing && <Editor kind={editing === 'new' ? tab : editing.kind} row={editing === 'new' ? null : editing} onDone={done} />}
      <table>
        <thead><tr><th>Equipment</th><th>Key specs</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.filter((r) => r.kind === tab).map((r) => <Row key={r.id} r={r} onEdit={() => setEditing(r)} />)}</tbody>
      </table>
    </div>
  )
}
```
If `@/app/...` relative import of `useArmedConfirm` from a settings route is awkward for lint, move `useArmedConfirm.ts` to `apps/web/src/lib/solar/useArmedConfirm.ts`, re-export it from its old path (`export { useArmedConfirm } from '@/lib/solar/useArmedConfirm'`), and import the new path here.

`equipment/page.tsx`:
```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { EQUIPMENT_CSV_HEADER } from '@esite/shared/solar-cases'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { EquipmentCatalogue, type EquipmentRowView } from './EquipmentCatalogue'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar equipment' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** /settings/solar/equipment (spec §11) — owner/admin; rows read through RLS (org library + platform rows). */
export default async function SolarEquipmentPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs, source, retired_at, updated_at')
    .order('kind').order('make').order('model')
  const rows: EquipmentRowView[] = ((data ?? []) as Array<Record<string, any>>) // eslint-disable-line @typescript-eslint/no-explicit-any
    .filter((r) => r.organisation_id === null || r.organisation_id === ctx.organisationId)
    .map((r) => ({ id: r.id, kind: r.kind, make: r.make, model: r.model, specs: r.specs, platform: r.organisation_id === null, retired: r.retired_at !== null, source: r.source, updatedAt: r.updated_at }))
  return (
    <div className="animate-fadeup" style={{ maxWidth: 1100 }}>
      <Link href="/settings/solar" style={{ fontSize: 11 }}>← Solar defaults</Link>
      <div className="page-header"><h1 className="page-title">Equipment catalogue</h1></div>
      {rows.length === 0 && <p>No equipment visible — the catalogue needs an active Solar subscription.</p>}
      <EquipmentCatalogue rows={rows} csvHeader={EQUIPMENT_CSV_HEADER.join(',')} />
    </div>
  )
}
```

Modify `settings/solar/page.tsx`: remove the `Rate card` and `Equipment catalogue` entries from `LATER` (the rate card now renders as the first section of the form via `SOLAR_SETTING_SECTIONS`), and add under the page header:
```tsx
<p><Link href="/settings/solar/equipment">Equipment catalogue →</Link> Modules, inverters and batteries (add, edit, retire, import from CSV).</p>
```

- [ ] **Step 3: Run tests — PASS; commit** ("feat(solar): equipment catalogue page; rate card live in Solar defaults").

---

### Task 33: Overview KPIs, readiness dots, tab bar

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.tsx` (rewrite) + `OverviewKpis.test.tsx` (rewrite)
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx:53` (readiness) + `layout.test.tsx` (mocks)

- [ ] **Step 1: Replace** `OverviewKpis.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ sel: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ setSelectedSolarCaseAction: h.sel }))
import { OverviewKpis } from './OverviewKpis'
import type { HeadlineKpis } from '@/lib/solar/cases/page-data'

const kpis: HeadlineKpis = {
  caseId: 'c1', caseName: 'Base',
  energy: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.83, solarFraction: 0.58, exportKwh: 140_000 },
  money: { billBeforeZar: 1_000_000, billAfterZar: 600_000, savingZar: 400_000, simplePaybackYears: 4.6, irr: 0.21, npvZar: 2_000_000, lcoeZarPerKwh: 0.95 },
}
const selectable = [{ id: 'c1', name: 'Base' }, { id: 'c2', name: 'Big' }]
beforeEach(() => vi.clearAllMocks())

describe('OverviewKpis (§2.2, §2.4)', () => {
  it('empty state when no case has been run', () => {
    render(<OverviewKpis projectId="p1" level="view" kpis={null} selectable={[]} selectedCaseId={null} studyUpdatedAt={null} stale={false} />)
    expect(screen.getByText('No case has been run yet — start at Site & Supply.')).toBeTruthy()
  })
  it('energy KPIs for everyone; rand values only with money', () => {
    const { rerender } = render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    for (const t of ['500.0 kWp / 400.0 kW', '845.0 MWh (1 690 kWh/kWp)', '83.0 %', '58.0 %', '140.0 MWh', 'R 1 000 000 → R 600 000', 'R 400 000', '4.6 years', '21.0 %', 'R 2 000 000', 'R 0.95/kWh']) expect(screen.getByText(t)).toBeTruthy()
    rerender(<OverviewKpis projectId="p1" level="edit" kpis={{ ...kpis, money: null }} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect(screen.queryByText('R 400 000')).toBeNull()
    expect(screen.queryByText('IRR')).toBeNull()
  })
  it('Change selected case (write) calls the action with the study stale guard', async () => {
    h.sel.mockResolvedValue({ ok: true, updatedAt: 'T1' })
    render(<OverviewKpis projectId="p1" level="edit" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    fireEvent.change(screen.getByLabelText('Change selected case'), { target: { value: 'c2' } })
    await waitFor(() => expect(h.sel).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c2', expectedUpdatedAt: 'T0' }))
    expect(screen.getByRole('link', { name: 'Open case' }).getAttribute('href')).toBe('/projects/p1/solar/yield?case=c1')
  })
  it('Generate feasibility report: cost-view writers only, disabled while stale with the reason', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale />)
    const b = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('The selected case is stale — re-run it first')
  })
})
```

- [ ] **Step 2: Run — FAIL. Rewrite** `OverviewKpis.tsx`:

```tsx
'use client'
/**
 * Headline KPIs of the selected case (spec §2.4) — all from its stored run (and stored financials);
 * never recomputed here. Controls per §2.2; rand values hidden outside Edit + financials.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import type { SolarAccessLevel } from '@esite/shared'
import type { HeadlineKpis } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { setSelectedSolarCaseAction } from '@/actions/solar-cases.actions'
import { mwh, num, pct, rand, years } from '@/components/solar/format'

export function OverviewKpis({ projectId, level, kpis, selectable, selectedCaseId, studyUpdatedAt, stale }: {
  projectId: string; level: SolarAccessLevel; kpis: HeadlineKpis | null
  selectable: Array<{ id: string; name: string }>; selectedCaseId: string | null; studyUpdatedAt: string | null; stale: boolean
}) {
  const router = useRouter()
  const canWrite = level !== 'view'
  const canMoney = level === 'edit_financials'
  const [error, setError] = useState<string | null>(null)
  const e = kpis?.energy, m = kpis?.money
  const items: Array<[string, string]> = e ? [
    ['PV size', `${num(e.dcKwp)} kWp / ${num(e.acKw)} kW`],
    ['Battery', e.batteryKwh === null ? 'None' : `${num(e.batteryKwh)} kWh / ${num(e.batteryKw ?? 0)} kW`],
    ['Year-1 PV yield', `${mwh(e.annualAcKwh)} (${num(e.specificYieldKwhPerKwp, 0)} kWh/kWp)`],
    ['Self-consumption', pct(e.selfConsumption)],
    ['Solar fraction of load', pct(e.solarFraction)],
    ['Export', mwh(e.exportKwh)],
    ...(canMoney && m ? [
      ['Year-1 bill before → after (excl. VAT)', `${rand(m.billBeforeZar)} → ${rand(m.billAfterZar)}`],
      ['Year-1 saving', rand(m.savingZar)],
      ['Simple payback', years(m.simplePaybackYears)],
      ['IRR', m.irr === null ? 'n/a' : pct(m.irr)],
      ['NPV', rand(m.npvZar)],
      ['LCOE', m.lcoeZarPerKwh === null ? 'n/a' : `R ${num(m.lcoeZarPerKwh, 2)}/kWh`],
    ] as Array<[string, string]> : []),
  ] : []
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Headline results{kpis ? ` — ${kpis.caseName}` : ''}</span></CardHeader>
      <CardBody>
        {!kpis
          ? <EmptyState icon={BarChart3} dense title="No case has been run yet — start at Site & Supply." action={<Link href={`/projects/${projectId}/solar/site`}>Go to Site & Supply</Link>} />
          : <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, margin: 0 }}>
              {items.map(([k, v]) => <div key={k}><dt style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>)}
            </dl>}
        {canMoney && kpis && !m && <p style={{ fontSize: 12 }}>Run financials for this case to see rand values.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
          {kpis && <Link href={`/projects/${projectId}/solar/yield?case=${kpis.caseId}`}>Open case</Link>}
          {canWrite && (
            <>
              <label htmlFor="solar-selected-case" style={{ fontSize: 12 }}>Change selected case</label>
              <select id="solar-selected-case" aria-label="Change selected case" disabled={selectable.length === 0 || !studyUpdatedAt} value={selectedCaseId ?? ''}
                onChange={async (ev) => {
                  setError(null)
                  const r = await setSelectedSolarCaseAction({ projectId, caseId: ev.target.value, expectedUpdatedAt: studyUpdatedAt! })
                  if ('ok' in r) router.refresh(); else setError(r.error)
                }}>
                {selectable.length === 0 ? <option value="">No completed runs</option> : <>{!selectedCaseId && <option value="">Choose…</option>}{selectable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
              </select>
              {selectable.length === 0 && <span style={{ fontSize: 12 }}>Run a case on Yield & Scenarios first</span>}
            </>
          )}
          {canMoney && (
            <Button type="button" size="sm" variant="secondary" disabled title={stale ? 'The selected case is stale — re-run it first' : 'Available with Reports & Proposal'}>
              Generate feasibility report
            </Button>
          )}
          {error && <span role="alert">{error}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 3: Wire the Overview page.** In `(gated)/overview/page.tsx`, add imports and data, and replace the readiness + KPI lines:

```tsx
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { loadHeadlineKpis, loadSolarReadinessExtra, runsByCase } from '@/lib/solar/cases/page-data'
// …inside the component, after `level` is known:
  const svc = createServiceClient() as unknown as AnyClient
  const [extra, { data: studyRow }, { data: caseRows }, runs] = await Promise.all([
    loadSolarReadinessExtra(supabase, svc, id, level),
    supabase.schema('solar').from('studies').select('selected_case_id, updated_at').eq('project_id', id).maybeSingle(),
    supabase.schema('solar').from('cases').select('id, name').eq('project_id', id),
    runsByCase(supabase, id),
  ])
  const selectedCaseId = (studyRow as { selected_case_id?: string | null } | null)?.selected_case_id ?? null
  const kpis = await loadHeadlineKpis(supabase, id, level, selectedCaseId)
  const selectable = ((caseRows ?? []) as Array<{ id: string; name: string }>).filter((c) => runs.ok.has(c.id))
// …and in the JSX:
      <ReadinessChecklist projectId={id} steps={computeSolarReadiness(toSiteReadinessInput(study), level, extra)} />
      <OverviewKpis projectId={id} level={level} kpis={kpis} selectable={selectable} selectedCaseId={selectedCaseId}
        studyUpdatedAt={(studyRow as { updated_at?: string } | null)?.updated_at ?? null} stale={extra.stale !== null} />
```

- [ ] **Step 4: Wire the gated layout's tab dots.** In `(gated)/layout.tsx` replace line 53:

```tsx
  const extra = await loadSolarReadinessExtra(supabase, createServiceClient() as unknown as AnyClient, id, level)
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level, extra)
```
with imports `import { createClient, createServiceClient } from '@/lib/supabase/server'` and `import { loadSolarReadinessExtra } from '@/lib/solar/cases/page-data'`. In `layout.test.tsx` add, beside the other mocks:
```tsx
vi.mock('@/lib/solar/cases/page-data', () => ({ loadSolarReadinessExtra: vi.fn(async () => ({ stale: null })) }))
```
and change the supabase mock to `vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: () => ({}) }))`.

- [ ] **Step 5: Run the solar component + page tests — PASS; commit** ("feat(solar): live Overview KPIs and Yield/Financials readiness dots").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar' 2>&1 | tail -5
```

---

### Task 34: RBAC matrix rows

**Files:**
- Modify: `docs/rbac-matrix.md` (Solar route table; Solar server actions; a new "Solar cases, runs and financials API" section; `/settings/solar/equipment` row near line 70)

- [ ] **Step 1: Add route rows** to the Solar table (after the `/solar/site` row; columns: Grantor | Edit + financials | Edit | View | Own-org member, no grant | External member, no grant | supplier / client_viewer):

```markdown
| `/projects/[id]/solar/yield` | W | W | W | R (no controls; no rand values) | → locked | → locked | → locked |
| `/projects/[id]/solar/financials` | W | W | → locked | → locked | → locked | → locked | → locked |
```
Update the note under the table: Yield & Scenarios and Financials now have routes (Phase 4b); Financials is hidden below Edit + financials and its page gate is `requireSolarLevel(project, 'edit_financials')`.

- [ ] **Step 2: Add action rows** to "Solar server actions":

```markdown
| `createSolarCaseAction` / `duplicateSolarCaseAction` / `renameSolarCaseAction` / `deleteSolarCaseAction` (`solar-cases.actions.ts`) | `requireSolarLevel(project, 'edit')`; rename stale-guarded; From-layout refused until Phase 5 | `cases_*` (00216: permissive membership + RESTRICTIVE `solar_can_edit` per verb); `cases_bind` binds study/project/org; unique name per study; deleting the selected case fails on `studies_selected_case_fk` (23503) |
| `setSelectedSolarCaseAction` | `requireSolarLevel(project, 'edit')`; stale-guarded on `studies.updated_at` | `studies_update_authz`; `studies_selected_case_check` (case in this study with a succeeded run, 23514) |
| `saveSolarCaseAction` | `requireSolarLevel(project, 'edit')`; stale-guarded; equipment snapshots re-derived server-side from the catalogue (org or platform rows only); weather id must be the org's | `cases_update_authz` |
| `fetchSolarWeatherAction` | `requireSolarLevel(project, 'edit')` FIRST, then `rateLimit('solar-weather:<org>', 5, 10 min)`; PVGIS + GSA called server-side only | `solar.weather_datasets` has no user write policy or grant — written by the service client after the gate; bucket `solar-weather` service-only |
| `saveSolarFinancialsAction` / `applySolarRateCardAction` / `runSolarFinancialsAction` (`solar-financials.actions.ts`) | `requireSolarLevel(project, 'edit_financials')`; save stale-guarded; rate card read from `org_settings` with the service client (owner/admin-only by RLS) | `case_financials_*` and `case_run_financials_*` on `solar_can_see_money` (SELECT and every write verb); `case_run_financials_bind` requires a succeeded run; no UPDATE/DELETE grant on results |
| `saveSolarEquipmentAction` / `retireSolarEquipmentAction` / `importSolarEquipmentCsvAction` (`solar-equipment.actions.ts`) | `requireRole(active org, OWNER_ADMIN)` (`.ok`); CSV ≤ 512 KB, all-or-nothing on parse errors | `equipment_*_authz` RESTRICTIVE on `solar.library_orgs('admin')` (owner/admin, subscribed); `equipment_bind` refuses platform rows from any user session; no DELETE policy or grant (retire only) |
```

- [ ] **Step 3: Add the API section** after "Solar meter data API (Phase 3a)":

```markdown
### Solar cases, runs and financials API (Phase 4b)

`app/api/*` sits outside `(admin)/layout.tsx`: every route below gates itself with `requireSolarLevelAPI` (JSON 401/403) BEFORE any other work. Run rows are INSERTed through the caller's session (00216 RLS); only the service client finishes a run, and only while it is `running` (`case_runs_freeze`). Both buckets (`solar-runs`, `solar-weather`) have **no** `storage.objects` policy for `authenticated`.

| Route | Needs | Notes |
|---|---|---|
| `POST /api/projects/[id]/solar/cases/[caseId]/run` | Solar Edit | `runtime='nodejs'`, `maxDuration=60`; `rateLimit('solar-run:<user>', 10, 60 s)`; 422 with every blocking reason; 409 when a run is already running (`case_runs_one_running`); a run left running > 90 s is closed as timed out by the next run |
| `POST /api/projects/[id]/solar/cases/[caseId]/cancel` | Solar Edit | flips the case's running run to `cancelled`; the running request then discards its CSV and returns 409 |
| `GET /api/projects/[id]/solar/cases/[caseId]/runs/[runId]/export?kind=hourly\|monthly\|slice` | Solar View | the run row is read through the caller's session (404 if not visible / not succeeded); hourly = stored 8760 CSV, monthly = from stored outputs, slice ≤ 31 days JSON |
| `GET /api/projects/[id]/solar/cases/[caseId]/financials/xlsx` | Solar Edit + financials | latest stored `case_run_financials` row under money RLS; 404 before Run financials |
```

- [ ] **Step 4: Add** `| /settings/solar/equipment | W | W | — | — | — | — | — |` next to the `/settings/solar` row (line ~70), matching that row's columns.

- [ ] **Step 5: Commit** ("docs(rbac): Solar Phase 4b routes, actions and API").

---

### Task 35: Full verification (before anyone reviews)

**Files:** none new.

- [ ] **Step 1: Three suites, type-check, lint, build — all from the worktree root.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check 2>&1 | tail -3
pnpm --filter web type-check 2>&1 | tail -3
pnpm --filter @esite/shared lint 2>&1 | tail -3
pnpm --filter web lint 2>&1 | tail -3
pnpm --filter web build 2>&1 | tail -15
```
Expected: every suite green with counts above the Task 0 baseline; 0 type errors; 0 lint errors; `next build` exit 0 and the route list contains `/projects/[id]/solar/yield`, `/projects/[id]/solar/financials`, `/settings/solar/equipment` and the four new API routes. Any failure: fix at its source and re-run the whole step (do not skip a suite).

- [ ] **Step 2: Re-run the DB proof on the final migration text** (the migration may have been touched during Parts 2–4):

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b; M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql $M/00216_solar_cases.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | grep -c ' t$\|true'
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-foundation-roles.sql scripts/db/assert-solar-meter-data-roles.sql scripts/db/assert-solar-org-settings-roles.sql 2>&1 | grep -iE 'false|error' || echo "earlier Solar assertions still green"
```
Expected: 54 `true`; the earlier Solar assertion files still green with 00216 applied on top (00216 re-declares the product-events CHECK and adds a trigger on `solar.studies` — both must leave 00208/00209/00211 behaviour intact). (If `00214` exists on origin by now, insert it after `00211` in the `cat`.)

- [ ] **Step 3: Contract checks that must have teeth.** Confirm each ran and could fail:
  - `no-browser-engine.contract.test.ts` (mutation shown in Task 29 Step 2).
  - `product-events.contract.test.ts` (red in Task 4 Step 1).
  - `stored-financials.test.ts` equivalence (flip `after.credit` to `before.credit` in `runStoredFinancials`, see it fail, revert).

- [ ] **Step 4: Commit any fixes** ("fix(solar): verification fixes").

---

### Task 36: Two foreground reviewers

**Files:** none new (fixes go to the files they name).

- [ ] **Step 1: Dispatch two reviewers in ONE message, foreground** (`run_in_background: false`), `subagent_type: superpowers:code-reviewer`, each with the base `origin/feat/solar-integration` and head `feat/solar-phase-4b` in the worktree:

Reviewer A — security and data integrity prompt:
```
Review branch feat/solar-phase-4b against origin/feat/solar-integration in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b.
Focus: 00216_solar_cases.sql and every server route/action/lib under apps/web/src/{app/api/projects/[id]/solar/cases,actions/solar-*.actions.ts,lib/solar/cases}.
Check: (1) every route/action gates the Solar level (or OWNER_ADMIN for equipment) BEFORE any other work and before any service-client call; (2) no service-client read/write happens for a project the caller was not gated on; (3) RLS: one PERMISSIVE SELECT per table, RESTRICTIVE write gates per verb, no RESTRICTIVE FOR ALL, FORCE RLS, money tables on solar_can_see_money for SELECT and every write; (4) case_runs cannot be updated by authenticated and are frozen once finished; (5) client-supplied values that could forge results (equipment snapshots, weather id, org ids, statuses) are re-derived or bound server-side; (6) PVGIS/GSA only server-side, rate-limited per org, never in tests; (7) no raw Postgres error reaches a user; (8) anon has nothing; buckets have no user policy; (9) @verify directives are predicates only this migration could satisfy and none uses an em dash in a sql payload; (10) the 00208 schema-wide directives still hold.
Report confirmed defects only, each with file:line, the failing scenario and a proposed fix. Do not edit files.
```

Reviewer B — spec conformance and correctness prompt:
```
Review branch feat/solar-phase-4b against origin/feat/solar-integration in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b.
Spec: docs/solar/01-functional-spec.md §2.3, §2.4, §7, §8, §11; docs/solar/02 §1.3, §3.5, §6, §7; docs/solar/03 §3, §3.1, §3.2; decisions D-05, D-07, D-14, D-15, D-16, D-19 (docs/solar/06-open-decisions.md).
Check: every §7.1/§7.2/§7.3/§8/§11 control exists with the stated behaviour/defaults or is disabled with a stated reason (From layout, Import BOM, measured-weather upload, PAN/OND); every displayed KPI is read from a stored case_runs / case_run_financials row (no browser computation of results); the Stale rule compares the hash of the CURRENT inputs to the last successful run's inputs_hash and the same builder feeds both; runStoredFinancials is equivalent to runFinancials; unit conversions (% ↔ fraction, kW ↔ kWh per interval, R/Wp scale) are right; insurance has no ×12; tax off by default at 27 %; load-shedding never enters IRR; four finance models each get their own results column; readiness rules match §2.3; the plan's decisions in docs/superpowers/plans/2026-09-28-solar-phase-4b-0-index.md are honoured.
Report confirmed defects only, each with file:line, the spec clause, and a proposed fix. Do not edit files.
```

- [ ] **Step 2: Fix every confirmed defect** (TDD: a failing test first where the defect is behavioural), re-run Task 35 Step 1, commit ("fix(solar): review findings — …"). If a finding is rejected, write one line on why in the PR body. If a fix touches the migration, re-run Task 35 Step 2 and the relevant mutation from Task 3.

---

### Task 37: Push and open the draft PR

**Files:** none.

- [ ] **Step 1: Push over SSH** (the gh HTTPS token lacks `workflow` scope; SSH works):

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git push git@github.com:WattMatt/e-site.git feat/solar-phase-4b
```

- [ ] **Step 2: Open the DRAFT PR onto `feat/solar-integration`.** Write the body to a scratch file first, then:

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
cat > /private/tmp/claude-501/solar-4b/pr-body.md <<'EOF'
## Solar Phase 4b — cases & stored runs, Yield & Scenarios, Financials, equipment catalogue, weather

Spec: docs/solar/01 §7, §8, §11, §2.3, §2.4; docs/solar/02 (engine called, not changed); docs/solar/03 §3; D-05/D-07/D-14/D-15/D-16/D-19.
Plan: docs/superpowers/plans/2026-09-28-solar-phase-4b-*.md

### What
- Migration `00216_solar_cases.sql` (claim the number at APPLY time — check ledger, origin/main and open-PR filenames): cases, immutable case_runs (users INSERT running rows; only the service role finishes them; frozen after), per-org PVGIS weather cache, equipment catalogue (platform + org rows, retire never delete), money tables case_financials / case_run_financials on solar_can_see_money, studies.selected_case_id, two service-only buckets, five product events.
- `@esite/shared/solar-cases`: case/finance config schemas, CaseInput builder (named blocking reasons), stored outputs (KPIs, monthly, typical days, daily, loss waterfall, checks, provenance), 8760 CSV, finance input, stored-energy financials (proven identical to runFinancials), tariff bill adapter, case status.
- Routes: run (nodejs, 60 s), cancel, export (hourly/monthly/slice), financials XLSX. Actions: cases, selection, weather (server-side, per-org rate limit), financials, equipment.
- UI: Yield & Scenarios (list, editor with every §7.2 section, results with charts, compare 2–4, stale banner), Financials (capex/opex/four models/tax+12B/results/cashflow/tornado/XLSX), /settings/solar/equipment, live Overview KPIs and readiness dots. Hand-rolled SVG charts (no chart library in E-Site).

### Deliberately not in this PR
- Tariff pinning / TOU calendars (Phase 2b): Financials shows "No tariff is pinned…" and Run financials stays disabled until 2b lands; TOU split and TOU arbitrage likewise.
- From layout / Import BOM (Phase 5; `cases.layout_id` has no FK until the Phase 5 merge adds it); measured-weather upload; PAN/OND import.

### Proof
- DB: `scripts/db/assert-solar-cases-roles.sql` — RED on 00208..00211, GREEN (54/54) with 00216; mutations: <paste the Task 3 ledger>.
- Suites: shared <n> / web <n> / db <n>; type-check 0; lint 0; `next build` exit 0.
- Reviews: two foreground reviewers (security/integrity; spec/correctness) — <findings and fixes>.

### Not verified (needs a signed-in human on a subscribed org)
Create a case → fetch weather → Run → results → Set as selected → Overview KPIs; Financials once a tariff can be pinned.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr create --draft --base feat/solar-integration --head feat/solar-phase-4b \
  --title "Solar Phase 4b: cases, stored runs, Yield & Scenarios, Financials, equipment, weather" \
  --body-file /private/tmp/claude-501/solar-4b/pr-body.md
```
Replace the three `<…>` placeholders in the body with the real numbers from Tasks 3, 35 and 36 BEFORE running `gh pr create`.

- [ ] **Step 3: Confirm** `gh pr view --json isDraft,baseRefName,headRefName,url` shows `isDraft: true`, base `feat/solar-integration`. Report the URL.
