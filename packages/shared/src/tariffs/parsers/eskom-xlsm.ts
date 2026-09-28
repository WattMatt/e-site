/**
 * Front end for Eskom's official tariff workbook (as-is/09 §3.1). Tables are
 * found by their "VAT incl" marker row; the excl value is the column left of
 * each marker and the incl value is kept in source_locator.raw_incl so the
 * validator can prove x1.15. Gen-offset tables are separate export (sseg)
 * tariffs linked to their import tariffs by family, zone and voltage.
 */
import { makeCharge, type Charge, type DemandBasis, type LossFactor, type Tariff, type TariffUnit } from '../types'
import { parseUnitToken } from '../units'
import type { TariffIssue } from '../validators'
import { colToLetters, type CellValue, type Grid } from './grid'
import { detectCategory, detectComponent, detectSeason, detectTou, voltageBandFromText } from './labels'
import { inferStructure } from './tariff-draft'

export const ESKOM_SHEETS: readonly string[] = [
  'Homeflex NLA', 'Businessrate NLA', 'Megaflex NLA', 'Miniflex NLA', 'Nightsave Urban NLA', 'Nightsave Rural NLA',
  'Ruraflex NLA', 'Landrate NLA', 'Homepower NLA', 'Gen-offset',
]

export interface ParsedEskom {
  tariffs: Tariff[]
  lossFactors: LossFactor[]
  issues: TariffIssue[]
  skippedSheets: { sheet: string; reason: string }[]
}

const BILL_CODE = /^[A-Za-z]+\d+[A-Z]$/
const text = (v: CellValue): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

interface Table {
  vatRow: number
  titleRow: number
  seasonRow: number | null
  periodRow: number | null
  inclCols: number[]
  title: string
  zoneCol: number | null
  zoneTextCol: number | null
  voltageTextCol: number | null
  firstDataRow: number
}

interface Acc {
  code: string
  family: string
  isExport: boolean
  localAuthority: boolean
  descriptive: string | null
  appliesTo: string | null
  zone: number | null
  voltageText: string | null
  charges: Charge[]
  firstRow: number
}

function rowHas(g: Grid, row: number, pred: (s: string) => boolean): number | null {
  for (let c = 1; c <= g.maxCol; c++) if (pred(text(g.get(row, c)))) return c
  return null
}

function nearestLeft(g: Grid, row: number | null, col: number, minCol: number): { col: number; text: string } | null {
  if (row === null) return null
  for (let c = col; c >= minCol; c--) {
    const t = text(g.get(row, c))
    if (t !== '') return { col: c, text: t }
  }
  return null
}

function findTables(g: Grid): Table[] {
  const tables: Table[] = []
  let prevEnd = 0
  let prevTitle = g.sheet.trim()
  for (let r = 1; r <= g.maxRow; r++) {
    if (rowHas(g, r, (s) => s === 'VAT incl') === null) continue
    let titleRow: number | null = null
    const bracketed = (h: number): boolean => rowHas(g, h, (s) => /\[.+\]/.test(s)) !== null
    for (let h = r - 1; h > Math.max(prevEnd, r - 6); h--) {
      if (bracketed(h)) { titleRow = h; break }
    }
    // exceljs repeats a merged cell's value in every cell of the merge, so a
    // title merged down over the season/period rows shows its bracket on each
    // of them: the title row is the TOP of that contiguous bracketed run.
    while (titleRow !== null && titleRow - 1 > prevEnd && bracketed(titleRow - 1)) titleRow--
    if (titleRow === null) { prevEnd = r; continue }
    const tr: number = titleRow
    const within = (pred: (s: string) => boolean): number | null => {
      for (let h = tr + 1; h <= r; h++) if (rowHas(g, h, pred) !== null) return h
      return null
    }
    let title = prevTitle
    for (let h = tr; h > prevEnd; h--) {
      // A charge header can also say "authority" ("Affordability subsidy charge
      // [c/kWh] payable by non-local authority tariffs"): a title has no [unit].
      const c = rowHas(g, h, (s) => /authority/i.test(s) && !/\[/.test(s))
      if (c !== null) { title = text(g.get(h, c)); break }
    }
    prevTitle = title
    const inclCols: number[] = []
    for (let c = 1; c <= g.maxCol; c++) if (text(g.get(r, c)) === 'VAT incl') inclCols.push(c)
    const headerCol = (pred: (s: string) => boolean, fromRow: number, toRow: number): number | null => {
      for (let h = fromRow; h <= toRow; h++) {
        const c = rowHas(g, h, pred)
        if (c !== null) return c
      }
      return null
    }
    tables.push({
      vatRow: r, titleRow: tr,
      seasonRow: within((s) => /season/i.test(s)),
      periodRow: within((s) => s === 'Peak'),
      inclCols, title,
      zoneCol: headerCol((s) => s === 'Tx zone', r, r),
      zoneTextCol: headerCol((s) => s === 'Transmission zone', tr, r - 1),
      voltageTextCol: headerCol((s) => s === 'Voltage', tr, r - 1),
      firstDataRow: r + 1,
    })
    prevEnd = r
  }
  return tables
}

function familyOf(title: string): string {
  return title.replace(/\s*[–-]\s*(non-)?local authority.*$/i, '').replace(/\s+/g, ' ').trim()
}

function demandBasisFor(component: Charge['component'], unit: TariffUnit): DemandBasis | null {
  if (unit !== 'R_per_kVA_month' && unit !== 'R_per_kW_month') return component === 'network_capacity' ? 'nmd' : null
  return component === 'demand' ? 'actual_md' : 'utilised_capacity'
}

export function parseEskomSheet(g: Grid, opts: { fileSha256: string }): { accs: Acc[]; issues: TariffIssue[] } {
  const accs = new Map<string, Acc>()
  const issues: TariffIssue[] = []
  for (const t of findTables(g)) {
    const family = familyOf(t.title)
    const isExport = /gen-?offset/i.test(family)
    const localAuthority = !/non-local/i.test(t.title) && /local authority|munic/i.test(t.title)
    for (let r = t.firstDataRow; r <= g.maxRow; r++) {
      let codeCol: number | null = null
      for (let c = 1; c <= 8; c++) if (BILL_CODE.test(text(g.get(r, c)))) { codeCol = c; break }
      if (codeCol === null) break
      const code = text(g.get(r, codeCol))
      const colA = text(g.get(r, 1))
      let descriptive: string | null = null
      if (!isExport && colA !== '' && colA !== family && colA !== code) descriptive = colA
      if (!isExport && descriptive === null) {
        for (let c = 2; c <= 8; c++) {
          if (c === codeCol || c === t.zoneTextCol || c === t.voltageTextCol || c === t.zoneCol) continue
          const s = text(g.get(r, c))
          if (s.length > 3 && /[a-z]/i.test(s) && !BILL_CODE.test(s) && s !== family) { descriptive = s; break }
        }
      }
      const zoneRaw = t.zoneCol !== null ? g.get(r, t.zoneCol) : null
      const acc: Acc = accs.get(code) ?? {
        code, family, isExport, localAuthority, descriptive: null, appliesTo: isExport && colA !== '' ? colA : null,
        zone: typeof zoneRaw === 'number' ? zoneRaw : null,
        voltageText: t.voltageTextCol !== null ? text(g.get(r, t.voltageTextCol)) || null : null,
        charges: [], firstRow: r,
      }
      acc.descriptive = acc.descriptive ?? descriptive
      accs.set(code, acc)

      for (const incl of t.inclCols) {
        const excl = incl - 1
        const v = g.get(r, excl)
        if (typeof v !== 'number') continue
        const titleCell = nearestLeft(g, t.titleRow, excl, 1)
        if (!titleCell) continue
        const bracket = /\[([^\]]+)\]/.exec(titleCell.text)
        const unit = bracket ? parseUnitToken(bracket[1]) : null
        if (unit === null) {
          issues.push({ code: 'unit_unknown', severity: 'review', message: `no unit in "${titleCell.text}"`, locator: { file_sha256: opts.fileSha256, sheet: g.sheet, cell: `${colToLetters(titleCell.col)}${t.titleRow}` } })
          continue
        }
        const component = isExport && (unit === 'c_per_kWh' || unit === 'R_per_kWh') ? 'export_credit' : detectComponent(titleCell.text, unit, null)
        const seasonCell = nearestLeft(g, t.seasonRow, excl, titleCell.col)
        const periodCell = nearestLeft(g, t.periodRow, excl, seasonCell?.col ?? titleCell.col)
        const season = seasonCell ? detectSeason(seasonCell.text) ?? 'all' : 'all'
        const tou = periodCell ? detectTou(periodCell.text) ?? 'all' : 'all'
        const inclV = g.get(r, incl)
        const charge = makeCharge({
          component, unit, amountExclVat: v, season, tou,
          demandBasis: demandBasisFor(component, unit),
          vatBasis: 'stated_excl', extractionMethod: 'parser', label: titleCell.text,
          sourceLocator: {
            file_sha256: opts.fileSha256, sheet: g.sheet, row: r, col: colToLetters(excl), cell: `${colToLetters(excl)}${r}`,
            raw_text: `${titleCell.text} = ${v}`, raw_unit: bracket ? bracket[1] : null,
            ...(typeof inclV === 'number' ? { raw_incl: inclV } : {}),
          },
        })
        const key = `${component}|${season}|${tou}`
        const at = acc.charges.findIndex((c) => `${c.component}|${c.season}|${c.tou}` === key)
        if (at >= 0) {
          issues.push({ code: 'eskom_duplicate_column', severity: 'warn', message: `${code}: a second "${titleCell.text}" column (${v}); kept the first non-zero`, locator: charge.sourceLocator })
          if (acc.charges[at].amountExclVat === 0 && v !== 0) acc.charges[at] = charge
          continue
        }
        acc.charges.push(charge)
      }
    }
  }

  // Homeflex prints one energy row (HF101N) for the whole family.
  const list = [...accs.values()]
  for (const family of new Set(list.map((a) => a.family))) {
    const members = list.filter((a) => a.family === family)
    const withEnergy = members.filter((a) => a.charges.some((c) => c.component === 'energy'))
    if (withEnergy.length !== 1) continue
    const donor = withEnergy[0]
    for (const m of members) {
      if (m === donor || m.charges.some((c) => c.component === 'energy')) continue
      const have = new Set(m.charges.map((c) => `${c.component}|${c.season}|${c.tou}`))
      for (const c of donor.charges) if (!have.has(`${c.component}|${c.season}|${c.tou}`)) m.charges.push({ ...c })
      issues.push({ code: 'eskom_shared_energy_row', severity: 'review', message: `${m.code}: charges it lacks (energy, service, per-kWh adders) copied from ${donor.code}, the family's shared row (owner default 1: review)`, tariff: nameOf(m) })
    }
  }
  return { accs: list, issues }
}

function nameOf(a: Acc): string {
  return `${a.descriptive ?? a.family} (${a.code})`
}

function toTariff(a: Acc): Tariff {
  return {
    code: a.code, name: nameOf(a), family: a.family,
    category: a.isExport ? 'sseg' : detectCategory(a.family) ?? 'other',
    metering: 'both', structure: inferStructure(a.charges),
    voltageBand: voltageBandFromText(a.voltageText), phase: null, transmissionZone: a.zone,
    localAuthority: a.localAuthority, minAmps: null, maxAmps: null, minKva: null, maxKva: null,
    isLegacy: false, notes: a.appliesTo ? `export credit for ${a.appliesTo}` : null,
    charges: a.charges, exportTariffCode: null,
    sourceLocator: { file_sha256: a.charges[0]?.sourceLocator.file_sha256, sheet: a.charges[0]?.sourceLocator.sheet, row: a.firstRow },
  }
}

export function parseLossFactors(g: Grid, opts: { fileSha256: string }): LossFactor[] {
  const out: LossFactor[] = []
  for (let r = 1; r <= g.maxRow; r++) {
    const urbanCol = rowHas(g, r, (s) => /^urban loss factor$/i.test(s))
    if (urbanCol === null) continue
    const ruralCol = rowHas(g, r, (s) => /^rural loss factor$/i.test(s))
    let voltCol: number | null = null
    for (let c = urbanCol - 1; c >= 1; c--) if (text(g.get(r, c)) === 'Voltage') { voltCol = c; break }
    const zoneCol = rowHas(g, r, (s) => s === 'Zone')
    const lfCol = rowHas(g, r, (s) => /^loss factor$/i.test(s))
    const loc = (row: number, col: number) => ({ file_sha256: opts.fileSha256, sheet: g.sheet, row, cell: `${colToLetters(col)}${row}` })
    const f5 = (x: number) => Math.round(x * 1e5) / 1e5
    for (let row = r + 1; voltCol !== null && text(g.get(row, voltCol)) !== ''; row++) {
      const band = voltageBandFromText(text(g.get(row, voltCol)))
      const u = g.get(row, urbanCol)
      if (typeof u === 'number') out.push({ kind: 'dx_urban', voltageBand: band, transmissionZone: null, factor: f5(u), sourceLocator: loc(row, urbanCol) })
      const ru = ruralCol === null ? null : g.get(row, ruralCol)
      if (typeof ru === 'number' && ruralCol !== null) out.push({ kind: 'dx_rural', voltageBand: band, transmissionZone: null, factor: f5(ru), sourceLocator: loc(row, ruralCol) })
    }
    for (let row = r + 1; zoneCol !== null && lfCol !== null && typeof g.get(row, zoneCol) === 'number'; row++) {
      const factor = g.get(row, lfCol)
      if (typeof factor === 'number') out.push({ kind: 'tx', voltageBand: null, transmissionZone: g.get(row, zoneCol) as number, factor: f5(factor), sourceLocator: loc(row, lfCol) })
    }
    break
  }
  return out
}

export function parseEskomWorkbook(grids: readonly Grid[], opts: { fileSha256: string }): ParsedEskom {
  const res: ParsedEskom = { tariffs: [], lossFactors: [], issues: [], skippedSheets: [] }
  const accs: Acc[] = []
  for (const g of grids) {
    const name = g.sheet.trim()
    if (name === 'Loss Factors') { res.lossFactors.push(...parseLossFactors(g, opts)); continue }
    if (!ESKOM_SHEETS.includes(name)) {
      res.skippedSheets.push({ sheet: name, reason: /munic/i.test(name) ? 'local-authority sheet: not parsed in 2a (open question Q5)' : 'not a 2a sheet' })
      continue
    }
    const p = parseEskomSheet(g, opts)
    accs.push(...p.accs)
    res.issues.push(...p.issues)
  }
  const tariffs = accs.map(toTariff)
  // Link each import tariff to its Gen-offset export tariff: same family, zone and voltage.
  const exports = accs.filter((a) => a.isExport)
  for (const [i, a] of accs.entries()) {
    if (a.isExport) continue
    const hit = exports.find((x) =>
      (x.appliesTo ?? x.family.replace(/^gen-?offset\s+/i, '')).toLowerCase() === a.family.toLowerCase()
      && x.zone === a.zone
      && voltageBandFromText(x.voltageText) === voltageBandFromText(a.voltageText))
    if (hit) tariffs[i].exportTariffCode = hit.code
  }
  res.tariffs = tariffs
  return res
}
