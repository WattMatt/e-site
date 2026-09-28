/**
 * Front end for the NERSA province compendium workbooks (one sheet per
 * licensee; layouts in as-is/09 §2.2). Values may sit in B, C, D or E, be
 * typed as text with the unit glued on, carry a block range in B (Maluti), or
 * sit inside the column-A sentence (Cape Town). Nothing here decides a unit:
 * that is normaliseCharge.
 */
import { parseUnitToken } from '../units'
import type { ChargeComponent, Tariff, TariffCategory, TariffSeason, TariffUnit, VatBasis } from '../types'
import type { TariffIssue } from '../validators'
import { parseAmount, parseTitle, type ParsedAmount } from './amount'
import { parseBlockRange } from './blocks'
import { colToLetters, type CellValue, type Grid } from './grid'
import { cleanLabel, detectCategory, detectSeason, labelUnit } from './labels'
import { normaliseCharge, type Unresolved } from './normalise'
import { finishDraft, newDraft, type TariffDraft } from './tariff-draft'

export interface ParsedSheet {
  sheet: string
  titleName: string
  increasePct: number | null
  vatBasis: VatBasis
  tariffs: Tariff[]
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

export interface ProvinceParseOptions {
  fileSha256: string
}

// "TARIFF -A- …" and "Tariff A – …" are headers; "TARIFF PER UNIT" is a context line, not a header.
const STRONG_HEADER = /^(\d+(?:\.\d+)*\.?\s+\S|scale\s+\w+|tariff\s+[ivx]+\b|tariff\s*-[a-z0-9]{1,3}-|tariff\s+[a-z0-9]\s)/i
const CONTEXT_VOCAB = /\b(charges?|levy|per unit|per month|energy|demand|season|consumption)\b/i
const IBT_CONTEXT = /inclining block/i
const ENERGY_WORDED = /energy|kwh|consumption|per unit/i
const MARKER = /\b(redundant|obsolete)\b/i
const RECOMMENDED = /recommended|proposed/i
const VAT_EXCL = /(do not include|excl(?:uding|usive)?\.?)\s*vat|vat\s*excl/i
const VAT_INCL = /\b(incl(?:uding|usive)?\.?)\s*vat|vat\s*incl/i

interface RowRead {
  row: number
  label: string
  value: { col: number; raw: CellValue; amount: ParsedAmount } | null
  embedded: { label: string; amount: ParsedAmount; raw: string } | null
  unitColumn: TariffUnit | null
  blockCell: string | null
  texts: string[]
}

function readRow(grid: Grid, row: number): RowRead | null {
  const a = grid.get(row, 1)
  const label = typeof a === 'string' ? cleanLabel(a) : a === null ? '' : String(a)
  const lastCol = Math.min(6, Math.max(grid.maxCol, 2))
  let value: RowRead['value'] = null
  for (let col = lastCol; col >= 2; col--) {
    const raw = grid.get(row, col)
    const amount = parseAmount(raw)
    if (amount && parseUnitToken(amount.unitText, { randPrefix: amount.randPrefix, bare: true }) !== 'pct') {
      value = { col, raw, amount }
      break
    }
  }
  const texts: string[] = []
  for (let col = 2; col <= lastCol; col++) {
    const v = grid.get(row, col)
    if (typeof v === 'string' && v.trim() !== '' && !(value && value.col === col)) texts.push(v.trim())
  }
  let unitColumn: TariffUnit | null = null
  if (value) {
    const next = grid.get(row, value.col + 1)
    if (typeof next === 'string' && parseAmount(next) === null) unitColumn = parseUnitToken(next, { bare: true })
  }
  const b = grid.get(row, 2)
  const blockCell = value && value.col > 2 && typeof b === 'string' && parseBlockRange(b) ? b : null
  let embedded: RowRead['embedded'] = null
  if (!value && label.includes(':')) {
    const idx = label.indexOf(':')
    const tail = label.slice(idx + 1).trim()
    const amount = tail === '' ? null : parseAmount(tail)
    if (amount) embedded = { label: label.slice(0, idx).trim(), amount, raw: tail }
  }
  if (label === '' && !value && texts.length === 0) return null
  return { row, label, value, embedded, unitColumn, blockCell, texts }
}

const hasValue = (r: RowRead | undefined): boolean => !!r && (r.value !== null || r.embedded !== null)

function isContext(r: RowRead | undefined): boolean {
  if (!r || hasValue(r) || r.label === '' || STRONG_HEADER.test(r.label)) return false
  return CONTEXT_VOCAB.test(r.label) || IBT_CONTEXT.test(r.label) || detectSeason(r.label) !== null
}

function contextComponent(label: string): ChargeComponent | null {
  if (/levy|basic|fixed/i.test(label)) return 'basic'
  if (/demand/i.test(label)) return 'demand'
  if (ENERGY_WORDED.test(label)) return 'energy'
  return null
}

export function parseProvinceSheet(grid: Grid, opts: ProvinceParseOptions): ParsedSheet {
  const title = parseTitle(grid.get(1, 1), grid.get(1, 2))
  const out: ParsedSheet = {
    sheet: grid.sheet, titleName: title.name || grid.sheet.trim(), increasePct: title.increasePct,
    vatBasis: 'assumed_excl', tariffs: [], issues: [], unresolved: [],
  }
  if (title.increasePct === null) {
    out.issues.push({ code: 'increase_missing', severity: 'review', message: `no increase % in A1/B1 of "${grid.sheet}"`, locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, cell: 'A1' } })
  }

  const rows: RowRead[] = []
  for (let r = 2; r <= grid.maxRow; r++) {
    const rr = readRow(grid, r)
    if (rr) rows.push(rr)
  }

  const taken = new Set<string>()
  let cur: TariffDraft | null = null
  let headerUnit: TariffUnit | null = null
  let componentHint: ChargeComponent | null = null
  let contextUnit: TariffUnit | null = null
  let seasonState: { energy: TariffSeason; general: TariffSeason } = { energy: 'all', general: 'all' }
  let bannerCategory: TariffCategory | null = null
  let lastChargeLabel = ''

  const close = (): void => {
    if (!cur) return
    const done = finishDraft(cur, taken)
    out.tariffs.push(...done.tariffs)
    out.issues.push(...done.issues)
    cur = null
  }
  const open = (rr: RowRead): void => {
    close()
    cur = newDraft({ name: rr.label, fileSha256: opts.fileSha256, sheet: grid.sheet, headerRow: rr.row, categoryHint: bannerCategory })
    headerUnit = rr.texts.map((t) => parseUnitToken(t)).find((u): u is TariffUnit => u !== null) ?? null
    componentHint = null
    contextUnit = null
    seasonState = { energy: 'all', general: 'all' }
    lastChargeLabel = ''
  }

  for (let k = 0; k < rows.length; k++) {
    const rr = rows[k]
    const allText = [rr.label, ...rr.texts].join(' ')

    if (!hasValue(rr) && VAT_EXCL.test(allText)) { out.vatBasis = 'stated_excl'; continue }
    if (!hasValue(rr) && VAT_INCL.test(allText)) { out.vatBasis = 'stated_incl'; continue }
    if (rr.texts.some((t) => MARKER.test(t))) {
      if (cur) (cur as TariffDraft).isLegacy = true
      continue
    }
    if (!hasValue(rr) && rr.label === '') {
      if (cur && rr.texts.some((t) => RECOMMENDED.test(t))) (cur as TariffDraft).notes.push(rr.texts.join(' '))
      continue
    }

    if (hasValue(rr)) {
      if (!cur) {
        open({ ...rr, label: `${out.titleName} (untitled)` })
        out.issues.push({ code: 'orphan_charge', severity: 'review', message: `a charge before any tariff header (row ${rr.row})`, locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, row: rr.row } })
      }
      const label = rr.embedded ? rr.embedded.label : rr.label || lastChargeLabel
      const amount = rr.embedded ? rr.embedded.amount : (rr.value as NonNullable<RowRead['value']>).amount
      const col = rr.embedded ? 1 : (rr.value as NonNullable<RowRead['value']>).col
      const rawValue = rr.embedded ? rr.embedded.raw : String((rr.value as NonNullable<RowRead['value']>).raw)
      const res = normaliseCharge({
        label, amount, rawValue, unitColumn: rr.unitColumn, contextUnit, headerUnit, componentHint, seasonState,
        blockText: rr.blockCell, vatBasis: out.vatBasis, extractionMethod: 'parser',
        locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, row: rr.row, col: colToLetters(col), cell: `${colToLetters(col)}${rr.row}`, raw_text: `${label} = ${rawValue}` },
      })
      if (res.ok) {
        const draft = cur as unknown as TariffDraft
        draft.charges.push(res.charge)
        out.issues.push(...res.issues)
        // A season written on an ENERGY label carries to the energy rows that follow it.
        const s = detectSeason(label)
        if (s && (res.charge.component === 'energy' || res.charge.component === 'export_credit')) seasonState = { ...seasonState, energy: s }
      } else {
        out.unresolved.push(res.unresolved)
      }
      if (rr.label) lastChargeLabel = rr.label
    } else if (STRONG_HEADER.test(rr.label)) {
      open(rr)
    } else if (isContext(rr)) {
      const s = detectSeason(rr.label)
      if (s) seasonState = ENERGY_WORDED.test(rr.label) ? { ...seasonState, energy: s } : { energy: s, general: s }
      const comp = contextComponent(rr.label)
      const u = labelUnit(rr.label) ?? rr.texts.map((t) => parseUnitToken(t)).find((x): x is TariffUnit => x !== null) ?? null
      if (comp !== null && comp !== componentHint) {
        componentHint = comp
        contextUnit = u
      } else if (u !== null) {
        contextUnit = u
      }
    } else if (cur && (cur as TariffDraft).charges.length === 0) {
      (cur as TariffDraft).notes.push(rr.label)
    } else {
      const next = rows[k + 1]
      if (hasValue(next) || isContext(next)) open(rr)
      else bannerCategory = detectCategory(rr.label) ?? bannerCategory
    }
    if (cur && MARKER.test(rr.label)) (cur as TariffDraft).isLegacy = true
  }
  close()
  return out
}

export function parseProvinceWorkbook(grids: readonly Grid[], opts: ProvinceParseOptions): ParsedSheet[] {
  return grids.map((g) => parseProvinceSheet(g, opts))
}
