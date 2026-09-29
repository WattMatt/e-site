/**
 * The modelled baseline frozen into an installation at creation (index decision 2). It is what the
 * guarantee, the shaped expectation and the irradiation correction are measured against, so a later
 * case edit, re-run or deletion can never change the guarantee of an operating plant.
 *   monthlyKwh  12 × P50 AC kWh of the accepted run (TMY months; February has 28 days)
 *   diurnalKw   12 × 24 mean PV kW per SAST hour of day (the shape used to value downtime)
 *   ghiKwhM2    12 × TMY GHI kWh/m² (for a GHI-based irradiation correction), or null
 */
import { z } from 'zod'
import { HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'

export const BASELINE_VERSION = 1 as const

export const OpsBaselineSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  caseRunId: z.string().min(1),
  inputsHash: z.string().min(1),
  dcKwp: z.number().finite().positive(),
  acKw: z.number().finite().positive(),
  performanceRatio: z.number().finite().min(0).max(1.5),
  monthlyKwh: z.array(z.number().finite().min(0)).length(12),
  diurnalKw: z.array(z.array(z.number().finite().min(0)).length(24)).length(12),
  ghiKwhM2: z.array(z.number().finite().min(0)).length(12).nullable(),
}).strict()
export type OpsBaseline = z.infer<typeof OpsBaselineSchema>

const r4 = (x: number) => Math.round(x * 10_000) / 10_000
const r2 = (x: number) => Math.round(x * 100) / 100

export function diurnalProfile(pvAc: ArrayLike<number>): number[][] {
  if (pvAc.length !== HOURS_PER_YEAR) throw new Error(`the PV series must have ${HOURS_PER_YEAR} hours`)
  return monthHourRanges().map(({ start, end }) => {
    const sums = new Array<number>(24).fill(0)
    const days = (end - start) / 24
    for (let h = start; h < end; h++) sums[h % 24] = sums[h % 24]! + pvAc[h]!
    return sums.map((s) => r4(s / days))
  })
}

export function monthlyGhiKwhM2(rows: ReadonlyArray<{ month: number; ghi: number }>): number[] {
  const wh = new Array<number>(12).fill(0)
  for (const r of rows) if (r.month >= 1 && r.month <= 12 && Number.isFinite(r.ghi)) wh[r.month - 1] = wh[r.month - 1]! + r.ghi
  return wh.map((v) => r2(v / 1000))
}

export interface BuildBaselineInput {
  caseRunId: string
  inputsHash: string
  kpis: { dcKwp: number; acKw: number; performanceRatio: number }
  monthly: ReadonlyArray<{ month: number; pvKwh: number }>
  pvAc: ArrayLike<number>
  tmyRows: ReadonlyArray<{ month: number; ghi: number }> | null
}

export function buildBaseline(i: BuildBaselineInput): OpsBaseline {
  const byMonth = [...i.monthly].sort((a, b) => a.month - b.month)
  if (byMonth.length !== 12 || byMonth.some((r, k) => r.month !== k + 1)) throw new Error('the run must have twelve monthly rows')
  return OpsBaselineSchema.parse({
    version: BASELINE_VERSION,
    caseRunId: i.caseRunId,
    inputsHash: i.inputsHash,
    dcKwp: i.kpis.dcKwp,
    acKw: i.kpis.acKw,
    performanceRatio: i.kpis.performanceRatio,
    monthlyKwh: byMonth.map((r) => r2(r.pvKwh)),
    diurnalKw: diurnalProfile(i.pvAc),
    ghiKwhM2: i.tmyRows ? monthlyGhiKwhM2(i.tmyRows) : null,
  })
}

export function readBaseline(raw: unknown): OpsBaseline {
  return OpsBaselineSchema.parse(raw)
}
