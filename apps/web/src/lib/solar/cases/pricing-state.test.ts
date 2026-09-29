import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { buildFinanceInput, defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { fakeSupabase } from '@/test/fake-supabase'
import { resolveCaseStatus } from './pricing-state'
import { finInputsHash } from './financials'
import type { RunContextResult, StudyInputs } from './run-context'

const settings = readSolarOrgSettings(null)
const cfg = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })
const fin = {
  ...defaultFinanceConfig(settings),
  capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 2, qualifies12b: true, source: 'manual' }],
}
const kpis = { dcKwp: 500, acKw: 400 }
const E = 'e'.repeat(64), E2 = 'f'.repeat(64)
const OLD_CASE_HASH = 'a'.repeat(64), NEW_CASE_HASH = 'b'.repeat(64)
const tariffRef = { tariffId: 't', tariffName: 'B1', financialYear: '2026/27', licenseeName: 'City' }
const pricing = { escalationPath: { mode: 'published', published: [0.12] }, loadGrowthPct: 2, exportCredited: true }
const shared = { study: { id: 's1' }, tariff: { ok: true, tariffRef, pricing, pricingHash: 'p'.repeat(64) } } as unknown as StudyInputs

const latest = { id: 'r1', status: 'succeeded', inputs_hash: OLD_CASE_HASH, started_at: '2026-09-28T10:00:00Z' }
const lastOk = { ...latest, energy_hash: E }
const ctx = (energyHash: string | null): RunContextResult => ({ ok: true, ctx: { currentHash: NEW_CASE_HASH, energyHash } } as unknown as RunContextResult)

/** The hash a financials-only re-run of r1 on today's pricing would store. */
function currentFinHash(): string {
  const built = buildFinanceInput(fin as never, cfg, kpis, pricing as never)
  if (!built.ok) throw new Error('fixture does not build')
  return finInputsHash(built.input, tariffRef, 'r1', 'p'.repeat(64))
}

const svcWith = (finHash: string | null) => fakeSupabase({ tables: {
  'solar.case_financials': [{ case_id: 'c1', config: fin }],
  'solar.case_runs': [{ id: 'r1', config_snapshot: cfg, outputs: { kpis } }],
  'solar.case_run_financials': finHash ? [{ case_id: 'c1', case_run_id: 'r1', fin_inputs_hash: finHash, created_at: 't' }] : [],
} }).client as never

describe('resolveCaseStatus — Pricing changed vs Stale', () => {
  it('only the pricing moved and the financials were not re-run: Pricing changed', async () => {
    await expect(resolveCaseStatus(svcWith('old'.padEnd(64, '0')), shared, 'c1', latest, lastOk, ctx(E)))
      .resolves.toEqual({ status: 'pricing_changed', label: 'Pricing changed' })
  })
  it('the financials were re-run on today’s pricing: Done', async () => {
    await expect(resolveCaseStatus(svcWith(currentFinHash()), shared, 'c1', latest, lastOk, ctx(E))).resolves.toEqual({ status: 'done', label: 'Done' })
  })
  it('the energy inputs moved: Stale — a financials re-run cannot clear it', async () => {
    await expect(resolveCaseStatus(svcWith(currentFinHash()), shared, 'c1', latest, lastOk, ctx(E2))).resolves.toEqual({ status: 'stale', label: 'Stale' })
  })
  it('a run without a recorded energy hash stays Stale (never guessed as pricing only)', async () => {
    await expect(resolveCaseStatus(svcWith(null), shared, 'c1', latest, latest, ctx(E))).resolves.toEqual({ status: 'stale', label: 'Stale' })
  })
})

describe('resolveCaseStatus — degradation / load shedding edited after the run (YF-01)', () => {
  const edited = { ...cfg, degradation: { firstYearPct: 0.5, annualPct: 0.2 } }
  // The run's inputs hash still matches (these inputs are not in the energy), so caseStatus alone says Done.
  const doneCtx = (config: typeof cfg): RunContextResult => ({ ok: true, ctx: { currentHash: OLD_CASE_HASH, energyHash: E, config } } as unknown as RunContextResult)
  const okRow = { ...lastOk, snap_degradation: cfg.degradation, snap_load_shedding: cfg.loadShedding }
  const finHashFor = (config: typeof cfg) => {
    const built = buildFinanceInput(fin as never, config, kpis, pricing as never)
    if (!built.ok) throw new Error('fixture does not build')
    return finInputsHash(built.input, tariffRef, 'r1', 'p'.repeat(64))
  }
  it('an edit the financials have not priced: Pricing changed', async () => {
    await expect(resolveCaseStatus(svcWith(finHashFor(cfg)), shared, 'c1', latest, okRow, doneCtx(edited)))
      .resolves.toEqual({ status: 'pricing_changed', label: 'Pricing changed' })
  })
  it('financials re-run on the edited values: Done', async () => {
    await expect(resolveCaseStatus(svcWith(finHashFor(edited)), shared, 'c1', latest, okRow, doneCtx(edited))).resolves.toEqual({ status: 'done', label: 'Done' })
  })
  it('no edit: Done', async () => {
    await expect(resolveCaseStatus(svcWith(null), shared, 'c1', latest, okRow, doneCtx(cfg))).resolves.toEqual({ status: 'done', label: 'Done' })
  })
})
