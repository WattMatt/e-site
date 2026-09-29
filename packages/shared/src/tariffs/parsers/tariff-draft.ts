import { normaliseTariffName, type TariffIssue } from '../validators'
import type { Charge, SourceLocator, Tariff, TariffCategory, TariffStructure } from '../types'
import { repairBlocks } from './blocks'
import { detectCategory, detectMetering, detectPhase } from './labels'

export interface TariffDraft {
  name: string
  fileSha256: string
  sheet?: string
  headerRow?: number
  page?: number
  line?: number
  isLegacy: boolean
  notes: string[]
  charges: Charge[]
  categoryHint: TariffCategory | null
}

export function newDraft(p: { name: string; fileSha256: string; sheet?: string; headerRow?: number; page?: number; line?: number; categoryHint?: TariffCategory | null }): TariffDraft {
  return { ...p, isLegacy: false, notes: [], charges: [], categoryHint: p.categoryHint ?? null }
}

export function inferStructure(charges: readonly Charge[]): TariffStructure {
  const energy = charges.filter((c) => c.component === 'energy')
  const tou = energy.some((c) => c.tou !== 'all')
  const blocks = energy.some((c) => c.blockMinKwh !== null)
  const seasonal = energy.some((c) => c.season !== 'all')
  if (tou) return blocks ? 'tou_ibt' : 'tou'
  if (blocks) return seasonal ? 'seasonal_ibt' : 'ibt'
  return seasonal ? 'seasonal' : 'flat'
}

function locatorOf(d: TariffDraft): SourceLocator {
  return d.headerRow !== undefined
    ? { file_sha256: d.fileSha256, sheet: d.sheet, row: d.headerRow, cell: `A${d.headerRow}` }
    : { file_sha256: d.fileSha256, page: d.page, line: d.line }
}

const isSingleRate = (c: Charge): boolean =>
  c.component === 'energy' && c.blockMinKwh === null && c.tou === 'all' && /single rate|flat rate/i.test(c.label ?? '')

function toTariff(name: string, d: TariffDraft, charges: Charge[]): Tariff {
  const sseg = /\b(sseg|small[- ]scale embedded|embedded generation|generator|feed[- ]in|export)\b/i.test(d.name)
  return {
    code: null,
    name,
    family: null,
    category: sseg ? 'sseg' : detectCategory(d.name) ?? d.categoryHint ?? 'other',
    metering: detectMetering(d.name),
    structure: inferStructure(charges),
    voltageBand: null,
    phase: detectPhase(d.name),
    transmissionZone: null,
    localAuthority: false,
    minAmps: null,
    maxAmps: null,
    minKva: null,
    maxKva: null,
    isLegacy: d.isLegacy,
    notes: d.notes.length > 0 ? d.notes.join(' / ') : null,
    charges,
    exportTariffCode: null,
    sourceLocator: locatorOf(d),
  }
}

/** Close a tariff. `taken` holds normalised names already used in this book. */
export function finishDraft(d: TariffDraft, taken: Set<string>): { tariffs: Tariff[]; issues: TariffIssue[] } {
  const issues: TariffIssue[] = []
  if (d.charges.length === 0) {
    issues.push({
      code: d.isLegacy ? 'legacy_tariff_skipped' : 'empty_tariff',
      severity: 'warn',
      message: `${d.isLegacy ? 'legacy (redundant/obsolete) ' : ''}header "${d.name}" has no charges; skipped`,
      tariff: d.name,
      locator: locatorOf(d),
    })
    return { tariffs: [], issues }
  }

  for (const s of ['all', 'high', 'low'] as const) {
    repairBlocks(d.charges.filter((c) => c.component === 'energy' && c.tou === 'all' && c.season === s))
  }

  const groups: { suffix: string; charges: Charge[] }[] = []
  if (d.charges.some((c) => c.component === 'energy' && c.blockMinKwh !== null) && d.charges.some(isSingleRate)) {
    const nonEnergy = d.charges.filter((c) => c.component !== 'energy')
    groups.push({ suffix: '', charges: d.charges.filter((c) => !isSingleRate(c)) })
    groups.push({ suffix: ' (single rate)', charges: [...d.charges.filter(isSingleRate), ...nonEnergy.map((c) => ({ ...c }))] })
  } else {
    groups.push({ suffix: '', charges: d.charges })
  }

  const tariffs = groups.map((g) => {
    let name = `${d.name}${g.suffix}`
    if (taken.has(normaliseTariffName(name))) name = `${name} [row ${d.headerRow ?? d.line ?? 0}]`
    taken.add(normaliseTariffName(name))
    return toTariff(name, d, g.charges)
  })
  for (const t of tariffs) {
    if (t.category === 'sseg') {
      issues.push({
        code: 'sseg_semantics_unknown', severity: 'review',
        message: `"${t.name}": the source does not say whether these are import or export rates`,
        tariff: t.name, locator: t.sourceLocator,
      })
    }
  }
  return { tariffs, issues }
}
