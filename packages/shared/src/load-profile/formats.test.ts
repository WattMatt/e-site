/**
 * E8 "every catalogued format imports with a test fixture". Catalogue (vault, 2026-10-05) of the
 * 2,083 CSVs in 006. METER CSV: A 1,242 · B 476 · B2 230 · C 73 are meter data; D 32 · G 26 · E 2
 * are not. Fixtures: the meter-data corpus (pseudonymised) + a B2 extract kept beside this test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMeterFile } from '../meter-data/parse-meter-file'
import type { SeriesOutcome } from '../meter-data/parse-meter-file'
import { fixture, registerFixture } from '../meter-data/__fixtures__/load'
import { analyseProfile } from './analyse'
import { fromStoredChannel, toStoredChannel } from './channel'
import { measuredReferenceSeries } from './measured'
import { planImport } from './plan-import'
import { importQuality } from './quality'

const b2 = () => {
  const fileName = 'SITE PK, , Meter 39990001, .csv'
  return { bytes: new Uint8Array(readFileSync(join(__dirname, '__fixtures__', fileName))), fileName }
}

const DATA: Array<{ format: string; id: string; load: () => { bytes: Uint8Array; fileName: string }; kw: string; kva: string | null; conversion: RegExp }> = [
  { format: 'A (sep= portal export, p14)', id: 'a-bulk', load: () => fixture('a-bulk'), kw: 'p14', kva: null, conversion: /kW as recorded \(average over 30 min\)/ },
  { format: 'B (PnP power profile)', id: 'b-halfhourly', load: () => fixture('b-halfhourly'), kw: 'P (per kW)', kva: 'S (per kVA)', conversion: /kW as recorded/ },
  { format: 'B2 (PnP bidirectional)', id: 'b2-parkdene', load: b2, kw: 'P1 (per kW)', kva: 'S (per kVA)', conversion: /kW as recorded/ },
  { format: 'C (PnP energy profile)', id: 'c-energy', load: () => fixture('c-energy'), kw: 'P1 (kWh)', kva: 'S (kVAh)', conversion: /kWh per 30 min × 2 → average kW/ },
]

describe.each(DATA)('format $format imports', ({ load, kw, kva, conversion }) => {
  it('plans, stores, builds a profile and a measured MD', async () => {
    const o = await parseMeterFile(load())
    const plan = planImport(o)
    expect(plan.status).toBe('ok')
    if (plan.status !== 'ok') return
    const pick = plan.candidates.find((c) => c.defaultSelected)!
    expect(pick.column).toBe(kw)
    expect(pick.kvaColumn).toBe(kva)
    expect(pick.conversion).toMatch(conversion)

    const series = o as SeriesOutcome
    const ch = series.channels.find((c) => c.spec.sourceColumn === kw)!
    const stored = toStoredChannel(ch.readings, ch.intervalMin)
    const back = fromStoredChannel(stored)
    expect(back).toEqual([...ch.readings].sort((a, b) => a.tsEnd - b.tsEnd))
    const q = importQuality(stored, series.report)
    expect(q.usable).toBeGreaterThan(0)

    const m = measuredReferenceSeries(back, ch.intervalMin, 2025)
    const kvaCh = kva ? series.channels.find((c) => c.spec.sourceColumn === kva)! : null
    const a = analyseProfile({ series: m.series, referenceYear: 2025, powerFactor: 0.95, measured: [{ kw: back, kva: kvaCh?.readings ?? null, intervalMin: ch.intervalMin }], syntheticPeakKw: 0 })
    expect(a.kpis.annualKwh).toBeGreaterThan(0)
    expect(a.md).not.toBeNull()
    expect(a.md!.peak.source).toBe(kva ? 'measured_kva' : 'kw_over_pf')
    expect(a.md!.peak.kva).toBeGreaterThanOrEqual(ch.stats.maxUsable! * (kva ? 0 : 1 / 0.95) - 1e-9)
  })
})

describe('not meter data: refused with the reason', () => {
  it.each([
    ['D escaped copy', () => fixture('d-escaped'), /escaped line breaks/],
    ['E download log', () => fixture('e-log'), /not data/],
    ['F derived column', () => fixture('f-derived'), /derived working column/],
    ['G consolidation summary', () => registerFixture('SITE YA_Consolidation_Summary.csv'), /not data/],
    ['B2 daily export', () => fixture('b-daily'), /Daily totals/],
    ['water meter', () => fixture('a-water'), /water/],
    ['empty file', () => fixture('a-empty'), /no data/],
  ] as const)('%s', async (_n, load, why) => {
    const plan = planImport(await parseMeterFile(load()))
    expect(plan.status).toBe('rejected')
    expect((plan as { message: string }).message).toMatch(why)
  })
})
