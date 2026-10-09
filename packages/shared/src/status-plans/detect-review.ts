/**
 * What the Detect blocks panel shows (spec §5): proposals sorted into
 * matched · need you · without a tag, with blocks already on the plan left out.
 */
import { detectBlocks, type DetectedBlock, type DetectResult, type RejectedBlock } from './detect-blocks'
import { boundingBox, type Box } from './geometry'
import { buildNodeIndex, matchBlock, type BlockMatch, type MatchableNode } from './match-nodes'
import type { ImageTextItem } from './text-space'

export type ReviewCategory = 'matched' | 'needs_you' | 'no_tag'

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
  /** Why a person is needed; null for matched rows. */
  reason: string | null
}

export interface DetectionReview {
  labelCount: number
  rows: ReviewRow[]
  /** Blocks left out because they overlap a shape already on the plan. */
  alreadyOnPlan: number
  rejected: RejectedBlock[]
  counts: { detected: number; matched: number; needsYou: number; noTag: number }
}

export type DetectionOutcome =
  | { kind: 'no_text' }
  | { kind: 'no_blocks'; labelCount: number; rejected: RejectedBlock[] }
  | { kind: 'review'; review: DetectionReview }

export const DETECTED_TAG_MAX = 64

/** Positive-area intersection; boxes that only touch do not overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

function rowFor(key: string, block: DetectedBlock, match: BlockMatch, used: ReadonlySet<string>): ReviewRow {
  const base = { key, block, match }
  switch (match.state) {
    case 'no_tag':
      return { ...base, category: 'no_tag', nodeId: null, candidateIds: [], reason: block.tag ? `"${block.tag}" in NO: is not a board tag; choose the board.` : 'This block has no NO: value.' }
    case 'matched':
      if (used.has(match.nodeId)) {
        return { ...base, category: 'needs_you', nodeId: null, candidateIds: [], reason: `${block.tag} matches a board that is already on this plan.` }
      }
      return { ...base, category: 'matched', nodeId: match.nodeId, candidateIds: [match.nodeId], reason: null }
    case 'ambiguous':
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
    if (existingBoxes.some((b) => boxesOverlap(b, block.box))) { alreadyOnPlan++; return }
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
    counts: { detected: rows.length, matched: count('matched'), needsYou: count('needs_you'), noTag: count('no_tag') },
  }
}

export function detectionSummary(r: DetectionReview): string {
  const { detected, matched, needsYou, noTag } = r.counts
  return `Detected ${detected} ${detected === 1 ? 'block' : 'blocks'} — ${matched} matched · ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you · ${noTag} without a tag`
}

export function runDetection(
  items: readonly ImageTextItem[],
  nodes: readonly MatchableNode[],
  existing: readonly ExistingShapeRef[],
): DetectionOutcome {
  if (items.length === 0) return { kind: 'no_text' }
  const result = detectBlocks(items)
  if (result.blocks.length === 0) return { kind: 'no_blocks', labelCount: result.labelCount, rejected: result.rejected }
  return { kind: 'review', review: reviewDetection(result, nodes, existing) }
}

/** What status_plan_shapes.detected_tag stores for an accepted block. */
export function detectedTagFor(block: Pick<DetectedBlock, 'tag' | 'name'>): string | null {
  const raw = block.tag ?? (block.name ? `NAME: ${block.name}` : null)
  return raw ? Array.from(raw).slice(0, DETECTED_TAG_MAX).join('') : null
}
