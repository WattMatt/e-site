/**
 * Synthetic load when no meter data exists. Tenant schedule = area × density × archetype shape
 * (the Solar S3 model, reused unchanged: expandArchetype + synthesiseTenant + buildS3). ADMD block =
 * N consumers × after-diversity maximum demand, shaped by an archetype so its peak hour equals
 * N × ADMD × PF (ADMD already carries the diversity of N consumers, so no further factor applies).
 */
import { CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, expandArchetype, getArchetype, type ArchetypeCode } from '../services/solar/load/archetypes'
import { HOURS_PER_YEAR } from '../services/solar/load/calendar'
import { buildS3 } from '../services/solar/load/site-series'
import { synthesiseTenant } from '../services/solar/load/synthesis'
import type { ShopCategory } from '../services/generator-cost-recovery/types'

export interface TenantSynthInput {
  label: string
  areaM2: number | null
  category: ShopCategory | null
  archetype?: ArchetypeCode | null
  densityWPerM2?: number | null
  boDate?: string | null
}
export interface TenantSynthLine { label: string; archetype: ArchetypeCode; densityWPerM2: number; areaM2: number; annualKwh: number; peakKw: number }
export interface TenantScheduleResult { series: Float64Array; lines: TenantSynthLine[]; skipped: Array<{ label: string; reason: string }> }

const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0)
const max = (a: Float64Array) => a.reduce((m, v) => (v > m ? v : m), 0)

export function tenantScheduleSeries(tenants: TenantSynthInput[], referenceYear: number, opts: { commonAreaPct: number }): TenantScheduleResult {
  const shapes = new Map<ArchetypeCode, Float64Array>()
  const shapeOf = (code: ArchetypeCode) => {
    let s = shapes.get(code)
    if (!s) shapes.set(code, (s = expandArchetype(getArchetype(code), referenceYear)))
    return s
  }
  const lines: TenantSynthLine[] = []
  const skipped: TenantScheduleResult['skipped'] = []
  const synths: Float64Array[] = []
  for (const t of tenants) {
    if (!(t.areaM2 && t.areaM2 > 0)) { skipped.push({ label: t.label, reason: 'no shop area' }); continue }
    const category: ShopCategory = t.category ?? 'other'
    const archetype = t.archetype ?? CATEGORY_ARCHETYPE[category]
    const densityWPerM2 = t.densityWPerM2 ?? DEFAULT_DENSITY_W_PER_M2[category]
    const s = synthesiseTenant({ areaM2: t.areaM2, densityWPerM2, shape: shapeOf(archetype), boDate: t.boDate ?? null }, referenceYear)
    synths.push(s)
    lines.push({ label: t.label, archetype, densityWPerM2, areaM2: t.areaM2, annualKwh: sum(s), peakKw: max(s) })
  }
  const series = synths.length ? buildS3({ synths, commonAreaPct: opts.commonAreaPct }) : new Float64Array(HOURS_PER_YEAR)
  return { series, lines, skipped }
}

export interface AdmdInput { units: number; admdKva: number; powerFactor: number; archetype: ArchetypeCode }

export function admdSeries(input: AdmdInput, referenceYear: number): Float64Array {
  const { units, admdKva, powerFactor, archetype } = input
  if (!(units > 0) || !(admdKva > 0)) throw new RangeError('ADMD needs a positive number of units and a positive ADMD')
  if (!(powerFactor > 0 && powerFactor <= 1)) throw new RangeError(`powerFactor ${powerFactor} must be in (0, 1]`)
  const shape = expandArchetype(getArchetype(archetype), referenceYear)
  const peak = max(shape)
  if (peak <= 0) throw new RangeError(`archetype ${archetype} has no load`)
  const k = (units * admdKva * powerFactor) / peak
  return shape.map((v) => v * k)
}

export function sumSeries(parts: ArrayLike<number>[]): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR)
  for (const p of parts) {
    if (p.length !== HOURS_PER_YEAR) throw new RangeError(`sumSeries: expected ${HOURS_PER_YEAR} hours, got ${p.length}`)
    for (let i = 0; i < HOURS_PER_YEAR; i++) out[i] += p[i]
  }
  return out
}
