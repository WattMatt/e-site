/**
 * What the SHOP labels on a floor plan say about the shapes drawn on it
 * (spec 2026-10-21 §4.3). One row per label, sorted by what the person can do:
 * it is already on the plan, it can be linked, it must be drawn, it conflicts,
 * a person must choose, or the schedule does not have it.
 *
 * A label is never linked when it is a duplicate, when the match is not unique,
 * or when it would take a shape or a tenant that is already linked: those are
 * `needs_you` or `conflict`, and a person decides. Pure: nothing is stored.
 */
import { AREA_TOLERANCE } from './area-check'
import type { DetectedShopLabel, ShopLabelResult } from './detect-shop-labels'
import { pointInShape, shapeAreaPx } from './geometry'
import { buildNodeIndex, matchBlock, normaliseTag, stripLeadingZeros, type BlockMatch, type MatchableNode } from './match-nodes'

export type ShopRowState = 'linked' | 'linked_outside' | 'link' | 'conflict' | 'draw' | 'needs_you' | 'not_on_schedule' | 'moved'

export const SHOP_ROW_STATES: readonly ShopRowState[] = ['linked', 'linked_outside', 'link', 'conflict', 'draw', 'needs_you', 'not_on_schedule', 'moved']

export interface ShopReviewShape {
  id: string
  points: readonly number[]
  nodeId: string | null
  /** Set on a typed non-tenant area (mall, store room): it never holds a shop. */
  areaType: string | null
}

export interface ShopReviewNode extends MatchableNode {
  /** The schedule's m² for this tenant, or null. */
  scheduledM2: number | null
  decommissioned: boolean
}

export interface ShopReviewInput {
  labels: ShopLabelResult
  nodes: readonly ShopReviewNode[]
  shapes: readonly ShopReviewShape[]
  /** The sheet was re-uploaded and not yet re-anchored (`replaced_at` set). */
  replaced: boolean
}

export interface ShopReviewRow {
  /** Unique within one review. */
  key: string
  label: DetectedShopLabel
  state: ShopRowState
  /** The tenant the label matched; null for needs_you and not_on_schedule. */
  nodeId: string | null
  /** The shape the row acts on: the one containing the label, or the tenant's own for linked_outside / moved. */
  shapeId: string | null
  /** conflict only: the shape the matched tenant is already linked to, when that is the clash. */
  otherShapeId: string | null
  candidateIds: string[]
  /** Why a person is needed or what is odd; null for plain rows. */
  reason: string | null
  /** Drawing m² against schedule m², when they differ by more than AREA_TOLERANCE. */
  areaNote: string | null
}

export interface ShopReview {
  rows: ShopReviewRow[]
  /** Shapes (not areas) that no row acts on: nothing was labelled inside them. */
  unlabelled: string[]
  counts: Record<ShopRowState, number>
  duplicates: Record<string, number>
  labelCount: number
  textItemCount: number
}

function tagOf(n: MatchableNode): string {
  return n.shop_number ?? n.code ?? n.name ?? n.id
}

function candidatesOf(m: BlockMatch): string[] {
  if (m.state === 'matched') return [m.nodeId]
  if (m.state === 'ambiguous' || m.state === 'unconfirmed') return m.candidateIds
  return []
}

function areaNoteFor(label: DetectedShopLabel, node: ShopReviewNode): string | null {
  const drawn = label.drawingAreaM2
  const scheduled = node.scheduledM2
  if (drawn == null || scheduled == null || !(scheduled > 0)) return null
  if (Math.abs(drawn - scheduled) / scheduled <= AREA_TOLERANCE) return null
  return `drawing says ${drawn.toFixed(2)} m², schedule says ${scheduled.toFixed(2)} m²`
}

export function reviewShopLabels(input: ShopReviewInput): ShopReview {
  const { labels, nodes, shapes, replaced } = input
  const live = nodes.filter((n) => !n.decommissioned)
  const liveIndex = buildNodeIndex(live)
  const goneIndex = buildNodeIndex(nodes.filter((n) => n.decommissioned))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  // Smallest first, so the first containing shape is the one that wins an overlap.
  const holders = shapes.filter((s) => s.areaType == null).map((s) => ({ s, area: shapeAreaPx(s.points) })).sort((a, b) => a.area - b.area)

  const rows: ShopReviewRow[] = labels.labels.map((label, i): ShopReviewRow => {
    const norm = normaliseTag(label.tag)
    const dupes = labels.duplicates[stripLeadingZeros(norm)] ?? 0
    const base = { key: dupes > 1 ? `${norm}#${i}` : norm, label, nodeId: null, shapeId: null, otherShapeId: null, candidateIds: [] as string[], reason: null, areaNote: null }
    const match = matchBlock({ tag: label.tag, name: label.name }, liveIndex)

    if (dupes > 1) {
      return { ...base, state: 'needs_you', candidateIds: candidatesOf(match), reason: `${dupes} labels on this sheet read as SHOP ${label.tag}; choose the shop for each.` }
    }
    if (match.state === 'ambiguous' || match.state === 'unconfirmed') {
      const reason = match.state === 'unconfirmed' ? `SHOP ${label.tag} reads "${match.text}"; confirm the shop.` : `SHOP ${label.tag} matches ${match.candidateIds.length} shops; choose one.`
      return { ...base, state: 'needs_you', candidateIds: match.candidateIds, reason }
    }
    if (match.state !== 'matched') {
      // Not among the live shops: say so, and say when the schedule has it as decommissioned.
      const gone = candidatesOf(matchBlock({ tag: label.tag, name: label.name }, goneIndex)).length > 0
      const unreadable = match.state === 'no_tag' || match.state === 'part_of'
      return { ...base, state: 'not_on_schedule', reason: gone ? 'decommissioned' : unreadable ? 'tag could not be read' : 'not on the schedule' }
    }

    const node = nodeById.get(match.nodeId)!
    const here = holders.find((h) => pointInShape(label.anchor.x, label.anchor.y, h.s.points))?.s ?? null
    const own = shapes.find((s) => s.nodeId === node.id) ?? null
    const row = { ...base, nodeId: node.id, candidateIds: [node.id], areaNote: areaNoteFor(label, node) }

    if (here) {
      if (here.nodeId === node.id) return { ...row, state: 'linked', shapeId: here.id }
      if (here.nodeId) {
        const other = nodeById.get(here.nodeId)
        const otherName = other ? tagOf(other) : 'another shop'
        return { ...row, state: 'conflict', shapeId: here.id, reason: `SHOP ${label.tag} sits in a shape linked to ${otherName}.` }
      }
      if (own) {
        return { ...row, state: 'conflict', shapeId: here.id, otherShapeId: own.id, reason: `${tagOf(node)} is already linked to another shape; SHOP ${label.tag} sits in an unlinked one.` }
      }
      return { ...row, state: 'link', shapeId: here.id }
    }
    if (own) {
      return replaced
        ? { ...row, state: 'moved', shapeId: own.id, reason: 'the sheet was replaced and the label is no longer inside its shape' }
        : { ...row, state: 'linked_outside', shapeId: own.id, reason: 'label outside the shape' }
    }
    return { ...row, state: 'draw' }
  })

  // Two labels in one unlinked shape: the link action takes a shape once, so neither is offered as a link.
  const linkClaims = new Map<string, ShopReviewRow[]>()
  for (const r of rows) {
    if (r.state === 'link' && r.shapeId) linkClaims.set(r.shapeId, [...(linkClaims.get(r.shapeId) ?? []), r])
  }
  for (const claimants of linkClaims.values()) {
    if (claimants.length < 2) continue
    const reason = `two labels inside one shape: ${claimants.map((r) => r.label.tag).join(', ')}`
    for (const r of claimants) { r.state = 'conflict'; r.reason = reason }
  }

  const used = new Set(rows.flatMap((r) => (r.shapeId ? [r.shapeId] : [])))
  for (const r of rows) if (r.otherShapeId) used.add(r.otherShapeId)
  const unlabelled = holders.filter((h) => !used.has(h.s.id)).map((h) => h.s.id)

  const counts = Object.fromEntries(SHOP_ROW_STATES.map((s) => [s, 0])) as Record<ShopRowState, number>
  for (const r of rows) counts[r.state]++

  return { rows, unlabelled, counts, duplicates: labels.duplicates, labelCount: labels.labels.length, textItemCount: labels.textItemCount }
}

const n = (v: number) => v.toLocaleString('en-US')

export function shopReviewSummary(r: ShopReview): string {
  if (r.labelCount === 0) return 'No SHOP labels found on this sheet; draw the shops by hand.'
  const c = r.counts
  const dupes = Object.keys(r.duplicates).length
  const parts = [
    `${n(r.labelCount)} ${r.labelCount === 1 ? 'label' : 'labels'}`,
    `${n(r.textItemCount)} ${r.textItemCount === 1 ? 'item' : 'items'} read`,
    `${n(c.linked + c.linked_outside)} on the plan`,
    ...(c.moved > 0 ? [`${n(c.moved)} moved`] : []),
    `${n(c.link)} to link`,
    `${n(c.draw)} to draw`,
    `${n(c.conflict)} ${c.conflict === 1 ? 'conflict' : 'conflicts'}`,
    `${n(c.needs_you)} ${c.needs_you === 1 ? 'needs' : 'need'} you`,
    `${n(c.not_on_schedule)} not on the schedule`,
    `${n(dupes)} ${dupes === 1 ? 'duplicate' : 'duplicates'}`,
  ]
  return parts.join(' · ')
}
