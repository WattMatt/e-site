/** Dependency links between schedule tasks (spec §14.2): four types with lag days. */
export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const
export type LinkType = (typeof LINK_TYPES)[number]
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish',
}

export interface ScheduleLink {
  readonly predecessorId: string
  readonly successorId: string
  readonly type: LinkType
  /** Whole days, in the schedule's duration mode; negative = lead. */
  readonly lagDays: number
}

export const isLinkType = (v: unknown): v is LinkType => (LINK_TYPES as readonly unknown[]).includes(v)
export const linkKey = (l: Pick<ScheduleLink, 'predecessorId' | 'successorId'>): string => `${l.predecessorId}>${l.successorId}`

export type TopoResult = { ok: true; order: string[] } | { ok: false; cycle: string[] }

/** Kahn's algorithm. Links whose ends are not both in `ids` are ignored. */
export function topoOrder(ids: readonly string[], links: readonly ScheduleLink[]): TopoResult {
  const known = new Set(ids)
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]))
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const l of links) {
    if (!known.has(l.predecessorId) || !known.has(l.successorId)) continue
    succ.get(l.predecessorId)!.push(l.successorId)
    pred.get(l.successorId)!.push(l.predecessorId)
    indeg.set(l.successorId, indeg.get(l.successorId)! + 1)
  }
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const done = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    done.add(id)
    for (const s of succ.get(id)!) {
      const n = indeg.get(s)! - 1
      indeg.set(s, n)
      if (n === 0) queue.push(s)
    }
  }
  if (queue.length === ids.length) return { ok: true, order: queue }
  // Every task left over has a predecessor that is also left over: walk back until one repeats.
  const left = new Set(ids.filter((id) => !done.has(id)))
  let cur = [...left][0]
  const seen: string[] = []
  while (!seen.includes(cur)) {
    seen.push(cur)
    cur = pred.get(cur)!.find((p) => left.has(p)) as string
  }
  return { ok: false, cycle: seen.slice(seen.indexOf(cur)).reverse() }
}

export function findCycle(ids: readonly string[], links: readonly ScheduleLink[]): string[] | null {
  const r = topoOrder(ids, links)
  return r.ok ? null : r.cycle
}

/** Would adding `candidate` create a loop (or a self link)? */
export function linkWouldCycle(ids: readonly string[], links: readonly ScheduleLink[], candidate: ScheduleLink): boolean {
  if (candidate.predecessorId === candidate.successorId) return true
  return findCycle(ids, [...links, candidate]) !== null
}
