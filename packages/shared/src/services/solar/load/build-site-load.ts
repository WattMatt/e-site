/**
 * The site-load builder (engine spec §2.2–§2.6; functional spec §4.2, §4.5, §13.3). A pure composition
 * of the 3a library: per-meter reference series, tenant synthesis, the per-basis site series,
 * maximum demand, reconciliation and the double-count guard. The server gathers rows and readings,
 * calls this once, and stores the result in solar.site_load. The browser never runs it.
 */
import { isUsable, type Reading } from '../../../meter-data/types'
import type { ShopCategory } from '../../generator-cost-recovery/types'
import { latestWindow, type SourceWindow } from './align'
import { CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, expandArchetype, getArchetype, type ArchetypeCode, type ArchetypeShapeDef } from './archetypes'
import { HOURS_PER_YEAR } from './calendar'
import { chooseCommonWindow, DEFAULT_COMMON_WINDOW } from './common-window'
import { designMaxDemandSynth } from './diversity'
import { descendants, doubleCountGuard, reconcileParents, supplyChildren, RECONCILIATION_TOLERANCE, type MeterLine, type ParentReconciliation } from './hierarchy'
import { completeDays, readingsToDailyHours } from './hourly'
import { monthlyMaxDemand, monthlyMaxDemandFromHourly } from './max-demand'
import { buildS1, buildS2, buildS4, LoadModelError, monthlyEnergyKwh, type LoadBasis, type S2Tenant } from './site-series'
import { shapeFromSample, synthesiseTenant } from './synthesis'
import { meterReferenceSeries } from './tenant-series'

export const SITE_LOAD_ENGINE_VERSION = '3b.1'
/** Never load (functional spec §4.3 "Meter kind"). */
export const LOAD_EXCLUDED_KINDS = ['solar', 'generator', 'check', 'water'] as const

export type BuildMeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export interface ChannelData { readings: Reading[]; intervalMin: number }
export interface BuildMeter {
  meterId: string
  label: string
  kind: BuildMeterKind
  supplyPointConfirmed: boolean
  serials: string[]
  /** The primary active-power channel (kW), or null when none is imported. */
  primary: ChannelData | null
  /** A measured apparent-power channel (kVA) from the same export, for maximum demand. */
  kva: ChannelData | null
  /** meters.existing_pv_channel_id: generation to add back under S1 (engine §2.3). */
  existingPv: ChannelData | null
}
export type TenantSource = 'metered' | 'synthesised' | 'excluded' | 'unassigned'
export interface BuildTenant {
  nodeId: string
  label: string
  areaM2: number | null
  category: ShopCategory | null
  source: TenantSource
  meters: Array<{ meterId: string; weight: number }>
  archetype: ArchetypeCode | null
  densityOverrideWPerM2: number | null
  boDate: string | null
}
export interface MonthlyBills { archetype: ArchetypeCode; powerFactor: number; months: Array<{ kwh: number; kva: number | null }> }
export interface BuildSiteLoadInput {
  basis: LoadBasis
  referenceYear: number | null
  /** Used when neither the study nor the data names a year (pure synthesis). */
  fallbackYear: number
  commonAreaPct: number
  diversityFactor: number
  tenants: BuildTenant[]
  meters: BuildMeter[]
  lines: MeterLine[]
  bills: MonthlyBills | null
  densities?: Partial<Record<ShopCategory, number>>
}
/**
 * `key` is what an acknowledgement (solar.load_check_acks) is matched on. It must change whenever the
 * finding materially changes — a key that stays constant while its message changes (e.g. the count of
 * unassigned tenants) would carry an old acknowledgement onto a new finding. So site-wide checks carry
 * their count / percentage in the key, and per-row checks carry the row id.
 */
export interface LoadCheck { key: string; severity: 'error' | 'warning' | 'info'; message: string; meterId?: string; nodeId?: string }
export interface TenantSummary {
  nodeId: string
  source: 'metered' | 'synthesised' | 'excluded' | 'covered_by_children'
  annualKwh: number
  peakKw: number
  wPerM2: number | null
}
export interface BulkReconciliation {
  meterId: string
  label: string
  months: Array<{ month: number; bulkKwh: number; tenantsKwh: number; ratio: number | null; flagged: boolean }>
}
export interface SiteLoadCoverage {
  window: SourceWindow | null
  commonShare: number | null
  meetsThreshold: boolean
  metered: number
  synthesised: number
  excluded: number
  unassigned: number
  coveredByChildren: number
  shapeOnlyMeters: string[]
  fullYearFromData: boolean
  peakKw: number
  peakSource: 'interval' | 'hourly'
  resolutionMin: number | null
}
export interface MdMonth { month: string; kva: number | null; source: string; powerFactor: number | null }
export interface BuildSiteLoadResult {
  basis: LoadBasis
  referenceYear: number
  series: Float64Array
  mdMonthly: MdMonth[]
  designMdKw: number | null
  coverage: SiteLoadCoverage
  reconciliation: { bulk: BulkReconciliation[]; parents: ParentReconciliation[] }
  tenants: TenantSummary[]
  checks: LoadCheck[]
}

const isExcludedKind = (k: BuildMeterKind) => (LOAD_EXCLUDED_KINDS as readonly string[]).includes(k)
const hourlyCapable = (c: ChannelData | null): c is ChannelData => c !== null && c.intervalMin <= 60 && 60 % c.intervalMin === 0
export const usableForLoad = (m: BuildMeter): boolean => !isExcludedKind(m.kind) && hourlyCapable(m.primary)

const archetypeOf = (t: BuildTenant): ArchetypeCode => t.archetype ?? (t.category ? CATEGORY_ARCHETYPE[t.category] : 'retail')
function densityOf(t: BuildTenant, densities?: Partial<Record<ShopCategory, number>>): number {
  if (t.densityOverrideWPerM2 !== null) return t.densityOverrideWPerM2
  const c: ShopCategory = t.category ?? 'standard'
  return densities?.[c] ?? DEFAULT_DENSITY_W_PER_M2[c]
}
/**
 * The BO ramp applies inside the reference year only (engine §2.4 "year 1"). A BO date in another
 * calendar year is not projected onto it: before the year = trading all year; after the year = the
 * tenant is modelled trading (the year-1 ramp belongs to the cashflow, which knows the COD).
 */
function boInYear(boDate: string | null, year: number): string | null {
  return boDate && boDate.startsWith(`${year}-`) ? boDate : null
}
function synthFor(t: BuildTenant, year: number, densities?: Partial<Record<ShopCategory, number>>, shape?: ArchetypeShapeDef): Float64Array {
  return synthesiseTenant({
    areaM2: t.areaM2 ?? 0,
    densityWPerM2: densityOf(t, densities),
    shape: expandArchetype(shape ?? getArchetype(archetypeOf(t)), year),
    boDate: boInYear(t.boDate, year),
  }, year)
}
const sumOf = (s: ArrayLike<number>) => { let a = 0; for (let i = 0; i < s.length; i++) a += s[i]; return a }
const maxOf = (s: ArrayLike<number>) => { let a = 0; for (let i = 0; i < s.length; i++) if (s[i] > a) a = s[i]; return a }
function intervalMax(c: ChannelData): number {
  let best = 0
  for (const r of c.readings) if (isUsable(r) && (r.value as number) > best) best = r.value as number
  return best
}
/** Monthly kWh with NaN for months the meter does not cover (so reconciliation skips them). */
function monthlyWithGaps(series: Float64Array, year: number, missingMonths: number[]): number[] {
  const m = monthlyEnergyKwh(series, year)
  for (const mm of missingMonths) m[mm - 1] = NaN
  return m
}

function meterChecks(meters: BuildMeter[], checks: LoadCheck[]): void {
  for (const m of meters) {
    if (isExcludedKind(m.kind)) {
      checks.push({ key: `excluded_kind:${m.meterId}`, severity: 'info', message: `${m.label} is a ${m.kind} meter and is never counted as load.`, meterId: m.meterId })
    } else if (m.primary && !hourlyCapable(m.primary)) {
      // The guard's false branch narrows `m.primary` to never; read the interval without the narrowing.
      const intervalMin = (m as BuildMeter).primary?.intervalMin
      checks.push({ key: `daily_only:${m.meterId}`, severity: 'warning', message: `${m.label} has only ${intervalMin}-minute data: it counts toward coverage and is not used as load.`, meterId: m.meterId })
    } else if (!m.primary) {
      checks.push({ key: `no_data:${m.meterId}`, severity: 'warning', message: `${m.label} has no imported active-power channel.`, meterId: m.meterId })
    }
  }
  const bySerial = new Map<string, string[]>()
  for (const m of meters) for (const s of m.serials) bySerial.set(s, [...(bySerial.get(s) ?? []), m.label])
  for (const [s, labels] of bySerial) {
    if (labels.length > 1) checks.push({ key: `duplicate_serial:${s}`, severity: 'warning', message: `Serial ${s} is on ${labels.length} meters in this study (${labels.join(', ')}).` })
  }
}

interface TenantEval {
  s2: S2Tenant[]
  synths: Float64Array[]
  meteredSum: Float64Array
  summaries: TenantSummary[]
  metered: number
  synthesised: number
  excluded: number
  unassigned: number
  coveredByChildren: number
  shapeOnly: string[]
  resolutionMin: number | null
}

function evaluateTenants(
  input: BuildSiteLoadInput, year: number, covered: Map<string, string[]>, window: SourceWindow | null,
  meterById: Map<string, BuildMeter>, checks: LoadCheck[],
): TenantEval {
  const included = [...new Set(input.tenants.filter((t) => t.source === 'metered').flatMap((t) => t.meters.map((r) => r.meterId)))]
    .filter((id) => (covered.get(id)?.length ?? 0) >= DEFAULT_COMMON_WINDOW.minDaysForMeter)
  const guard = doubleCountGuard(included, input.lines)
  const dropped = new Set(guard.droppedParents.map((d) => d.meterId))
  // A parent with counted children contributes its RESIDUAL (parent − Σ its nearest counted
  // descendants, per hour, floored at 0), so a chain P → C → G sums to P and nothing is counted twice.
  const children = supplyChildren(input.lines)
  const nearest = new Map<string, string[]>()
  for (const d of guard.droppedParents) {
    const inc = d.includedDescendants
    nearest.set(d.meterId, inc.filter((x) => !inc.some((y) => y !== x && descendants(y, children).has(x))))
  }
  // Each subtracted meter's reference series, filled (if needed) from the first tenant that meters it.
  const childSeries = new Map<string, Float64Array>()
  for (const id of new Set([...nearest.values()].flat())) {
    const m = meterById.get(id)
    const owner = input.tenants.find((t) => t.source === 'metered' && t.meters.some((r) => r.meterId === id))
    if (!m || !owner || !usableForLoad(m)) continue
    const p = m.primary as ChannelData
    childSeries.set(id, meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window, fallbackSynth: synthFor(owner, year, input.densities) }).series)
  }
  const residualOf = (parent: BuildMeter, series: Float64Array): Float64Array => {
    const kids = (nearest.get(parent.meterId) ?? []).map((k) => childSeries.get(k)).filter((x): x is Float64Array => Boolean(x))
    const out = new Float64Array(HOURS_PER_YEAR)
    let negHours = 0
    let negKwh = 0
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      let v = series[h]
      for (const k of kids) v -= k[h]
      if (v < -1e-9) { negHours++; negKwh -= v }
      out[h] = v > 0 ? v : 0
    }
    if (negHours / HOURS_PER_YEAR > NEGATIVE_RESIDUAL_SHARE && !checks.some((c) => c.key === `residual_negative:${parent.meterId}`)) {
      checks.push({
        key: `residual_negative:${parent.meterId}`, severity: 'warning', meterId: parent.meterId,
        message: `${parent.label} reads less than the meters it feeds in ${Math.round((negHours / HOURS_PER_YEAR) * 1000) / 10} % of hours: ${groupThousands(negKwh)} kWh of their load exceeds it. Its residual is floored at 0 there — check the meter hierarchy or the parent's CT ratio.`,
      })
    }
    return out
  }
  for (const d of guard.droppedParents) {
    const label = meterById.get(d.meterId)?.label ?? d.meterId
    const kids = d.includedDescendants.map((k) => meterById.get(k)?.label ?? k).join(', ')
    checks.push({ key: `double_count:${d.meterId}`, severity: 'info', message: `${label} feeds meters that are also counted (${kids}); they are counted in full and ${label} contributes only its residual (${label} − those meters, floored at 0).`, meterId: d.meterId })
  }
  const e: TenantEval = {
    s2: [], synths: [], meteredSum: new Float64Array(HOURS_PER_YEAR), summaries: [], metered: 0, synthesised: 0,
    excluded: 0, unassigned: 0, coveredByChildren: 0, shapeOnly: [], resolutionMin: null,
  }
  const summarise = (t: BuildTenant, source: TenantSummary['source'], s: Float64Array | null) => {
    const annualKwh = s ? sumOf(s) : 0
    e.summaries.push({ nodeId: t.nodeId, source, annualKwh, peakKw: s ? maxOf(s) : 0, wPerM2: s && t.areaM2 ? (annualKwh * 1000) / HOURS_PER_YEAR / t.areaM2 : null })
  }
  const useSynth = (t: BuildTenant, s: Float64Array) => {
    e.s2.push({ synth: s })
    e.synths.push(s)
    e.synthesised++
    summarise(t, 'synthesised', s)
    if (!t.areaM2) checks.push({ key: `tenant_no_area:${t.nodeId}`, severity: 'warning', message: `${t.label} has no shop area, so its synthesised load is zero.`, nodeId: t.nodeId })
  }
  for (const t of input.tenants) {
    if (t.source === 'excluded') {
      e.excluded++
      summarise(t, 'excluded', null)
      continue
    }
    const synth = synthFor(t, year, input.densities)
    if (t.source !== 'metered') {
      if (t.source === 'unassigned') e.unassigned++
      useSynth(t, synth)
      continue
    }
    const used: Array<{ series: Float64Array; weight: number }> = []
    let sample: ArchetypeShapeDef | null = null
    for (const ref of t.meters) {
      const m = meterById.get(ref.meterId)
      if (!m) {
        checks.push({ key: `missing_meter:${t.nodeId}:${ref.meterId}`, severity: 'warning', message: `${t.label} names a meter that is not in this study.`, nodeId: t.nodeId })
        continue
      }
      if (!usableForLoad(m)) continue
      const primary = m.primary as ChannelData
      if ((covered.get(m.meterId)?.length ?? 0) < DEFAULT_COMMON_WINDOW.minDaysForMeter) {
        sample = shapeFromSample(readingsToDailyHours(primary.readings, primary.intervalMin), getArchetype(archetypeOf(t)))
        if (!e.shapeOnly.includes(m.meterId)) e.shapeOnly.push(m.meterId)
        checks.push({ key: `shape_only:${m.meterId}`, severity: 'warning', message: `${m.label} has under ${DEFAULT_COMMON_WINDOW.minDaysForMeter} days of data; it shapes ${t.label}'s synthesis and is not used as its load.`, meterId: m.meterId })
        continue
      }
      const r = meterReferenceSeries({ readings: primary.readings, intervalMin: primary.intervalMin, referenceYear: year, window, fallbackSynth: synth })
      if (r.missingMonths.length > 0) {
        checks.push({ key: `filled:${m.meterId}`, severity: 'info', message: `${m.label}: ${r.missingMonths.length} month(s) without data were filled from ${t.label}'s synthesis scaled to the meter (×${r.synthesisScale.toFixed(2)}).`, meterId: m.meterId })
      }
      e.resolutionMin = e.resolutionMin === null ? primary.intervalMin : Math.min(e.resolutionMin, primary.intervalMin)
      used.push({ series: dropped.has(m.meterId) ? residualOf(m, r.series) : r.series, weight: ref.weight })
    }
    if (used.length > 0) {
      e.s2.push({ meters: used })
      e.metered++
      const s = new Float64Array(HOURS_PER_YEAR)
      for (const u of used) for (let h = 0; h < HOURS_PER_YEAR; h++) s[h] += u.weight * u.series[h]
      for (let h = 0; h < HOURS_PER_YEAR; h++) e.meteredSum[h] += s[h]
      summarise(t, 'metered', s)
    } else {
      useSynth(t, sample ? synthFor(t, year, input.densities, sample) : synth)
    }
  }
  if (e.unassigned > 0) {
    checks.push({ key: `unassigned_tenants:${e.unassigned}`, severity: 'warning', message: `${e.unassigned} tenant(s) have no load basis yet; they are synthesised from the tenant schedule until you choose.` })
  }
  return e
}

/** A parent's residual may dip below 0 in at most this share of hours before Checks warns. */
export const NEGATIVE_RESIDUAL_SHARE = 0.01

function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function buildSiteLoad(input: BuildSiteLoadInput): BuildSiteLoadResult {
  const checks: LoadCheck[] = []
  const meterById = new Map(input.meters.map((m) => [m.meterId, m]))
  meterChecks(input.meters, checks)

  const covered = new Map<string, string[]>()
  for (const m of input.meters) {
    if (usableForLoad(m)) {
      const p = m.primary as ChannelData
      covered.set(m.meterId, completeDays(readingsToDailyHours(p.readings, p.intervalMin)))
    }
  }
  const basis: LoadBasis = input.basis === 'S3' ? 'S2' : input.basis
  const tenantMeterIds = [...new Set(input.tenants.filter((t) => t.source === 'metered').flatMap((t) => t.meters.map((r) => r.meterId)))]
    .filter((id) => covered.has(id))
  const common = chooseCommonWindow(tenantMeterIds.map((meterId) => ({ meterId, coveredDates: covered.get(meterId) as string[] })))
  const confirmedBulk = input.meters.filter((m) => m.kind === 'bulk' && m.supplyPointConfirmed && usableForLoad(m))
  const dataWindow = basis === 'S1'
    ? (confirmedBulk[0] ? latestWindow(covered.get(confirmedBulk[0].meterId) as string[]) : null)
    : common.window
  const year = input.referenceYear ?? (dataWindow ? Number(dataWindow.end.slice(0, 4)) : input.fallbackYear)

  if (basis === 'S2' && input.tenants.length === 0) {
    throw new LoadModelError('no_tenants', 'The tenant schedule has no tenants — use Bulk meter or Monthly bills, or import a tenant schedule.')
  }
  const t = evaluateTenants(input, year, covered, common.window, meterById, checks)
  if (t.metered > 0 && !common.meetsThreshold) {
    checks.push({ key: `common_window:${Math.round(common.share * 100)}`, severity: 'warning', message: `Only ${Math.round(common.share * 100)} % of metered tenants share 12 months of data (80 % needed); uncovered months are synthesised.` })
  }

  // Bulk vs Σ metered tenants (any basis; a bulk meter need not be confirmed to be reconciled).
  const retail = expandArchetype(getArchetype('retail'), year)
  const bulkRecon: BulkReconciliation[] = []
  if (t.metered > 0) {
    const tenantsKwh = monthlyEnergyKwh(t.meteredSum, year)
    for (const m of input.meters.filter((x) => x.kind === 'bulk' && usableForLoad(x))) {
      const p = m.primary as ChannelData
      const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
      const bulkKwh = monthlyWithGaps(r.series, year, r.missingMonths)
      const months: BulkReconciliation['months'] = []
      for (let i = 0; i < 12; i++) {
        if (!Number.isFinite(bulkKwh[i])) continue
        const ratio = bulkKwh[i] > 0 ? tenantsKwh[i] / bulkKwh[i] : null
        const flagged = ratio === null ? tenantsKwh[i] > 0 : Math.abs(ratio - 1) > RECONCILIATION_TOLERANCE
        months.push({ month: i + 1, bulkKwh: bulkKwh[i], tenantsKwh: tenantsKwh[i], ratio, flagged })
        if (flagged) {
          checks.push({ key: `recon_bulk:${m.meterId}:${i + 1}`, severity: 'warning', message: `Month ${i + 1}: Σ metered tenants is ${ratio === null ? 'non-zero while the bulk meter reads zero' : `${Math.round(ratio * 100)} % of ${m.label}`} (flag beyond ±10 %).`, meterId: m.meterId })
        }
      }
      bulkRecon.push({ meterId: m.meterId, label: m.label, months })
    }
  }

  // Parent vs Σ children for every hierarchy parent that has data.
  const inLines = new Set(input.lines.flatMap((l) => [l.fromMeterId, l.toMeterId]))
  const monthly = new Map<string, number[]>()
  for (const id of inLines) {
    const m = meterById.get(id)
    if (!m || !usableForLoad(m)) continue
    const p = m.primary as ChannelData
    const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
    monthly.set(id, monthlyWithGaps(r.series, year, r.missingMonths))
  }
  const parents = reconcileParents(input.lines, monthly)
  for (const pr of parents) {
    for (const mo of pr.months.filter((x) => x.flagged)) {
      const label = meterById.get(pr.parentMeterId)?.label ?? pr.parentMeterId
      checks.push({ key: `recon_parent:${pr.parentMeterId}:${mo.month}`, severity: 'warning', message: `Month ${mo.month}: Σ children is ${mo.ratio === null ? 'non-zero while the parent reads zero' : `${Math.round(mo.ratio * 100)} % of ${label}`} (flag beyond ±10 %).`, meterId: pr.parentMeterId })
    }
  }

  let series: Float64Array
  let effective: LoadBasis = basis
  let mdMonthly: MdMonth[]
  let designMdKw: number | null = null
  let fullYearFromData = false
  let peakKw: number
  let peakSource: 'interval' | 'hourly' = 'hourly'
  let resolutionMin = t.resolutionMin

  if (basis === 'S1') {
    if (confirmedBulk.length === 0) {
      throw new LoadModelError('no_confirmed_bulk', 'Basis "Bulk meter" needs a bulk meter confirmed as the point of supply (Meters → the meter → Confirm point of supply).')
    }
    series = new Float64Array(HOURS_PER_YEAR)
    fullYearFromData = true
    resolutionMin = null
    for (const m of confirmedBulk) {
      const p = m.primary as ChannelData
      const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
      if (r.missingMonths.length > 0) fullYearFromData = false
      const pv = hourlyCapable(m.existingPv)
        ? meterReferenceSeries({ readings: m.existingPv.readings, intervalMin: m.existingPv.intervalMin, referenceYear: year, window: null, fallbackSynth: new Float64Array(HOURS_PER_YEAR) }).series
        : null
      if (pv) checks.push({ key: `existing_pv:${m.meterId}`, severity: 'info', message: `Existing PV generation is added back to ${m.label} (engine §2.3).`, meterId: m.meterId })
      const s1 = buildS1({ bulk: r.series, supplyPointConfirmed: true, existingPv: pv })
      for (let h = 0; h < HOURS_PER_YEAR; h++) series[h] += s1[h]
      resolutionMin = resolutionMin === null ? p.intervalMin : Math.min(resolutionMin, p.intervalMin)
    }
    if (confirmedBulk.length > 1) checks.push({ key: `multiple_bulk:${confirmedBulk.length}`, severity: 'info', message: `${confirmedBulk.length} bulk meters are confirmed points of supply; the site series is their sum.` })
    const single = confirmedBulk.length === 1 ? confirmedBulk[0] : null
    const md = single
      ? monthlyMaxDemand({
          kw: (single.primary as ChannelData).readings,
          kva: single.kva && single.kva.intervalMin === (single.primary as ChannelData).intervalMin ? single.kva.readings : null,
          intervalMin: (single.primary as ChannelData).intervalMin,
        })
      : null
    mdMonthly = md && 'months' in md ? md.months : monthlyMaxDemandFromHourly(series, year)
    peakKw = single ? intervalMax(single.primary as ChannelData) : maxOf(series)
    peakSource = single ? 'interval' : 'hourly'
  } else if (basis === 'S4') {
    const b = input.bills
    if (!b || b.months.length !== 12) throw new LoadModelError('no_bills', 'Enter twelve months of bills first (Site profile → Monthly bills).')
    const r = buildS4({
      shape: expandArchetype(getArchetype(b.archetype), year),
      monthlyKwh: b.months.map((m) => m.kwh),
      monthlyKva: b.months.map((m) => m.kva),
      powerFactor: b.powerFactor,
      referenceYear: year,
    })
    r.warnings.forEach((w, i) => checks.push({ key: `s4:${i}`, severity: 'warning', message: w }))
    series = r.series
    mdMonthly = monthlyMaxDemandFromHourly(series, year, b.powerFactor)
    peakKw = maxOf(series)
    resolutionMin = null
  } else {
    series = buildS2({ tenants: t.s2, commonAreaPct: input.commonAreaPct })
    effective = t.metered > 0 ? 'S2' : 'S3'
    fullYearFromData = t.metered > 0 && common.meetsThreshold
    if (effective === 'S3') designMdKw = designMaxDemandSynth(t.synths, input.diversityFactor)
    mdMonthly = monthlyMaxDemandFromHourly(series, year)
    peakKw = maxOf(series)
    if (t.s2.length === 0) checks.push({ key: 'all_excluded', severity: 'warning', message: 'Every tenant is excluded, so the site series is zero.' })
  }

  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    if (!Number.isFinite(series[h])) throw new LoadModelError('series_incomplete', 'The site series has hours that could not be filled.')
  }

  return {
    basis: effective,
    referenceYear: year,
    series,
    mdMonthly,
    designMdKw,
    coverage: {
      window: basis === 'S1' ? dataWindow : common.window,
      commonShare: t.metered > 0 ? common.share : null,
      meetsThreshold: common.meetsThreshold,
      metered: t.metered,
      synthesised: t.synthesised,
      excluded: t.excluded,
      unassigned: t.unassigned,
      coveredByChildren: t.coveredByChildren,
      shapeOnlyMeters: t.shapeOnly,
      fullYearFromData,
      peakKw,
      peakSource,
      resolutionMin,
    },
    reconciliation: { bulk: bulkRecon, parents },
    tenants: t.summaries,
    checks,
  }
}
