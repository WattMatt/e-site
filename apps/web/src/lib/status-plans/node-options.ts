/**
 * The searchable list a shape is linked from. A tenant layout links tenant
 * boards only (the slice-1 trigger refuses anything else); a schematic links
 * any live board. A board is on a plan at most once (unique key), so a board
 * held by ANOTHER shape is listed but disabled — hiding it would make a person
 * think the board is missing from the schedule.
 */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import type { CanvasShape, PlanNode } from './types'

export interface NodeOption {
  id: string
  label: string
  sub: string | null
  disabled: boolean
  reason: string | null
}

const KIND_LABEL: Record<string, string> = {
  tenant_db: 'Tenant DB',
  main_board: 'Main board',
  common_area_board: 'Common area board',
  common_area_lighting: 'Common area lighting',
}

export function nodeLabel(n: PlanNode, purpose: StatusPlanPurpose): string {
  return purpose === 'tenant_layout' ? `${n.shopNumber ?? n.code} — ${n.shopName ?? 'No name'}` : n.code
}

export function buildNodeOptions(
  nodes: ReadonlyArray<PlanNode>,
  shapes: ReadonlyArray<CanvasShape>,
  selectedShapeId: string | null,
  purpose: StatusPlanPurpose,
): NodeOption[] {
  const holder = new Map<string, string>()
  for (const s of shapes) if (s.nodeId) holder.set(s.nodeId, s.id)

  return nodes
    .filter((n) => purpose !== 'tenant_layout' || n.kind === 'tenant_db')
    .map((n) => {
      const heldBy = holder.get(n.id)
      const used = heldBy !== undefined && heldBy !== selectedShapeId
      const sub = purpose === 'tenant_layout'
        ? [n.code, n.decommissioned ? 'decommissioned' : null].filter(Boolean).join(' · ')
        : [KIND_LABEL[n.kind] ?? n.kind, n.shopName].filter(Boolean).join(' · ')
      return {
        id: n.id,
        label: nodeLabel(n, purpose),
        sub: sub || null,
        disabled: used,
        reason: used ? 'Already on this plan' : null,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' }))
}

export function filterNodeOptions(options: ReadonlyArray<NodeOption>, query: string): NodeOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...options]
  return options.filter((o) => {
    const hay = `${o.label} ${o.sub ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}
