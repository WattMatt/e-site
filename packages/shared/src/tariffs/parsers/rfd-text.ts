/**
 * NERSA 2026/27 "Decision and Reasons for Decision" tables, from
 * `pdftotext -layout`. A tariff opens at "N. Name" in column 0. A charge row is
 * a label in column 0 with five columns — approved, proposed %, proposed,
 * RECOMMENDED, recommended % — either on the same line or on the indented line
 * above it. Commentary to the right is ignored. Output is always for review.
 */
import type { TariffSeason, TariffUnit, Tariff } from '../types'
import type { TariffIssue } from '../validators'
import { detectSeason, labelUnit } from './labels'
import { normaliseCharge, type Unresolved } from './normalise'
import { finishDraft, newDraft, type TariffDraft } from './tariff-draft'

export interface ParsedRfd {
  tariffs: Tariff[]
  /** The most common recommended % across rows. */
  increasePct: number | null
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

interface Row {
  approved: number
  recommended: number
  recommendedPct: number
}

const AMOUNT = /^\d{1,3}(?: \d{3})+,\d+$|^\d+,\d+$/
const PCT = /^-?\d+,\d+%$/
const HEADER = /^(\d{1,2})\.\s+(\S.*)$/
const num = (s: string): number => Number(s.replace(/ /g, '').replace('%', '').replace(',', '.'))

function readFive(tokens: string[]): Row | null {
  if (tokens.length < 5) return null
  const [a, p1, b, c] = tokens
  // Commentary can follow the last % after a single space: "9,01% category reflects…".
  const p2 = tokens[4].split(' ')[0]
  if (!AMOUNT.test(a) || !PCT.test(p1) || !AMOUNT.test(b) || !AMOUNT.test(c) || !PCT.test(p2)) return null
  return { approved: num(a), recommended: num(c), recommendedPct: num(p2) }
}

function mode(xs: number[]): number | null {
  if (xs.length === 0) return null
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0]
}

export function parseRfdText(text: string, opts: { fileSha256: string }): ParsedRfd {
  const out: ParsedRfd = { tariffs: [], increasePct: null, issues: [], unresolved: [] }
  const taken = new Set<string>()
  const pcts: number[] = []
  let cur: TariffDraft | null = null
  let pending: { row: Row; line: number } | null = null
  let energySeason: TariffSeason = 'all'
  let contextUnit: TariffUnit | null = null
  let page = 1

  const close = (): void => {
    if (!cur) return
    const done = finishDraft(cur, taken)
    out.tariffs.push(...done.tariffs)
    out.issues.push(...done.issues)
    cur = null
  }

  text.split('\n').forEach((rawLine, idx) => {
    const lineNo = idx + 1
    page += (rawLine.match(/\f/g) ?? []).length
    const line = rawLine.replace(/\f/g, '')
    if (line.trim() === '' || /^\s*-\s*$/.test(line)) return

    if (/^\s/.test(line)) {
      const row = readFive(line.trim().split(/\s{2,}/))
      if (row) pending = { row, line: lineNo }
      return
    }

    const tokens = line.split(/\s{2,}/)
    const head = HEADER.exec(tokens[0])
    if (head) {
      close()
      cur = newDraft({ name: head[2].trim(), fileSha256: opts.fileSha256, page, line: lineNo })
      pending = null
      energySeason = 'all'
      contextUnit = null
      return
    }

    const label = tokens[0].trim()
    const inline = readFive(tokens.slice(1))
    const values = inline ? { row: inline, line: lineNo } : pending
    if (!values) {
      const s = detectSeason(label)
      if (s) energySeason = s
      contextUnit = labelUnit(label)
      return
    }
    pending = null
    if (!cur) {
      out.issues.push({ code: 'orphan_charge', severity: 'review', message: `"${label}" before any tariff header`, locator: { page, line: lineNo } })
      return
    }
    const rawValue = String(values.row.recommended)
    const res = normaliseCharge({
      label,
      amount: { value: values.row.recommended, unitText: null, randPrefix: false, raw: rawValue },
      rawValue, unitColumn: null, contextUnit, headerUnit: null, componentHint: null,
      seasonState: { energy: energySeason, general: 'all' },
      blockText: null, vatBasis: 'assumed_excl', extractionMethod: 'parser',
      locator: { file_sha256: opts.fileSha256, page, line: values.line, raw_text: `${label} = ${rawValue} (recommended)` },
    })
    if (!res.ok) {
      out.unresolved.push(res.unresolved)
      return
    }
    ;(cur as TariffDraft).charges.push(res.charge)
    out.issues.push(...res.issues)
    pcts.push(values.row.recommendedPct)
    if (values.row.approved > 0) {
      const computed = (values.row.recommended / values.row.approved - 1) * 100
      if (Math.abs(computed - values.row.recommendedPct) > 0.05) {
        out.issues.push({
          code: 'rfd_row_increase_mismatch', severity: 'review',
          message: `"${label}": ${values.row.approved} -> ${values.row.recommended} is ${computed.toFixed(2)}%, the row says ${values.row.recommendedPct}%`,
          locator: res.charge.sourceLocator,
        })
      }
    }
  })
  close()
  out.increasePct = mode(pcts.filter((p) => p !== 0))
  return out
}
