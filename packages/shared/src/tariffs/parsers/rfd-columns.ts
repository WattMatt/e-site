/**
 * NERSA 2026/27 "Reasons for Decision" tariff tables whose layout the City
 * Power reader in rfd-text.ts does not follow, from `pdftotext -layout`.
 *
 * The RfDs share one idea — a header naming 2025/26 Approved, Proposed %,
 * 2026/27 Proposed, 2026/27 Recommended and Recommended % — but not one
 * layout: the columns come in different orders, the tariff name wraps inside
 * the header's first column, labels wrap above and below their numbers, a row's
 * numbers can straddle two lines, decimals are commas or points, and a free-text
 * findings column runs down the right. So the header is read as COLUMNS (by x
 * position, pdftotext keeps it), each column is classified by its words, and a
 * row's numbers are placed by position. The value stored is the Recommended
 * (NERSA-approved) figure, never Proposed.
 *
 * Nothing is guessed silently:
 *  - a table without exactly one Recommended amount column is skipped (issue);
 *  - numbers that cannot be placed in a column are unresolved, not dropped;
 *  - every row is checked: Recommended ≈ Approved × (1 + Recommended %). A
 *    mismatch is `review` (or `block` when gross), and a row the table gives no
 *    way to check is `review` too (rfd_row_unverified);
 *  - two charges a bill cannot tell apart (same component/season/TOU/block/unit)
 *    with different amounts block; an exact repeat is dropped with a warning.
 */
import type { Charge, TariffSeason, TariffUnit } from '../types'
import { normaliseTariffName, type TariffIssue } from '../validators'
import { parseUnitToken } from '../units'
import { parseNumberText } from './amount'
import { parseBlockRange } from './blocks'
import { cleanLabel, detectSeason, detectTou, labelUnit } from './labels'
import { normaliseCharge, type Unresolved } from './normalise'
import { finishDraft, newDraft, type TariffDraft } from './tariff-draft'
import type { ParsedRfd } from './rfd-text'

// ---------------------------------------------------------------------------
// Lines and segments

interface Seg {
  x0: number
  x1: number
  text: string
  /** Split off the front of a run of words ("11.8% phased increase…"). */
  peeled?: boolean
}

interface Line {
  no: number
  page: number
  text: string
  segs: Seg[]
}

/**
 * A number at the start of a run, followed by a space: "9,01% category…" → "9,01%". Space-grouped
 * thousands are tried first, so "1 128.22 …" is never read as "1" (a lazy alternation would).
 */
const NUM_PREFIX_GROUPED = /^(?:R\s?)?-?(?:\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d{1,3}(?:,\d{3})+\.\d+)\s?%?(?= )/
const NUM_PREFIX_PLAIN = /^(?:R\s?)?-?\d+(?:[.,]\d+)?\s?%?(?= )/
const NUM = /^(?:R\s?)?-?(?:(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d+)?|\d{1,3}(?:,\d{3})+\.\d+)\s?%?$/
const DASH = /^[-–—]$/

/** Runs of text separated by two or more spaces; a leading number is split off its run. */
export function segmentLine(line: string): Seg[] {
  const out: Seg[] = []
  const re = /\S+(?: \S+)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    let x = m.index
    let t = m[0]
    while (!NUM.test(t)) {
      const n = NUM_PREFIX_GROUPED.exec(t) ?? NUM_PREFIX_PLAIN.exec(t)
      if (!n) break
      out.push({ x0: x, x1: x + n[0].length, text: n[0], peeled: true })
      const rest = t.slice(n[0].length)
      const lead = rest.length - rest.trimStart().length
      x += n[0].length + lead
      t = rest.trimStart()
    }
    // A label run into its first number by one space: "Block 1 (0 - 50 kWh) 192,64" (Magareng).
    const tail = /^(.*[A-Za-z)].*?) ((?:\d{1,3}(?: \d{3})+|\d+)[.,]\d{2,4})$/.exec(t)
    if (tail && !NUM.test(t)) {
      out.push({ x0: x, x1: x + tail[1].length, text: tail[1] })
      const nx = x + t.length - tail[2].length
      out.push({ x0: nx, x1: nx + tail[2].length, text: tail[2] })
    } else if (t !== '') out.push({ x0: x, x1: x + t.length, text: t })
  }
  return out
}

const isNum = (s: string): boolean => NUM.test(s)
const isAmountTok = (s: string): boolean => isNum(s) && !s.endsWith('%')

// ---------------------------------------------------------------------------
// Header vocabulary and column kinds

const VOCAB = new RegExp(
  '^(?:' + [
    String.raw`\d{4}/\d{1,2}`, String.raw`\d{4}-\d{2}(?:fy)?`, String.raw`fy\d{4}/\d{2}`,
    // Words pdftotext cuts across lines: "Recommen / ded", "Recommende / d", "Propose / d", "incre / ase".
    String.raw`approv\w*`, String.raw`propos\w*`, String.raw`recom\w*`, 'nded', 'mended', 'ended', 'ded', 'ed', 'd',
    String.raw`increas\w*`, 'incre', 'ase', '%', String.raw`\(%\)`, '%increase', 'increase%', 'tariffs?', 'nersa-?', 'nersa’s', "nersa's",
    'actual', 'analysis', 'andkkey', 'and', 'key', 'findings?', 'comments?', 'remarks?', 'implemented', 'municipal',
    'ceo-', 'coe-', 'ceo-implemented', 'coe-implemented', 'rates?', 'fy', 'financial', 'year', 'final',
  ].join('|') + ')$', 'i',
)

/** Every word of the run is header vocabulary ("2026/27 Recommended", "% Increase"). */
function isVocabSeg(text: string): boolean {
  return text.split(/\s+/).every((w) => VOCAB.test(w))
}

function unitSeg(text: string): TariffUnit | null {
  const t = text.replace(/[()]/g, '').trim()
  if (!/^(?:c|r|cents?|rand)\s*\/\s*[a-z/ ]+$/i.test(t)) return null
  return parseUnitToken(t)
}

export type ColumnKind = 'prior' | 'proposed' | 'proposed_pct' | 'recommended' | 'recommended_pct' | 'pct' | 'other'

interface Column {
  x0: number
  x1: number
  text: string
  kind: ColumnKind
}

export function classifyColumn(text: string): ColumnKind | 'commentary' {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  if (/analysis|finding|comment|remark|motivation/.test(t)) return 'commentary'
  // "Recomme / nded" and "Recommen / ded" still start with "recom"; "Amended" or "Extended" never do.
  const recommended = /\brecom/.test(t)
  const proposed = /\bpropos/.test(t)
  const newYear = /2026\/27|2026-27|26\/27/.test(t)
  const pct = /%/.test(t) || (/increase/.test(t) && !/tariff/.test(t))
  if (pct) {
    if (proposed && !recommended) return 'proposed_pct'
    if (recommended && !proposed) return 'recommended_pct'
    if (!proposed && /approved|nersa/.test(t) && newYear) return 'recommended_pct'
    return 'pct'
  }
  if (recommended && !proposed) return 'recommended'
  if (proposed && !recommended) return 'proposed'
  if (/approved|nersa/.test(t) && newYear && !/2025\/26|2024\/25/.test(t)) return 'recommended'
  if (/implemented|actual/.test(t)) return 'other'
  if (/approved|nersa/.test(t) || /^(?:2025\/26|2024\/25)$/.test(t.trim())) return 'prior'
  return 'other'
}

// ---------------------------------------------------------------------------
// Header detection

interface Header {
  start: number
  end: number
  cols: Column[]
  commentX: number
  labelCut: number
  nameParts: string[]
  unit: TariffUnit | null
}

/** "1.1 Prepaid", "7. Tariff…": a heading number at the left margin is not an amount. */
const isHeadingNumber = (l: Line, s: Seg): boolean =>
  s === l.segs[0] && s.x0 <= 8 && /^\d{1,2}(?:\.\d{1,2})*\.$|^\d{1,2}(?:\.\d)+$/.test(s.text) && l.segs.length > 1 && !isNum(l.segs[1].text)
const hasAmount = (l: Line): boolean => l.segs.some((s) => isAmountTok(s.text) && !isHeadingNumber(l, s))
const vocabSegs = (l: Line): Seg[] => l.segs.filter((s) => isVocabSeg(s.text) && !isNum(s.text))
const isBlank = (l: Line | undefined): boolean => !l || l.segs.length === 0
const isFragment = (t: string): boolean =>
  /^\(/.test(t) || /^[a-z]/.test(t) || /^(?:charge|tariff)?\s*:?\s*\(?\s*(?:c|r)\s*\/\s*[a-z]+\)?\s*:?$/i.test(t)
const isTariffName = (t: string): boolean =>
  /domestic|residential|commercial|business|industrial|agricultur|farm|prepaid|conventional|indigent|bulk|street|municipal|departmental|sport|church|school|lifeline|\bscale\b|\btariff\s+[a-z0-9]{1,3}\b/i.test(t)
  && !rowLike(t) && !detectSeason(t) && !detectTou(t) && !isFragment(t) && !GENERIC_NAME.test(t.trim())
const rowLike = (t: string): boolean => ROW_WORDS.test(t) || parseBlockRange(t) !== null || /^part\s*\d/i.test(t)
const ROW_WORDS = /\b(energy|charge|basic|demand|service|capacity|network|block|peak|standard|off[- ]?peak|kwh|kva)\b/i

function isAnchor(l: Line): boolean {
  if (hasAmount(l)) return false
  const v = vocabSegs(l)
  return v.length >= 2 && v.some((s) => /recom|approved|propos/i.test(s.text))
}

function readHeader(lines: Line[], anchor: number): Header | { error: string; end: number; amountCols: number } {
  let start = anchor
  while (start - 1 >= 0 && anchor - (start - 1) <= 5) {
    const l = lines[start - 1]
    if (isBlank(l) || hasAmount(l) || vocabSegs(l).length === 0) break
    start--
  }
  let end = anchor
  const leftText = (l: Line): string => l.segs.filter((s) => !isVocabSeg(s.text) && s.x0 < 30).map((s) => s.text).join(' ')
  while (end + 1 < lines.length && end + 1 - anchor <= 6) {
    const l = lines[end + 1]
    if (isBlank(l) || hasAmount(l)) break
    const hasVocab = vocabSegs(l).length > 0 || l.segs.some((s) => unitSeg(s.text) !== null && s.x0 >= 12)
    if (!hasVocab) {
      // A name line wrapping inside the header: never a row label or a season heading, and the
      // line above it carried a name part too (or a vocabulary line follows below).
      const t = l.segs.map((s) => s.text).join(' ')
      if (ROW_WORDS.test(t) || detectSeason(t) || detectTou(t) || parseBlockRange(t)) break
      const aboveHadName = leftText(lines[end]) !== ''
      const next = lines[end + 2]
      const belowHasVocab = next !== undefined && !hasAmount(next) && vocabSegs(next).length > 0
      if (!aboveHadName && !belowHasVocab) break
    }
    end++
  }

  // Column header runs: vocabulary runs away from the far left, plus unit runs of a units row.
  const runs: Seg[] = []
  const unitRuns: Seg[] = []
  const nameParts: string[] = []
  let firstVocabX = Infinity
  for (let i = start; i <= end; i++) {
    for (const s of lines[i].segs) {
      if (isVocabSeg(s.text) && !isNum(s.text)) firstVocabX = Math.min(firstVocabX, s.x0)
    }
  }
  for (let i = start; i <= end; i++) {
    const nameLine: string[] = []
    for (const s of lines[i].segs) {
      const u = unitSeg(s.text)
      if (s.x0 >= firstVocabX - 2 && u !== null) unitRuns.push(s)
      else if (s.x0 >= firstVocabX - 2 && isVocabSeg(s.text) && !isNum(s.text)) runs.push(s)
      else if (s.x0 < firstVocabX - 2 && !isNum(s.text)) nameLine.push(s.text)
    }
    if (nameLine.length > 0) nameParts.push(nameLine.join(' '))
  }
  // The findings column: everything from its left edge on is prose.
  // A run can carry the tail of a column header into it with one space ("Recommended Analysis and
  // key", Polokwane): the findings column starts at the word, not at the run.
  let commentX = Infinity
  for (const r of runs) {
    const m = /\b(?:analysis|key analysis|findings?|comments?|remarks?|motivation)\b/i.exec(r.text)
    if (m) commentX = Math.min(commentX, r.x0 + m.index)
  }
  for (const [n, r] of runs.entries()) {
    if (r.x0 < commentX && r.x1 > commentX) {
      const text = r.text.slice(0, commentX - r.x0).trimEnd()
      runs[n] = { ...r, text, x1: r.x0 + text.length }
    }
  }

  // Columns come from the NUMBERS under the header (pdftotext keeps their x): the x-ranges of the
  // numbers right of the header's first word, merged where they overlap. Header words are then
  // hung on the column beneath them one word at a time, so a header printed with single spaces
  // ("Increase Proposed Recommended % Increase") cannot fuse two columns.
  type Box = { x0: number; x1: number }
  const multi: Seg[] = []
  const single: Seg[] = []
  for (let k = end + 1; k < Math.min(lines.length, end + 60); k++) {
    if (tableEnds(lines[k])) break
    const ns = lines[k].segs.filter((x) => isNum(x.text) && x.x0 < commentX - 1 && x.x1 > firstVocabX - 4)
    if (ns.length >= 2) multi.push(...ns)
    // A lone number that opens a sentence ("11.8% phased increase…") is findings prose.
    else single.push(...ns.filter((x) => !x.peeled))
  }
  const merge = (bs: Box[]): Box[] => {
    const acc: Box[] = []
    for (const bx of [...bs].sort((p, q) => p.x0 - q.x0)) {
      const c = acc[acc.length - 1]
      if (c && bx.x0 < c.x1) c.x1 = Math.max(c.x1, bx.x1)
      else acc.push({ ...bx })
    }
    return acc
  }
  // Lines with two or more numbers set the columns. A lone number ("Block 1 (0- 50kWh)   1.87",
  // its row finishing on the next line) adds a column only where it touches none of them: it may
  // never bridge two.
  const base = merge(multi.map((x) => ({ x0: x.x0, x1: x.x1 })))
  const touches = (bx: Box): boolean => base.some((c) => bx.x0 < c.x1 && c.x0 < bx.x1)
  // Merged lone numbers can grow to touch a column: check again after merging.
  const extra = merge(single.map((x) => ({ x0: x.x0, x1: x.x1 })).filter((bx) => !touches(bx))).filter((bx) => !touches(bx))
  const clusters: (Box & { words: { line: number; x: number; w: string }[] })[] = [...base, ...extra]
    .sort((p, q) => p.x0 - q.x0).map((c) => ({ ...c, words: [] }))
  const groups: { x0: number; x1: number; text: string }[] = []
  if (clusters.length >= 2) {
    // A header run goes to the column whose numbers it overlaps most, else the nearest one. A run
    // printed across two columns with single spaces ("Increase Proposed Recommended % Increase") is
    // split into words, each placed the same way.
    const overlap = (x0: number, x1: number, c: Box): number => Math.min(x1, c.x1) - Math.max(x0, c.x0)
    const gap = (x0: number, x1: number, c: Box): number => Math.max(0, c.x0 - x1, x0 - c.x1)
    const pick = (x0: number, x1: number): number => {
      let k = -1
      let best = -Infinity
      clusters.forEach((c, n) => {
        // Numbers are right-aligned: a header clear of every column leans to the one on its right.
        const score = overlap(x0, x1, c) > 0 ? 1000 + overlap(x0, x1, c) : -gap(x0, x1, c) + (c.x0 >= x1 ? 2.5 : 0)
        if (score > best) {
          best = score
          k = n
        }
      })
      return best >= -14 ? k : -1
    }
    for (const r of runs) {
      if (r.x0 >= commentX - 1) continue
      const line = lineOf(lines, r, start, end)
      const spans = clusters.filter((c) => overlap(r.x0, r.x1, c) >= 2).length >= 2
      const parts: { x0: number; w: string }[] = []
      if (spans) {
        const re = /\S+/g
        let m: RegExpExecArray | null
        while ((m = re.exec(r.text))) parts.push({ x0: r.x0 + m.index, w: m[0] })
      } else {
        parts.push({ x0: r.x0, w: r.text })
      }
      for (const p of parts) {
        const k = pick(p.x0, p.x0 + p.w.length)
        if (k >= 0) clusters[k].words.push({ line, x: p.x0, w: p.w })
      }
    }
    for (const c of clusters) {
      const text = c.words.sort((p, q) => p.line - q.line || p.x - q.x).map((w) => w.w).join(' ')
      groups.push({ x0: c.x0, x1: c.x1, text })
    }
  } else {
    // No numbers to read columns from: fall back to header runs overlapping in x.
    const sorted = runs.filter((r) => r.x0 < commentX - 1).sort((p, q) => p.x0 - q.x0)
    const acc: { x0: number; x1: number; parts: Seg[] }[] = []
    for (const r of sorted) {
      const g = acc[acc.length - 1]
      if (g && r.x0 <= g.x1 + 1) {
        g.x1 = Math.max(g.x1, r.x1)
        g.parts.push(r)
      } else acc.push({ x0: r.x0, x1: r.x1, parts: [r] })
    }
    for (const g of acc) {
      groups.push({ x0: g.x0, x1: g.x1, text: [...g.parts].sort((p, q) => lineOf(lines, p, start, end) - lineOf(lines, q, start, end)).map((x) => x.text).join(' ') })
    }
  }
  const cols: Column[] = []
  for (const g of groups) {
    const kind = g.text === '' ? 'other' : classifyColumn(g.text)
    if (kind === 'commentary') continue
    cols.push({ x0: g.x0, x1: g.x1, text: g.text, kind })
  }
  // "2026/27 Recommended Increase" (Matjhabeng) is the increased TARIFF; "Proposed Increase"
  // (Abaqulusi) is a percentage. Without a "%" in the header, the column's own numbers decide.
  for (const c of cols) {
    if (/%/.test(c.text) || !/increase/i.test(c.text)) continue
    let pct = 0
    let amt = 0
    for (let k = end + 1; k < Math.min(lines.length, end + 40); k++) {
      if (tableEnds(lines[k])) break
      for (const s of lines[k].segs) {
        if (!isNum(s.text) || s.x1 < c.x0 - 2 || s.x0 > c.x1 + 2) continue
        if (s.text.endsWith('%')) pct++
        else amt++
      }
    }
    if (amt > 0 && pct === 0) c.kind = classifyColumn(c.text.replace(/\bincreased?\b/gi, ' ')) as ColumnKind
    else if (pct > 0 && amt === 0 && /propos/i.test(c.text) !== /recom/i.test(c.text)) c.kind = /propos/i.test(c.text) ? 'proposed_pct' : 'recommended_pct'
  }
  // A bare "% Increase" is the increase of the amount column to its left.
  cols.forEach((c, k) => {
    if (c.kind !== 'pct' || k === 0) return
    const left = cols[k - 1].kind
    if (left === 'recommended') c.kind = 'recommended_pct'
    else if (left === 'proposed') c.kind = 'proposed_pct'
  })
  // The tariff name can start on lines above the header, left of its columns (Stellenbosch).
  for (let k = start - 1, n = 0; k >= 0 && n < 4 && !HEADING_NUMBER.test(nameParts[0] ?? ''); k--, n++) {
    const l = lines[k]
    if (isBlank(l) || hasAmount(l) || l.segs.some((s) => s.x0 >= firstVocabX - 2)) break
    if (/^\s*table\b|tariff analysis|schedule of tariffs/i.test(l.text)) break
    nameParts.unshift(l.segs.map((s) => s.text).join(' '))
    if (HEADING_NUMBER.test(nameParts[0])) break
  }
  let recs = cols.filter((c) => c.kind === 'recommended')
  // "FY2026/27 Approved" beside "FY2026/27 Recommended" (Northern Cape template): the column that
  // says Recommended is the decision; the other is left unread rather than guessed at.
  const named = recs.filter((c) => /\brecom/i.test(c.text))
  if (recs.length > 1 && named.length === 1) {
    for (const c of recs) if (c !== named[0]) c.kind = 'other'
    recs = named
  }
  if (recs.length !== 1) {
    const amountCols = cols.filter((c) => c.kind === 'prior' || c.kind === 'proposed' || c.kind === 'recommended').length
    return { error: `header has ${recs.length} Recommended amount columns (${cols.map((c) => `"${c.text}"`).join(', ')})`, end, amountCols }
  }
  // A units row: one unit under the Recommended column (or one unit throughout) is the table's unit.
  let unit: TariffUnit | null = null
  const rec = recs[0]
  const under = unitRuns.filter((s) => s.x1 >= rec.x0 - 2 && s.x0 <= rec.x1 + 2).map((s) => unitSeg(s.text))
  const all = new Set(unitRuns.map((s) => unitSeg(s.text)))
  if (under.length > 0 && new Set(under).size === 1) unit = under[0]
  else if (all.size === 1) unit = [...all][0]
  return { start, end, cols, commentX, labelCut: Math.min(...cols.map((c) => c.x0)), nameParts, unit }
}

function lineOf(lines: Line[], s: Seg, start: number, end: number): number {
  for (let i = start; i <= end; i++) if (lines[i].segs.includes(s)) return i
  return end
}

/** The next header, a table caption or a section heading: where a table's body stops. */
function tableEnds(l: Line): boolean {
  if (isAnchor(l) || /^\s*table\s+\d+/i.test(l.text)) return true
  const hd = asHeading(l)
  return hd !== null && SECTION.test(hd)
}

/** A heading that ends the tariff tables rather than naming a tariff. */
const SECTION = /conclusion|decision|recommendation|objection|participation|background|introduction|revenue|cost of supply|tariff design|analysis|energy losses|approval|resolution|summary|annexure|appendix|licensee|financial|compliance|bulk purchase|pass[- ]through/i

const GENERIC_NAME = /^(?:tariff\s*names?|tariff\s*blocks?|tariffs?|description|tariff description|charges?|units?)$/i
const HEADING_NUMBER = /^(?:\d{1,2}(?:\.\d{1,2})*\.?|[A-Z]\))\s+/

function tariffName(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== '' && !GENERIC_NAME.test(p))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(HEADING_NUMBER, '')
    .replace(/\s*[:;,&-]\s*$/, '')
    .trim()
}

/** "7.1. Domestic Conventional", "1.3. DOMESTIC …", "TARIFF B: …": a heading, not prose. */
function asHeading(l: Line): string | null {
  if (l.segs.length === 0 || l.segs[0].x0 > 12 || hasAmount(l)) return null
  const t = l.segs.map((s) => s.text).join(' ').trim()
  if (/tariff analysis|schedule of tariffs|tariff components|tariff structure|^table\b/i.test(t)) return null
  if (/^\d{1,2}(?:\.\d{1,2})+\.?\s+\S/.test(t) || /^\d{1,2}\.\s+\S/.test(t) || /^tariff\s+[a-z0-9]{1,3}\b/i.test(t)) {
    if (t.length > 90 || /[.]$/.test(t)) return null
    return t
  }
  return null
}

// ---------------------------------------------------------------------------
// Body rows

type Cells = Map<number, Seg>

interface Row {
  label: string[]
  cells: Cells
  labelFirst: boolean
  /** Label lines taken from below the numbers. */
  below?: number
  /** The line the Recommended value is on, when the row's numbers straddle two lines. */
  recLine?: number
  line: number
  page: number
}

interface BodyLine {
  line: Line
  label: string
  cells: Cells | null
  /** Numbers the header columns could not place. */
  stray: Seg[]
  /** A heading printed over the columns ("Low Season Energy Charges"): never part of a row label. */
  overCols: boolean
}

/** Place each number of a line into a header column: all of them in order, or by position. */
function place(nums: Seg[], cols: Column[], learned: ({ x0: number; x1: number } | null)[]): Cells | null {
  const cells: Cells = new Map()
  const near = (s: Seg, k: number): boolean => {
    const box = learned[k] ?? cols[k]
    return Math.min(s.x1, box.x1) - Math.max(s.x0, box.x0) > 0 || Math.max(box.x0 - s.x1, s.x0 - box.x1) <= 6
  }
  // As many numbers as columns: in order, but only if each sits over (or beside) its column; a blank
  // cell plus a stray number would otherwise shift every value one column over.
  if (nums.length === cols.length && nums.every((s, k) => near(s, k))) {
    nums.forEach((s, k) => cells.set(k, s))
    return cells
  }
  let last = -1
  for (const s of nums) {
    let best = -1
    let bestScore = -Infinity
    cols.forEach((c, k) => {
      const box = learned[k] ?? c
      const overlap = Math.min(s.x1, box.x1) - Math.max(s.x0, box.x0)
      const dist = Math.abs((s.x0 + s.x1) / 2 - (box.x0 + box.x1) / 2)
      const score = overlap > 0 ? 1000 + overlap : -dist
      if (score > bestScore) {
        bestScore = score
        best = k
      }
    })
    if (best <= last || bestScore < -6 || cells.has(best)) return null
    cells.set(best, s)
    last = best
  }
  return cells
}

/** How a table writes decimals, from the numbers that can only be read one way. */
export type DecimalStyle = 'point' | 'comma' | 'unknown'

/** "1,050" is one thousand fifty in a table of points, one point zero five in a table of commas. */
const AMBIGUOUS_COMMA = /^-?\d{1,3},\d{3}%?$/

export function decimalStyle(tokens: readonly string[]): DecimalStyle {
  let point = 0
  let comma = 0
  for (const raw of tokens) {
    const t = raw.replace(/^R\s?/, '').replace('%', '').trim()
    if (/^-?\d[\d ]*\.\d+$/.test(t) || /^-?\d{1,3}(?:,\d{3})+\.\d+$/.test(t)) point++
    else if (/^-?\d[\d ]*,(?:\d{1,2}|\d{4,})$/.test(t)) comma++
  }
  if (point > 0 && comma === 0) return 'point'
  if (comma > 0 && point === 0) return 'comma'
  return 'unknown'
}

/** A cell's number. An ambiguous "1,050" in a table whose style is unknown is null, never a guess. */
function cellValue(s: Seg | undefined, style: DecimalStyle): number | null {
  if (!s || DASH.test(s.text)) return null
  let t = s.text.replace(/^R\s?/, '').replace('%', '').trim()
  if (AMBIGUOUS_COMMA.test(s.text.replace(/^R\s?/, '').trim())) {
    if (style === 'unknown') return null
    if (style === 'point') t = t.replace(',', '')
  }
  const neg = t.startsWith('-')
  const v = parseNumberText(neg ? t.slice(1) : t)
  return v === null ? null : neg ? -v : v
}

/** Decimals printed in a cell ("2,3738" → 4); an ambiguous comma read as thousands has none. */
function printedDecimals(s: Seg | undefined, style: DecimalStyle): number {
  if (!s) return 0
  const t = s.text.replace(/^R\s?/, '').replace('%', '').trim()
  if (AMBIGUOUS_COMMA.test(t) && style === 'point') return 0
  const m = /[.,](\d+)$/.exec(t)
  return m ? m[1].length : 0
}

// ---------------------------------------------------------------------------

export function parseRfdColumns(text: string, opts: { fileSha256: string }): ParsedRfd {
  const out: ParsedRfd = { tariffs: [], increasePct: null, issues: [], unresolved: [] }
  const raw = text.split('\n')
  let page = 1
  // Running headers/footers ("Page 16 of 22", the report title on every page) are not table
  // text: a line repeated at least three times next to a page break.
  const PAGE = /^page \d+ of \d+$/i
  const near = (reach: number): boolean[] => {
    const at = raw.map(() => false)
    raw.forEach((r, i) => {
      if (!r.includes('\f') && !PAGE.test(r.trim())) return
      for (let d = -reach; d <= reach; d++) if (i + d >= 0 && i + d < raw.length) at[i + d] = true
    })
    return at
  }
  const nearBreak = near(3)
  const nearBreakWide = near(6)
  const counts = new Map<string, number>()
  raw.forEach((r, i) => {
    const k = r.replace(/\f/g, '').trim()
    if (k !== '' && nearBreak[i]) counts.set(k, (counts.get(k) ?? 0) + 1)
  })
  const lines: Line[] = raw.map((r, i) => {
    page += (r.match(/\f/g) ?? []).length
    const t = r.replace(/\f/g, '')
    const k = t.trim()
    const furniture = PAGE.test(k)
      || (nearBreak[i] && (counts.get(k) ?? 0) >= 3 && !/\d[.,]\d/.test(k) && !/recommend|approved|proposed/i.test(k))
      || (nearBreakWide[i] && /tariff applications? for|financial year|reasons for decision/i.test(k) && !/\d[.,]\d/.test(k))
    return { no: i + 1, page, text: t, segs: furniture ? [] : segmentLine(t) }
  })

  const taken = new Set<string>()
  const pcts: number[] = []
  let draft: TariffDraft | null = null
  let lastHeading: { text: string; idx: number } | null = null

  const openDraft = (name: string, at: Line): TariffDraft => {
    const prev: TariffDraft | null = draft
    if (prev && normaliseTariffName(prev.name) === normaliseTariffName(name)) return prev
    closeDraft()
    const d = newDraft({ name, fileSha256: opts.fileSha256, page: at.page, line: at.no })
    draft = d
    return d
  }
  const closeDraft = (): void => {
    if (!draft) return
    dedupe(draft, out.issues)
    const done = finishDraft(draft, taken)
    out.tariffs.push(...done.tariffs)
    out.issues.push(...done.issues)
    draft = null
  }

  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    const h0 = asHeading(l)
    if (h0) lastHeading = { text: h0, idx: i }
    if (!isAnchor(l)) {
      i++
      continue
    }
    const h = readHeader(lines, i)
    if ('error' in h) {
      // Only a header that names amount columns is a skipped tariff table; prose is not.
      if (h.amountCols > 0) {
        out.issues.push({ code: 'rfd_table_skipped', severity: 'review', message: `p.${l.page} line ${l.no}: ${h.error}`, locator: { file_sha256: opts.fileSha256, page: l.page, line: l.no } })
      }
      i = h.end + 1
      continue
    }

    // Name: the header's first column, else the nearest heading above it.
    let name = tariffName(h.nameParts)
    if (name === '' && lastHeading && h.start - lastHeading.idx <= 8) name = tariffName([lastHeading.text])
    const headerLine = lines[h.start]

    // Body: to the next header, table caption or section heading. A numbered heading
    // inside it ("2. Pensioners Domestic…") starts another tariff under the same columns.
    let j = h.end + 1
    const body: Line[] = []
    while (j < lines.length) {
      const b = lines[j]
      if (tableEnds(b)) break
      body.push(b)
      j++
    }
    i = j

    const parts: { name: string; at: Line; lines: Line[] }[] = [{ name, at: headerLine, lines: [] }]
    for (const b of body) {
      const hd = asHeading(b)
      if (hd) {
        parts.push({ name: tariffName([hd]), at: b, lines: [] })
        lastHeading = { text: hd, idx: b.no - 1 }
      } else {
        parts[parts.length - 1].lines.push(b)
      }
    }
    for (const part of parts) {
      let cur: TariffDraft | null = part.name === '' ? null : openDraft(part.name, part.at)
      const target: DraftTarget = {
        get: () => cur,
        switchTo: (name, at) => (cur = openDraft(name, at)),
      }
      readBody(part.lines, body, h, target, opts.fileSha256, out, pcts)
      if (target.get() === null && part.lines.some(hasAmount)) {
        out.issues.push({ code: 'rfd_table_skipped', severity: 'review', message: `p.${part.at.page} line ${part.at.no}: tariff table without a name`, locator: { file_sha256: opts.fileSha256, page: part.at.page, line: part.at.no } })
      }
    }
  }
  closeDraft()
  const counted = pcts.filter((p) => p !== 0)
  if (counted.length > 0) {
    const m = new Map<number, number>()
    for (const p of counted) m.set(p, (m.get(p) ?? 0) + 1)
    out.increasePct = [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  }
  return out
}

/** The tariff rows are going to; a name line inside a table can move it on. */
interface DraftTarget {
  get: () => TariffDraft | null
  switchTo: (name: string, at: Line) => TariffDraft
}

function readBody(body: Line[], whole: Line[], h: Header, target: DraftTarget, sha: string, out: ParsedRfd, pcts: number[]): void {
  const { cols } = h
  const firstX = h.labelCut
  const lastX = Math.max(...cols.map((c) => c.x1))
  // Split each line into its label (left of the first column) and numbers (in the columns).
  const split = (line: Line) => {
    const label: string[] = []
    const nums: Seg[] = []
    const inCols: string[] = []
    for (const s of line.segs) {
      if (s.x0 >= h.commentX - 1) continue
      // A number opening a sentence right of the last column is findings prose spilling left.
      if (s.peeled && s.x0 > lastX) continue
      if ((isNum(s.text) || DASH.test(s.text)) && s.x1 > firstX - 4) nums.push(s)
      else if (s.x0 < firstX - 1) label.push(s.text)
      // A season heading can sit over the columns ("Low Season Energy Charges", eThekwini);
      // other text inside the columns ("N/A", commentary spilling left) is ignored.
      else if (detectSeason(s.text)) inCols.push(s.text)
    }
    const overCols = nums.length === 0 && label.length === 0 && inCols.length > 0
    if (nums.length === 0) label.push(...inCols)
    return { line, label: label.join(' '), nums, overCols }
  }
  const pre = body.map(split)
  // Column boxes learned from the lines (of the whole table) that fill every column.
  const learned: ({ x0: number; x1: number } | null)[] = cols.map(() => null)
  for (const p of whole.map(split)) {
    if (p.nums.length !== cols.length) continue
    p.nums.forEach((s, k) => {
      const b = learned[k]
      learned[k] = b ? { x0: Math.min(b.x0, s.x0), x1: Math.max(b.x1, s.x1) } : { x0: s.x0, x1: s.x1 }
    })
  }
  const lines: BodyLine[] = pre.map((p) => {
    if (p.nums.length === 0) return { line: p.line, label: p.label, cells: null, stray: [], overCols: p.overCols }
    const cells = place(p.nums, cols, learned)
    return cells ? { line: p.line, label: p.label, cells, stray: [], overCols: false } : { line: p.line, label: p.label, cells: null, stray: p.nums, overCols: false }
  })

  const recIdx = cols.findIndex((c) => c.kind === 'recommended')
  // Amounts only: percentages are often printed with a point in a table of comma amounts (Polokwane).
  const style = decimalStyle(whole.flatMap((l) => l.segs.filter((s) => isAmountTok(s.text)).map((s) => s.text)))
  let season: TariffSeason = 'all'
  let contextUnit: TariffUnit | null = null
  let open: Row | null = null
  let pendingLabel: string[] = []

  const complete = (r: Row | null): boolean => r !== null && r.cells.has(recIdx)
  const unclosedLabel = (r: Row): boolean => {
    const j = r.label.join(' ')
    return (j.match(/\(/g) ?? []).length > (j.match(/\)/g) ?? []).length
  }
  const collides = (r: Row, c: Cells): boolean => [...c.keys()].some((k) => r.cells.has(k))
  const heading = (t: string): void => {
    const s = detectSeason(t)
    if (s) season = s
    const u = labelUnit(t)
    if (u) contextUnit = u
  }
  /**
   * Label lines waiting above a row: headings set context and prefix the row's label. A line that
   * reads like a row of its own ("Part 1 - First 50 kWh …  Free   Free") had no number to take;
   * prefixing it would hand its block range to the next row, so it is dropped (unresolved).
   */
  const consume = (ls: string[], at: Line, own: string | null): string[] => {
    const keep: string[] = []
    // A row whose own label is only a fragment ("(R/kWh):") is named by the line above it.
    const selfNamed = own === null || (!isFragment(own) && rowLike(own))
    for (const [n, t] of ls.entries()) {
      heading(t)
      const last = n === ls.length - 1
      // "Block 1 (0-" / "50) kWh  197.00 …": a bracket left open is continued by the row's own label.
      const opens = (t.match(/\(/g) ?? []).length > (t.match(/\)/g) ?? []).length
      if (rowLike(t) && !detectSeason(t) && (selfNamed || !last) && !(last && opens)) {
        const tier = parseBlockRange(t) !== null || /^part\s*\d|\bblock\s*\d/i.test(t)
        dropRow(out, target.get(), { label: t, raw: '', reason: 'row without a numeric Recommended value', locator: { file_sha256: sha, page: at.page, line: at.no } }, tier ? 'block' : 'review')
      } else {
        keep.push(t)
      }
    }
    return keep
  }
  const finish = (): void => {
    const r = open
    open = null
    if (!r) return
    emitRow(r, { cols, recIdx, draft: target.get(), sha, out, pcts, season, contextUnit, tableUnit: h.unit, style })
  }
  const nextMeaningful = (k: number): BodyLine | undefined => {
    for (let m = k + 1; m < lines.length; m++) {
      const b = lines[m]
      if (b.cells || b.stray.length > 0 || (b.label !== '' && !GENERIC_NAME.test(b.label.trim()))) return b
    }
    return undefined
  }

  lines.forEach((b, k) => {
    if (b.stray.length > 0) {
      const strayLabel = [...pendingLabel, b.label].join(' ').trim()
      dropRow(out, target.get(), {
        label: strayLabel || '(no label)', raw: b.stray.map((s) => s.text).join(' | '),
        reason: 'numbers could not be placed in the header columns', locator: { file_sha256: sha, page: b.line.page, line: b.line.no, raw_text: b.line.text.trim() },
      }, strayLabel ? 'block' : 'review')
      return
    }
    const hasLabel = b.label !== ''
    if (!b.cells && !hasLabel) return

    if (b.cells && !hasLabel) {
      if (open && !complete(open) && !collides(open, b.cells)) {
        for (const [c, s] of b.cells) open.cells.set(c, s)
        if (b.cells.has(recIdx)) open.recLine = b.line.no
        return
      }
      finish()
      // The last label line names this row; any above it are headings ("Summer" over "Block 1").
      const labels = consume(pendingLabel.slice(0, -1), b.line, pendingLabel[pendingLabel.length - 1] ?? null)
      if (pendingLabel.length > 0) labels.push(pendingLabel[pendingLabel.length - 1])
      open = { label: labels, cells: new Map(b.cells), labelFirst: pendingLabel.length > 0, line: b.line.no, page: b.line.page }
      pendingLabel = []
      return
    }

    if (b.cells && hasLabel) {
      // Numbers waiting for their label (above it), a row finishing on this line, or a label whose
      // bracket is still open ("Block 2 (51 –" / numbers / "350 c/kWh  197.80", Hessequa).
      if (open && (!complete(open) || open.label.length === 0 || unclosedLabel(open)) && !collides(open, b.cells)) {
        for (const [c, s] of b.cells) open.cells.set(c, s)
        if (b.cells.has(recIdx)) open.recLine = b.line.no
        open.label.push(b.label)
        return
      }
      finish()
      open = { label: [...consume(pendingLabel, b.line, b.label), b.label], cells: new Map(b.cells), labelFirst: pendingLabel.length > 0, line: b.line.no, page: b.line.page }
      pendingLabel = []
      return
    }

    // A label with no numbers.
    const t = b.label
    // A tariff name inside a table ("Commercial Prepaid" after the "Commercial Conventional"
    // rows, Tsantsabane), or naming a table whose header does not: a customer-class line that is
    // not a charge, followed by a row that names its own charge.
    if ((!open || complete(open)) && pendingLabel.length === 0 && isTariffName(t) && !b.overCols) {
      const cur = target.get()
      const nxt = nextMeaningful(k)
      const nextNamesCharge = nxt !== undefined && nxt.label !== '' && !isFragment(nxt.label) && rowLike(nxt.label)
      if (nextNamesCharge && (cur === null || cur.charges.length > 0 || complete(open))) {
        finish()
        target.switchTo(t.replace(/\s*[:;,-]\s*$/, ''), b.line)
        // A new tariff starts with no season or unit carried over from the last one.
        season = 'all'
        contextUnit = null
        return
      }
    }
    if (open && open.label.length === 0) {
      // Numbers first, label after (City Power style).
      open.label.push(t)
      return
    }
    if (open && complete(open)) {
      const nxt = nextMeaningful(k)
      const labelsNext = nxt !== undefined && nxt.cells !== null && nxt.label === ''
      // Text under a complete row continues its label when it is a fragment ("(c/kWh)"), or when the
      // row's label began above its numbers and this is the season or period it straddles
      // ("Energy charge (c/kWh)" / numbers / "High Season", eThekwini, Damplaas).
      // Once a season heading has been seen ("Summer" over rows), a season word is the next heading.
      const straddle = open.labelFirst && !b.overCols && (open.below ?? 0) === 0 && season === 'all'
        && (detectSeason(t) !== null || detectTou(t) !== null) && t.split(/\s+/).length <= 5
      // A label whose bracket is still open ("Block 3 (351 -") is finished by the next line.
      const joined = open.label.join(' ')
      const unclosed = (joined.match(/\(/g) ?? []).length > (joined.match(/\)/g) ?? []).length
      if (!b.overCols && (unclosed || (!labelsNext && (isFragment(t) || straddle)))) {
        open.label.push(t)
        open.below = (open.below ?? 0) + 1
        return
      }
      finish()
    } else if (open) {
      // An incomplete row with a label is a heading after all ("Summer" above a row), or dies here.
      finish()
    }
    pendingLabel.push(t)
  })
  finish()
  // A charge label left with no numbers at the end of a table: a value is missing, or labels and
  // numbers are out of step somewhere above (every row after the slip carries the wrong label).
  for (const t of pendingLabel) {
    if (!rowLike(t) || detectSeason(t)) continue
    // Prose between tables ("*Energy charges exclude VAT.") is not a leftover row label.
    if (t.trim().split(/\s+/).length > 8 || /[.;]\s*$|\.\s+[A-Z]/.test(t) || /^\*/.test(t)) continue
    const at = body[body.length - 1]
    // "Charge:" or "(c/kWh)" alone is the tail of a label wrapped below its numbers: review.
    const names = parseBlockRange(t) !== null || /^part\s*\d|\bblock\s*\d/i.test(t) || (!isFragment(t) && t.trim().split(/\s+/).length >= 2)
    dropRow(out, target.get(), { label: t, raw: '', reason: 'charge label with no numbers at the end of the table', locator: { file_sha256: sha, page: at.page, line: at.no } }, names ? 'block' : 'review')
  }
}

interface EmitCtx {
  cols: Column[]
  recIdx: number
  draft: TariffDraft | null
  sha: string
  out: ParsedRfd
  pcts: number[]
  season: TariffSeason
  contextUnit: TariffUnit | null
  tableUnit: TariffUnit | null
  style: DecimalStyle
}

function emitRow(r: Row, x: EmitCtx): void {
  let label = cleanLabel(r.label.join(' ')).replace(/\s*\/\s*/g, '/')
  // "Demand charge: High/Low Demand season" is one charge for both seasons, not a low-season one.
  if (/\bhigh\/low\b|\blow\/high\b|summer\/winter|winter\/summer/i.test(label)) label = `${label} [all seasons]`
  const recSeg = r.cells.get(x.recIdx)
  const locator = { file_sha256: x.sha, page: r.page, line: r.recLine ?? r.line }
  if (!recSeg) {
    // Numbers without a Recommended value (a heading row, or a blank Recommended cell).
    if ([...r.cells.values()].some((s) => isAmountTok(s.text))) {
      dropRow(x.out, x.draft, { label: label || '(no label)', raw: [...r.cells.values()].map((s) => s.text).join(' | '), reason: 'row has no Recommended value', locator }, 'review')
    }
    return
  }
  const priorIdx = checkColumn(x.cols, 'prior', x.recIdx)
  const pctIdx = checkColumn(x.cols, 'recommended_pct', x.recIdx)
  const priorSeg = priorIdx >= 0 ? r.cells.get(priorIdx) : undefined
  const pctSeg = pctIdx >= 0 ? r.cells.get(pctIdx) : undefined
  const dp = { prior: printedDecimals(priorSeg, x.style), recommended: printedDecimals(recSeg, x.style), pct: printedDecimals(pctSeg, x.style) }
  const prior = cellValue(priorSeg, x.style)
  const pct = cellValue(pctSeg, x.style)
  let recommended = cellValue(recSeg, x.style)
  // "R 2,686" under "2.4198 … 11.00%" (Mantsopa mixes marks in one table): when the Recommended
  // cell is an ambiguous comma, the row's own arithmetic decides — only if exactly one reading fits.
  const bare = recSeg.text.replace(/^R\s?/, '').trim()
  if (AMBIGUOUS_COMMA.test(bare) && prior !== null && pct !== null && !AMBIGUOUS_COMMA.test(priorSeg?.text.replace(/^R\s?/, '').trim() ?? '')) {
    const asDecimal = Number(bare.replace(',', '.'))
    const asThousands = Number(bare.replace(',', ''))
    const fits = [
      checkRow(prior, asDecimal, pct, { ...dp, recommended: 3 }).kind === 'ok' ? asDecimal : null,
      checkRow(prior, asThousands, pct, { ...dp, recommended: 0 }).kind === 'ok' ? asThousands : null,
    ].filter((v): v is number => v !== null)
    if (fits.length === 1) {
      recommended = fits[0]
      dp.recommended = fits[0] === asDecimal ? 3 : 0
    }
  }
  // Settled by the table's decimal mark alone, not by the row: a ratio check cannot tell 2419 -> 2686
  // from 2.419 -> 2.686, so say so (block when the Approved cell was ambiguous too).
  const settledByArithmetic = AMBIGUOUS_COMMA.test(bare) && prior !== null && pct !== null
    && !AMBIGUOUS_COMMA.test(priorSeg?.text.replace(/^R\s?/, '').trim() ?? '')
  const styleOnly = AMBIGUOUS_COMMA.test(bare) && recommended !== null && !settledByArithmetic
  const priorAmbiguous = AMBIGUOUS_COMMA.test(priorSeg?.text.replace(/^R\s?/, '').trim() ?? '')
  if (recommended === null || recSeg.text.endsWith('%')) {
    if (AMBIGUOUS_COMMA.test(recSeg.text.replace(/^R\s?/, ''))) {
      dropRow(x.out, x.draft, { label: label || '(no label)', raw: recSeg.text, reason: 'the table does not show whether its comma is a decimal or a thousands separator', locator }, 'block')
    } else if (!DASH.test(recSeg.text)) {
      dropRow(x.out, x.draft, { label: label || '(no label)', raw: recSeg.text, reason: 'Recommended cell is not an amount', locator }, 'review')
    }
    return
  }
  if (label === '') {
    dropRow(x.out, x.draft, { label: '(no label)', raw: recSeg.text, reason: 'Recommended value without a label', locator }, 'block')
    return
  }
  const rawValue = recSeg.text
  if (!x.draft) {
    x.out.unresolved.push({ label, raw: rawValue, reason: 'row of a tariff table without a name', locator })
    return
  }
  const draft = x.draft
  const res = normaliseCharge({
    label,
    amount: { value: recommended, unitText: null, randPrefix: /^R/.test(rawValue), raw: rawValue },
    rawValue, unitColumn: null, contextUnit: x.contextUnit, headerUnit: x.tableUnit,
    // "Export Low Season Peak", "SSEG Feed-in Tariff": a rate for energy exported, never an import rate.
    componentHint: /\bexport\b|feed[- ]?in/i.test(label) ? 'export_credit' : null,
    seasonState: { energy: x.season, general: 'all' },
    blockText: null, vatBasis: 'assumed_excl', extractionMethod: 'parser',
    locator: { ...locator, raw_text: `${label} = ${rawValue} (recommended)` },
  })
  if (!res.ok) {
    dropRow(x.out, draft, res.unresolved, 'block')
    return
  }
  draft.charges.push(res.charge)
  x.out.issues.push(...res.issues)
  if (styleOnly) {
    x.out.issues.push({
      code: 'rfd_row_unverified', severity: priorAmbiguous ? 'block' : 'review', tariff: draft.name, locator: res.charge.sourceLocator,
      message: `"${label}": "${rawValue}" read as ${recommended} from the table's decimal mark only; the row's arithmetic cannot confirm a comma's meaning`,
    })
  }

  // Self-consistency: Recommended ≈ 2025/26 Approved × (1 + Recommended %).
  if (pct !== null) x.pcts.push(pct)
  const verdict = checkRow(prior, recommended, pct, dp)
  if (verdict.kind !== 'ok') {
    x.out.issues.push({
      code: verdict.kind === 'unverified' ? 'rfd_row_unverified' : 'rfd_row_increase_mismatch',
      severity: verdict.kind === 'gross' ? 'block' : 'review',
      message: `"${label}": ${verdict.message}`,
      tariff: draft.name,
      locator: res.charge.sourceLocator,
    })
  }
}

/**
 * A row that could not become a charge. It is kept in `unresolved`, and the tariff it belonged to
 * carries an issue: a tariff missing one of its rows prices a bill wrongly while looking complete
 * ("Part 1 - First 50 kWh  Free" gone leaves a flat rate). `block` where a rate or a tier was
 * certainly lost; `review` where the line may have been a heading.
 */
function dropRow(out: ParsedRfd, draft: TariffDraft | null, u: Unresolved, severity: 'block' | 'review'): void {
  out.unresolved.push(u)
  if (!draft) return
  out.issues.push({
    code: 'rfd_row_dropped', severity, tariff: draft.name, locator: u.locator,
    message: `"${u.label}"${u.raw ? ` (${u.raw})` : ''} not read: ${u.reason}; the tariff may be incomplete`,
  })
}

/**
 * The column a row is checked against. Two candidates (2024/25 and 2025/26 Approved; two "%"
 * columns) are resolved only by the 2025/26 year or by sitting right beside Recommended; otherwise
 * the row is left unchecked rather than checked against the wrong number.
 */
function checkColumn(cols: Column[], kind: 'prior' | 'recommended_pct', recIdx: number): number {
  const idx = cols.flatMap((c, k) => (c.kind === kind ? [k] : []))
  if (idx.length <= 1) return idx[0] ?? -1
  const pick = kind === 'prior'
    ? idx.filter((k) => /2025\/26|2025-26|25\/26/.test(cols[k].text))
    : idx.filter((k) => k === recIdx + 1)
  return pick.length === 1 ? pick[0] : -1
}

export type RowVerdict = { kind: 'ok' } | { kind: 'unverified' | 'mismatch' | 'gross'; message: string }

/**
 * Recommended against Approved × (1 + Recommended %), within rounding: never looser than 0.02
 * absolute or 0.1 % relative, and no looser than the decimals the row prints allow (so on an R/kWh
 * rate printed to 2 places the allowance is ~0.01, not 0.02 — a Proposed value 1 % away cannot hide
 * in it). More than 5 % off (relative) is gross.
 */
export function checkRow(
  prior: number | null, recommended: number, pct: number | null,
  dp: { prior: number; recommended: number; pct: number } = { prior: 4, recommended: 4, pct: 4 },
): RowVerdict {
  if (prior === null || pct === null) {
    return { kind: 'unverified', message: `recommended ${recommended} could not be checked (the row gives ${prior === null ? 'no 2025/26 approved value' : 'no recommended % increase'})` }
  }
  if (prior === 0) {
    return { kind: 'unverified', message: `recommended ${recommended} could not be checked (2025/26 approved is 0)` }
  }
  const expected = prior * (1 + pct / 100)
  const diff = Math.abs(recommended - expected)
  const half = (d: number): number => 0.5 * 10 ** -d
  const rounding = half(dp.recommended) + Math.abs(1 + pct / 100) * half(dp.prior) + (Math.abs(prior) * half(dp.pct)) / 100
  const allowed = Math.min(rounding, Math.max(0.02, Math.abs(expected) * 0.001))
  if (diff <= allowed + 1e-9) return { kind: 'ok' }
  const computed = (recommended / prior - 1) * 100
  const message = `${prior} -> ${recommended} is ${computed.toFixed(2)}%, the row says ${pct}% (expected ${expected.toFixed(4)})`
  return { kind: diff > Math.abs(expected) * 0.05 ? 'gross' : 'mismatch', message }
}

/** Two charges a bill cannot tell apart: an exact repeat is dropped, a conflicting one blocks. */
function dedupe(d: TariffDraft, issues: TariffIssue[]): void {
  const key = (c: Charge): string => [c.component, c.season, c.tou, c.dayType, c.blockMinKwh, c.blockMaxKwh, c.unit].join('|')
  const seen = new Map<string, Charge>()
  const keep: Charge[] = []
  for (const c of d.charges) {
    const k = key(c)
    const first = seen.get(k)
    if (!first) {
      seen.set(k, c)
      keep.push(c)
      continue
    }
    if (first.amountExclVat === c.amountExclVat) {
      issues.push({ code: 'rfd_duplicate_charge', severity: first.label === c.label ? 'warn' : 'review', message: `"${c.label}" repeats "${first.label}" (${c.amountExclVat}); kept once`, tariff: d.name, locator: c.sourceLocator })
      continue
    }
    issues.push({ code: 'rfd_duplicate_charge', severity: 'block', message: `"${c.label}" (${c.amountExclVat}) and "${first.label}" (${first.amountExclVat}) are the same ${c.component} charge to a bill: the table's season/TOU/block context was not read`, tariff: d.name, locator: c.sourceLocator })
    keep.push(c)
  }
  d.charges = keep
  // Energy priced for one season only (a lost "Summer"/"Winter" heading) bills the other at nothing.
  const energy = keep.filter((c) => c.component === 'energy')
  const has = (s: TariffSeason): boolean => energy.some((c) => c.season === s)
  if (has('high') !== has('low')) {
    issues.push({
      code: 'rfd_season_incomplete', severity: 'block', tariff: d.name, locator: energy.find((c) => c.season !== 'all')?.sourceLocator,
      message: `energy is priced for the ${has('high') ? 'high' : 'low'} season only: the other season's rows were not read`,
    })
  }
}

