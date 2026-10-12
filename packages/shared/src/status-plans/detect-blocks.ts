/**
 * DB-block detection on a 300 distribution schematic (spec §5).
 *
 * Input: upright text runs already in image space (text-space.ts).
 * Output: one proposed rectangle per 7-row NO / NAME / AREA / RATING / CABLE /
 * SERIAL / CT table, plus every NO: label that did not start a full table and
 * why (the review panel shows those, so a miss is visible, never silent).
 *
 * Every tolerance is a multiple of the NO: label's own height, so the same
 * rules read an A0 at scale 2 and a reduced print of it.
 *
 * A block is proposed only when all seven labels are found, in order, in one
 * left-aligned column, each row within a table's row gap of the one above.
 * Anything less is REJECTED, never patched: a block missing a row must not
 * borrow the next block's rows. Two independent guards enforce that (the row
 * gap and the expected label), and each has its own test.
 */
import { rectToPoints, type Box } from './geometry'
import type { ImageTextItem } from './text-space'

export const BLOCK_LABELS = ['NO', 'NAME', 'AREA', 'RATING', 'CABLE', 'SERIAL', 'CT'] as const
export type BlockLabel = (typeof BLOCK_LABELS)[number]
export type BlockFields = Record<BlockLabel, string | null>

/** Multiples of the NO: label's height. */
export const DETECT_TOLERANCES = {
  /** Label left edges in one column differ by at most this. */
  column: 0.6,
  /** Baseline-to-baseline gap between consecutive rows: more than … */
  rowGapMin: 0.5,
  /** … and at most this. */
  rowGapMax: 2.5,
  /** A value sits on its label's baseline within this. */
  baseline: 0.35,
  /** A value never starts further right of its label's left edge than this. */
  valueSpan: 25,
  /** Padding round the proposed rectangle. */
  pad: 0.5,
} as const

export interface DetectedBlock {
  /** NO: value (whitespace collapsed), null when the cell is empty. */
  tag: string | null
  /** NAME: value, null when empty. */
  name: string | null
  fields: BlockFields
  box: Box
  /** box as a 4-corner rect (TL, TR, BR, BL) for status_plan_shapes.points. */
  points: number[]
}

export interface RejectedBlock {
  /** Top-left of the NO: label that started the walk. */
  x: number
  y: number
  tag: string | null
  /** A sentence for the review panel. */
  reason: string
}

export interface DetectResult {
  /** NO: labels found on the page. */
  labelCount: number
  blocks: DetectedBlock[]
  rejected: RejectedBlock[]
}

interface Label { item: ImageTextItem; kind: BlockLabel; inline: string }

const LABEL_RE = /^(NO|NAME|AREA|RATING|CABLE|SERIAL|CT)\s*:\s*(.*)$/i

function readLabel(item: ImageTextItem): Label | null {
  const m = LABEL_RE.exec(item.str.trim())
  if (!m) return null
  return { item, kind: m[1].toUpperCase() as BlockLabel, inline: m[2].trim() }
}

function tidy(s: string): string | null {
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/**
 * The value printed right of a label on its baseline: every non-label run that
 * starts after the label and before the nearest OTHER label to the right on
 * the same baseline (a crowded neighbouring block's column), capped at
 * valueSpan label-heights.
 */
function valueOf(
  label: Label,
  labels: readonly Label[],
  labelItems: ReadonlySet<ImageTextItem>,
  items: readonly ImageTextItem[],
  h: number,
): { text: string | null; right: number } {
  const T = DETECT_TOLERANCES
  const own = label.item
  const tol = T.baseline * h
  let limit = own.x + T.valueSpan * h
  for (const l of labels) {
    if (l === label) continue
    if (Math.abs(l.item.baseline - own.baseline) > tol) continue
    if (l.item.x > own.x + T.column * h && l.item.x < limit) limit = l.item.x
  }
  const start = own.x + own.width - 0.2 * h
  const parts = items
    .filter((i) => !labelItems.has(i) && Math.abs(i.baseline - own.baseline) <= tol && i.x >= start && i.x < limit)
    .sort((a, b) => a.x - b.x)
  // Runs split mid-token (a kerned "DB-" + "71") touch; separate words do not.
  let joined = label.inline
  let prevEnd: number | null = joined ? null : own.x + own.width
  for (const p of parts) {
    const glue = prevEnd !== null && p.x - prevEnd < 0.3 * h
    joined = joined ? (glue ? joined + p.str : `${joined} ${p.str}`) : p.str
    prevEnd = p.x + p.width
  }
  const text = tidy(joined)
  const right = parts.reduce((r, p) => Math.max(r, p.x + p.width), own.x + own.width)
  return { text, right }
}

export function detectBlocks(items: readonly ImageTextItem[]): DetectResult {
  const T = DETECT_TOLERANCES
  const labels: Label[] = []
  const labelItems = new Set<ImageTextItem>()
  for (const it of items) {
    const l = readLabel(it)
    if (l) { labels.push(l); labelItems.add(it) }
  }
  const starts = labels
    .filter((l) => l.kind === 'NO')
    .sort((a, b) => a.item.baseline - b.item.baseline || a.item.x - b.item.x)

  const claimed = new Set<Label>()
  const blocks: DetectedBlock[] = []
  const rejected: RejectedBlock[] = []

  for (const no of starts) {
    if (claimed.has(no)) continue
    const h = no.item.height
    const rows: Label[] = [no]
    let failure: string | null = null

    for (const kind of BLOCK_LABELS.slice(1)) {
      const prev = rows[rows.length - 1]
      let next: Label | null = null
      for (const l of labels) {
        if (claimed.has(l) || rows.includes(l)) continue
        if (Math.abs(l.item.x - no.item.x) > T.column * h) continue
        if (l.item.baseline - prev.item.baseline <= T.rowGapMin * h) continue
        if (!next || l.item.baseline < next.item.baseline) next = l
      }
      if (!next || next.item.baseline - prev.item.baseline > T.rowGapMax * h) {
        failure = `the ${kind}: row was not found under ${prev.kind}:`
        break
      }
      if (next.kind !== kind) {
        failure = `expected ${kind}: under ${prev.kind}: but found ${next.kind}:`
        break
      }
      rows.push(next)
    }

    if (failure) {
      const tag = valueOf(no, labels, labelItems, items, h).text
      rejected.push({ x: no.item.x, y: no.item.top, tag, reason: `${tag ?? 'A block with no tag'}: ${failure}.` })
      continue
    }

    rows.forEach((r) => claimed.add(r))
    const fields = {} as BlockFields
    let right = -Infinity
    for (const r of rows) {
      const v = valueOf(r, labels, labelItems, items, h)
      fields[r.kind] = v.text
      right = Math.max(right, v.right)
    }
    const pad = T.pad * h
    const left = Math.min(...rows.map((r) => r.item.x))
    const last = rows[rows.length - 1].item
    const box: Box = {
      minX: left - pad,
      minY: no.item.top - pad,
      maxX: right + pad,
      maxY: last.baseline + 0.25 * h + pad,
    }
    blocks.push({
      tag: fields.NO,
      name: fields.NAME,
      fields,
      box,
      points: rectToPoints(box.minX, box.minY, box.maxX, box.maxY),
    })
  }

  return { labelCount: starts.length, blocks, rejected }
}
