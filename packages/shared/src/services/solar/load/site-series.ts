/**
 * Site series by basis (engine spec §2.3). Hourly kW over the reference year. Energy is never
 * scaled by diversity (§2.5); S4's kVA step is an energy-preserving affine stretch about the
 * monthly mean (owner decision 5, 2026-09-28). A billed peak below the monthly mean would need a
 * negative stretch (the shape inverted), so that month is left unchanged and warned.
 */
import { HOURS_PER_YEAR, monthOf, referenceYearDates } from './calendar'

export type LoadBasis = 'S1' | 'S2' | 'S3' | 'S4'

export class LoadModelError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'LoadModelError'
  }
}

function monthIndex(referenceYear: number): Int8Array {
  const idx = new Int8Array(HOURS_PER_YEAR)
  referenceYearDates(referenceYear).forEach((d, di) => idx.fill(monthOf(d), di * 24, di * 24 + 24))
  return idx
}

export function monthlyEnergyKwh(series: Float64Array, referenceYear: number): number[] {
  const m = monthIndex(referenceYear)
  const out = Array(12).fill(0) as number[]
  for (let h = 0; h < series.length; h++) if (!Number.isNaN(series[h])) out[m[h] - 1] += series[h]
  return out
}

export function buildS1(input: { bulk: Float64Array; supplyPointConfirmed: boolean; existingPv?: Float64Array | null }): Float64Array {
  if (!input.supplyPointConfirmed) {
    throw new LoadModelError('supply_point_not_confirmed', 'A meter labelled bulk is used as the site supply only after the user confirms it is the point of supply.')
  }
  const out = Float64Array.from(input.bulk)
  if (input.existingPv) for (let h = 0; h < out.length; h++) out[h] += input.existingPv[h]
  return out
}

export function reconcileMonthly(bulkKwh: number[], tenantsKwh: number[]): Array<{ month: number; bulkKwh: number; tenantsKwh: number; ratio: number | null }> {
  return bulkKwh.map((b, i) => ({ month: i + 1, bulkKwh: b, tenantsKwh: tenantsKwh[i], ratio: b > 0 ? tenantsKwh[i] / b : null }))
}

export interface S2Tenant {
  meters?: Array<{ series: Float64Array; weight: number }>
  synth?: Float64Array
}

function checkCommonArea(pct: number): void {
  if (!(pct >= 0 && pct <= 100)) throw new LoadModelError('invalid_common_area', 'The common-area allowance must be between 0 and 100 %.')
}

export function buildS2(input: { tenants: S2Tenant[]; commonAreaPct: number }): Float64Array {
  checkCommonArea(input.commonAreaPct)
  const out = new Float64Array(HOURS_PER_YEAR)
  for (const t of input.tenants) {
    if (t.meters && t.meters.length > 0) {
      for (const m of t.meters) {
        if (!(m.weight > 0)) throw new LoadModelError('invalid_weight', 'A meter weight must be greater than 0.')
        for (let h = 0; h < out.length; h++) out[h] += m.weight * m.series[h]
      }
    } else if (t.synth) {
      for (let h = 0; h < out.length; h++) out[h] += t.synth[h]
    } else {
      throw new LoadModelError('tenant_without_basis', 'Every tenant needs a load basis: meters or a synthesised series.')
    }
  }
  const f = 1 + input.commonAreaPct / 100
  for (let h = 0; h < out.length; h++) out[h] *= f
  return out
}

export function buildS3(input: { synths: Float64Array[]; commonAreaPct: number }): Float64Array {
  return buildS2({ tenants: input.synths.map((synth) => ({ synth })), commonAreaPct: input.commonAreaPct })
}

export function buildS4(input: {
  shape: Float64Array
  monthlyKwh: number[]
  monthlyKva?: Array<number | null>
  powerFactor?: number
  referenceYear: number
}): { series: Float64Array; warnings: string[] } {
  if (input.monthlyKwh.length !== 12) throw new LoadModelError('invalid_bills', 'Twelve monthly kWh values are required.')
  const pf = input.powerFactor ?? 0.95
  const m = monthIndex(input.referenceYear)
  const out = new Float64Array(HOURS_PER_YEAR)
  const warnings: string[] = []
  for (let month = 1; month <= 12; month++) {
    const hours: number[] = []
    for (let h = 0; h < HOURS_PER_YEAR; h++) if (m[h] === month) hours.push(h)
    const shapeSum = hours.reduce((s, h) => s + input.shape[h], 0)
    if (!(shapeSum > 0)) throw new LoadModelError('flat_zero_shape', `The shape has no energy in month ${month}.`)
    const kwh = input.monthlyKwh[month - 1]
    const scale = kwh / shapeSum
    for (const h of hours) out[h] = input.shape[h] * scale
    const kva = input.monthlyKva?.[month - 1]
    if (kva === null || kva === undefined) continue
    const mean = kwh / hours.length
    const peak = Math.max(...hours.map((h) => out[h]))
    if (peak - mean < 1e-9) {
      warnings.push(`month ${month}: the shape is flat, so the billed peak cannot be applied; left unchanged`)
      continue
    }
    const target = kva * pf
    if (target < mean) {
      // A negative stretch factor would turn the month's shape upside down (peaks become troughs).
      warnings.push(`month ${month}: billed kVA below average demand; check PF/kVA (billed ${target.toFixed(2)} kW, mean ${mean.toFixed(2)} kW); left unchanged`)
      continue
    }
    const s = (target - mean) / (peak - mean)
    let clamped = false
    for (const h of hours) {
      const y = mean + (out[h] - mean) * s
      if (y < 0) clamped = true
      out[h] = Math.max(0, y)
    }
    if (clamped) {
      const e = hours.reduce((acc, h) => acc + out[h], 0)
      for (const h of hours) out[h] *= kwh / e
      const achieved = Math.max(...hours.map((h) => out[h]))
      warnings.push(`month ${month}: the peak transform produced negative hours; clamped and energy re-scaled; peak achieved ${achieved.toFixed(2)} kW (billed ${target.toFixed(2)} kW)`)
    }
  }
  return { series: out, warnings }
}
