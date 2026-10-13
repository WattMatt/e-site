/**
 * What the sheet scan shows (spec §5): proposals sorted into
 * matched · need you · part of a main board · without a tag, with blocks
 * already on the plan left out. A part-of row (a main board's meter or
 * incomer, "MB-1.1 BULK CHECK METER") is not a board: it never needs a person
 * and is never in Accept all; it can still be added unlinked.
 */
import { detectBlocks, type DetectedBlock, type DetectResult, type RejectedBlock } from './detect-blocks'
import { boundingBox, type Box } from './geometry'
import { buildNodeIndex, matchBlock, type BlockMatch, type MatchableNode } from './match-nodes'
import type { ImageTextItem } from './text-space'

export type ReviewCategory = 'matched' | 'needs_you' | 'part_of' | 'no_tag'

export interface ExistingShapeRef {
  id: string
  points: readonly number[]
  nodeId: string | null
}

export interface ReviewRow {
  /** Unique within one detection run. */
  key: string
  block: DetectedBlock
  match: BlockMatch
  category: ReviewCategory
  /** The board a one-click accept links (matched rows only). */
  nodeId: string | null
  /** Boards to offer first in the picker. */
  candidateIds: string[]
  /** A candidate the picker starts on (a dots-only or unconfirmed match); null otherwise. */
  preselectId: string | null
  /** Why a person is needed; null for matched rows. */
  reason: string | null
}

export interface DetectionReview {
  labelCount: number
  rows: ReviewRow[]
  /** Blocks left out because a block-sized shape already covers them. */
  alreadyOnPlan: number
  rejected: RejectedBlock[]
  counts: { detected: number; matched: number; needsYou: number; partOf: number; noTag: number }
}

export type DetectionOutcome =
  | { kind: 'no_text' }
  | { kind: 'not_upright' }
  | { kind: 'no_blocks'; labelCount: number; rejected: RejectedBlock[] }
  | { kind: 'review'; review: DetectionReview }

export const DETECTED_TAG_MAX = 64

function boxArea(b: Box): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

/**
 * Whether an existing shape is the same block already drawn: it covers at least
 * half of the detected block AND is itself block-sized (at most 4× its area),
 * so a big manual rectangle round several blocks does not hide them.
 */
export function coversBlock(existing: Box, block: Box): boolean {
  const w = Math.min(existing.maxX, block.maxX) - Math.max(existing.minX, block.minX)
  const h = Math.min(existing.maxY, block.maxY) - Math.max(existing.minY, block.minY)
  if (w <= 0 || h <= 0) return false
  const blockArea = boxArea(block)
  return w * h >= 0.5 * blockArea && boxArea(existing) <= 4 * blockArea
}

/** Positive-area intersection; boxes that only touch do not overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

function rowFor(key: string, block: DetectedBlock, match: BlockMatch, used: ReadonlySet<string>): ReviewRow {
  const base = { key, block, match, preselectId: null as string | null }
  switch (match.state) {
    case 'no_tag':
      return { ...base, category: 'no_tag', nodeId: null, candidateIds: [], reason: block.tag ? `"${block.tag}" in NO: is not a board tag; choose the board.` : 'This block has no NO: value.' }
    case 'unconfirmed': {
      const one = match.candidateIds.length === 1 && !used.has(match.candidateIds[0]!) ? match.candidateIds[0]! : null
      return { ...base, category: 'needs_you', nodeId: null, candidateIds: match.candidateIds, preselectId: one, reason: `NO: reads "${match.text}" — confirm the board.` }
    }
    case 'part_of':
      return { ...base, category: 'part_of', nodeId: null, candidateIds: [], reason: `Part of ${match.tag} — not a separate board.` }
    case 'matched':
      if (used.has(match.nodeId)) {
        return { ...base, category: 'needs_you', nodeId: null, candidateIds: [], reason: `${block.tag} matches a board that is already on this plan.` }
      }
      return { ...base, category: 'matched', nodeId: match.nodeId, candidateIds: [match.nodeId], reason: null }
    case 'ambiguous':
      if (match.dotsOnly) {
        return { ...base, category: 'needs_you', nodeId: null, candidateIds: match.candidateIds, preselectId: match.candidateIds.length === 1 ? match.candidateIds[0]! : null, reason: `${block.tag} matches ${match.candidateIds.length === 1 ? 'a board' : 'boards'} only if the dots are ignored; confirm the board.` }
      }
      if (match.zerosOnly) {
        return { ...base, category: 'needs_you', nodeId: null, candidateIds: match.candidateIds, reason: `${block.tag} matches ${match.candidateIds.length} boards once leading zeros are ignored; choose one.` }
      }
      return { ...base, category: 'needs_you', nodeId: null, candidateIds: match.candidateIds, reason: `${block.tag} matches ${match.candidateIds.length} boards; choose one.` }
    case 'unmatched':
      return { ...base, category: 'needs_you', nodeId: null, candidateIds: [], reason: `No board in this project has the tag ${block.tag}.` }
  }
}

export function reviewDetection(
  result: DetectResult,
  nodes: readonly MatchableNode[],
  existing: readonly ExistingShapeRef[],
): DetectionReview {
  const index = buildNodeIndex(nodes)
  const existingBoxes = existing.map((s) => boundingBox(s.points))
  const used = new Set(existing.flatMap((s) => (s.nodeId ? [s.nodeId] : [])))
  const rows: ReviewRow[] = []
  let alreadyOnPlan = 0

  result.blocks.forEach((block, i) => {
    if (existingBoxes.some((b) => coversBlock(b, block.box))) { alreadyOnPlan++; return }
    rows.push(rowFor(`block-${i}`, block, matchBlock(block, index), used))
  })

  // A board can be on a plan once: proposals that read as the same board all need a person.
  const claims = new Map<string, number>()
  for (const r of rows) if (r.category === 'matched' && r.nodeId) claims.set(r.nodeId, (claims.get(r.nodeId) ?? 0) + 1)
  for (const r of rows) {
    const n = r.nodeId ? claims.get(r.nodeId) ?? 0 : 0
    if (r.category === 'matched' && r.nodeId && n > 1) {
      r.category = 'needs_you'
      r.candidateIds = [r.nodeId]
      r.reason = `${n} blocks on this page read as the same board; choose the board for each.`
      r.nodeId = null
    }
  }

  const count = (c: ReviewCategory) => rows.filter((r) => r.category === c).length
  return {
    labelCount: result.labelCount,
    rows,
    alreadyOnPlan,
    rejected: result.rejected,
    counts: { detected: rows.length, matched: count('matched'), needsYou: count('needs_you'), partOf: count('part_of'), noTag: count('no_tag') },
  }
}

export function detectionSummary(r: DetectionReview): string {
  const { detected, matched, needsYou, partOf, noTag } = r.counts
  const parts = [`${matched} matched`, `${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you`]
  if (partOf > 0) parts.push(partOf === 1 ? '1 part of a main board' : `${partOf} parts of main boards`)
  if (noTag > 0) parts.push(`${noTag} without a tag`)
  return `Scanned this sheet — ${detected} ${detected === 1 ? 'block' : 'blocks'}: ${parts.join(' · ')}`
}

export function runDetection(
  items: readonly ImageTextItem[],
  nodes: readonly MatchableNode[],
  existing: readonly ExistingShapeRef[],
  rawItemCount: number = items.length,
): DetectionOutcome {
  if (items.length === 0) return rawItemCount > 0 ? { kind: 'not_upright' } : { kind: 'no_text' }
  const result = detectBlocks(items)
  if (result.blocks.length === 0) return { kind: 'no_blocks', labelCount: result.labelCount, rejected: result.rejected }
  return { kind: 'review', review: reviewDetection(result, nodes, existing) }
}

/** What status_plan_shapes.detected_tag stores for an accepted block. */
export function detectedTagFor(block: Pick<DetectedBlock, 'tag' | 'name'>): string | null {
  const raw = block.tag ?? (block.name ? `NAME: ${block.name}` : null)
  return raw ? Array.from(raw).slice(0, DETECTED_TAG_MAX).join('') : null
}
