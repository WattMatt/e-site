// @vitest-environment node
// (jsdom's Blob cannot hand a gzip body back through arrayBuffer(); storage.test.ts does the same.)
import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { encodeHourlyCsv } from '@esite/shared/solar-cases'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'
import { jhbTmyCsv } from '@/lib/solar/cases/__fixtures__/weather'
import { acceptedProposal, INSTALL_REASONS, loadInstallationSeed } from './baseline-loader'

const Z = () => new Float64Array(8760)
const pvAc = Float64Array.from({ length: 8760 }, (_, h) => (h % 24 >= 8 && h % 24 < 16 ? 50 : 0))
const csv = encodeHourlyCsv({ load: Z(), pvAc, selfUse: Z(), import: Z(), export: Z(), curtail: Z(), soc: Z(), importPvOnly: Z(), exportPvOnly: Z() })
const monthly = Array.from({ length: 12 }, (_, k) => ({ month: k + 1, pvKwh: 10_000 + k }))
const config = {
  version: 1,
  pv: { source: 'manual', dcKwp: 100, acKw: 80, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked',
    module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'Acme', model: 'M-500', pmaxW: 500, gammaPmaxPctPerC: -0.35 },
    inverter: { equipmentId: '22222222-2222-4222-8222-222222222222', make: 'Volt', model: 'I-40', acKw: 40, euroEfficiencyPct: 98 } },
  battery: { enabled: false, unit: null, usableKwh: 0, maxDischargeKw: 0 },
  degradation: { firstYearPct: 2, annualPct: 0.45 },
}
const run = { id: 'run-1', status: 'succeeded', inputs_hash: 'h'.repeat(64), hourly_path: 'o/p/c/run-1.csv.gz', weather_dataset_id: 'w1',
  config_snapshot: config, outputs: { kpis: { dcKwp: 100, acKw: 80, performanceRatio: 0.79 }, monthly } }

function svcFor(over: { proposals?: unknown[]; runs?: unknown[]; weatherFails?: boolean } = {}) {
  const download = vi.fn(async (path: string) => {
    if (path === run.hourly_path) return { data: new Blob([gzipSync(csv)]), error: null }
    if (path === 'o/w1.csv.gz' && !over.weatherFails) return { data: new Blob([gzipSync(jhbTmyCsv())]), error: null }
    return { data: null, error: { message: 'not found' } }
  })
  return withStorage(fakeSupabase({ tables: {
    'solar.proposals': (over.proposals ?? [{ id: 'prop-1', version: 2, case_run_id: 'run-1', study_id: 's1', status: 'accepted' }]) as never,
    'solar.case_runs': (over.runs ?? [run]) as never,
    'solar.weather_datasets': [{ id: 'w1', storage_path: 'o/w1.csv.gz' }],
  } }), { download })
}

describe('acceptedProposal', () => {
  it('finds the accepted proposal of the study, or null', async () => {
    await expect(acceptedProposal(svcFor().client as never, 's1')).resolves.toEqual({ id: 'prop-1', version: 2, caseRunId: 'run-1' })
    await expect(acceptedProposal(svcFor({ proposals: [] }).client as never, 's1')).resolves.toBeNull()
  })
})

describe('loadInstallationSeed', () => {
  it('freezes the accepted run into a baseline and seeds the as-built record and degradation', async () => {
    const r = await loadInstallationSeed(svcFor().client as never, 's1')
    if (!r.ok) throw new Error(r.reason)
    expect(r.proposalId).toBe('prop-1')
    expect(r.baseline).toMatchObject({ caseRunId: 'run-1', dcKwp: 100, acKw: 80, performanceRatio: 0.79 })
    expect(r.baseline.monthlyKwh[11]).toBe(10_011)
    expect(r.baseline.diurnalKw[0]![9]).toBe(50)
    expect(r.baseline.ghiKwhM2).toHaveLength(12)
    expect(r.baseline.ghiKwhM2![0]).toBeGreaterThan(100)
    expect(r.asBuilt.equipment).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-500', rating: 500, unit: 'W', quantity: 200 },
      { kind: 'inverter', make: 'Volt', model: 'I-40', rating: 40, unit: 'kW', quantity: 2 },
    ])
    expect(r.degradationPctPerYear).toBe(0.45)
  })
  it('a missing weather file only drops the GHI correction', async () => {
    const r = await loadInstallationSeed(svcFor({ weatherFails: true }).client as never, 's1')
    expect(r.ok && r.baseline.ghiKwhM2).toBeNull()
  })
  it('names why it cannot seed', async () => {
    await expect(loadInstallationSeed(svcFor({ proposals: [] }).client as never, 's1')).resolves.toEqual({ ok: false, reason: INSTALL_REASONS.noAccepted })
    await expect(loadInstallationSeed(svcFor({ runs: [] }).client as never, 's1')).resolves.toEqual({ ok: false, reason: INSTALL_REASONS.runMissing })
    await expect(loadInstallationSeed(svcFor({ runs: [{ ...run, hourly_path: 'gone' }] }).client as never, 's1'))
      .resolves.toEqual({ ok: false, reason: INSTALL_REASONS.runUnreadable })
  })
})
