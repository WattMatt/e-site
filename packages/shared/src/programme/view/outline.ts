import type { ActivityRow } from '../persistence/rows'

export interface OutlineRow { id: string; depth: number; wbs: string; hasChildren: boolean; collapsed: boolean }

/**
 * The activity tree as the ordered list of rows to show: depth-first, siblings by sort_order (nulls last),
 * then name, then id. Tombstoned activities are left out. `wbs` is `wbs_code` when set, otherwise the
 * position path (`1`, `1.2`, `1.2.3`). A collapsed parent keeps its own row and hides its descendants.
 * An activity whose parent is missing or tombstoned is shown at the top level.
 */
export function outlineRows(activities: ActivityRow[], collapsed: ReadonlySet<string>): OutlineRow[] {
  const live = activities.filter((a) => !a.is_tombstoned)
  const ids = new Set(live.map((a) => a.id))
  const byParent = new Map<string | null, ActivityRow[]>()
  for (const a of live) {
    const p = a.parent_id !== null && ids.has(a.parent_id) ? a.parent_id : null
    const list = byParent.get(p)
    if (list) list.push(a)
    else byParent.set(p, [a])
  }
  const cmp = (x: ActivityRow, y: ActivityRow) => {
    const sx = x.sort_order ?? Number.POSITIVE_INFINITY
    const sy = y.sort_order ?? Number.POSITIVE_INFINITY
    if (sx !== sy) return sx < sy ? -1 : 1
    if (x.name !== y.name) return x.name < y.name ? -1 : 1
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  }
  for (const list of byParent.values()) list.sort(cmp)

  const out: OutlineRow[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number, path: string): void => {
    const kids = byParent.get(parent) ?? []
    kids.forEach((a, i) => {
      if (seen.has(a.id)) return
      seen.add(a.id)
      const here = path === '' ? String(i + 1) : `${path}.${i + 1}`
      const children = byParent.get(a.id) ?? []
      const isCollapsed = collapsed.has(a.id) && children.length > 0
      out.push({ id: a.id, depth, wbs: a.wbs_code ?? here, hasChildren: children.length > 0, collapsed: isCollapsed })
      if (!isCollapsed) walk(a.id, depth + 1, here)
    })
  }
  walk(null, 0, '')
  return out
}
