import { ISSUE_SEVERITY } from './types'
import type { ActivityInput, DependencyInput, ProgrammeInput, ScheduleIssue } from './types'
import { validateProgramme } from './validate'

export interface NormalisedProgramme {
  leaves: ActivityInput[]                 // non-summary activities, in topological order
  summaries: ActivityInput[]              // children before parents (post-order)
  childrenOf: Map<string, string[]>       // direct children
  links: DependencyInput[]                // after summary expansion; expanded links keep the source id
  predsOf: Map<string, DependencyInput[]>
  succsOf: Map<string, DependencyInput[]>
}

/** Finds one cycle. Returns the path with the first id repeated at the end, or null. */
export function findCycle(nodes: string[], edges: Array<[string, string]>): string[] | null {
  const out = new Map<string, string[]>()
  for (const n of nodes) out.set(n, [])
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, [])
    out.get(a)!.push(b)
  }
  const state = new Map<string, 1 | 2>() // 1 = on the stack, 2 = done
  for (const root of nodes) {
    if (state.has(root)) continue
    const path: string[] = [root]
    const next: number[] = [0]
    state.set(root, 1)
    while (path.length > 0) {
      const top = path[path.length - 1]
      const succs = out.get(top) ?? []
      const i = next[next.length - 1]++
      if (i >= succs.length) {
        state.set(top, 2)
        path.pop()
        next.pop()
        continue
      }
      const s = succs[i]
      const st = state.get(s)
      if (st === 1) return [...path.slice(path.indexOf(s)), s]
      if (st === undefined) {
        state.set(s, 1)
        path.push(s)
        next.push(0)
      }
    }
  }
  return null
}

export function normaliseProgramme(input: ProgrammeInput): { value: NormalisedProgramme | null; issues: ScheduleIssue[] } {
  const issues = validateProgramme(input)
  if (issues.some(i => i.severity === 'error')) return { value: null, issues }

  const byId = new Map(input.activities.map(a => [a.id, a]))
  const childrenOf = new Map<string, string[]>()
  for (const a of input.activities) {
    if (a.parentId !== null) {
      const list = childrenOf.get(a.parentId)
      if (list) list.push(a.id)
      else childrenOf.set(a.parentId, [a.id])
    }
  }

  const leafDescendants = (id: string): string[] => {
    const out: string[] = []
    const stack = [...(childrenOf.get(id) ?? [])].reverse()
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (byId.get(cur)!.type === 'summary') stack.push(...[...(childrenOf.get(cur) ?? [])].reverse())
      else out.push(cur)
    }
    return out
  }
  const endpoints = (id: string): string[] => (byId.get(id)!.type === 'summary' ? leafDescendants(id) : [id])

  // Drop second occurrences of a (pred, succ, type) triple, then expand summary endpoints.
  const seen = new Set<string>()
  const links: DependencyInput[] = []
  for (const d of input.dependencies) {
    const key = `${d.predId}\u0000${d.succId}\u0000${d.type}`
    if (seen.has(key)) continue
    seen.add(key)
    for (const p of endpoints(d.predId)) {
      for (const s of endpoints(d.succId)) links.push({ ...d, predId: p, succId: s })
    }
  }

  const leaves = input.activities.filter(a => a.type !== 'summary')
  const leafIds = leaves.map(a => a.id)

  // Kahn, stable on input order.
  const indeg = new Map<string, number>(leafIds.map(id => [id, 0]))
  const succsOf = new Map<string, DependencyInput[]>(leafIds.map(id => [id, []]))
  const predsOf = new Map<string, DependencyInput[]>(leafIds.map(id => [id, []]))
  for (const d of links) {
    indeg.set(d.succId, (indeg.get(d.succId) ?? 0) + 1)
    succsOf.get(d.predId)!.push(d)
    predsOf.get(d.succId)!.push(d)
  }
  const order: string[] = []
  const ready = leafIds.filter(id => indeg.get(id) === 0)
  for (let head = 0; head < ready.length; head++) {
    const id = ready[head]
    order.push(id)
    for (const d of succsOf.get(id)!) {
      const n = indeg.get(d.succId)! - 1
      indeg.set(d.succId, n)
      if (n === 0) ready.push(d.succId)
    }
  }
  if (order.length < leafIds.length) {
    const remaining = leafIds.filter(id => (indeg.get(id) ?? 0) > 0)
    const rem = new Set(remaining)
    const path = findCycle(remaining, links.filter(d => rem.has(d.predId) && rem.has(d.succId)).map(d => [d.predId, d.succId]))
      ?? remaining
    const depIds: string[] = []
    for (let i = 0; i + 1 < path.length; i++) {
      const l = links.find(d => d.predId === path[i] && d.succId === path[i + 1])
      if (l && !depIds.includes(l.id)) depIds.push(l.id)
    }
    issues.push({
      code: 'cycle', severity: ISSUE_SEVERITY.cycle, activityIds: path, dependencyIds: depIds,
      message: `Dependencies form a cycle: ${path.join(' → ')}.`,
    })
    return { value: null, issues }
  }

  // Summaries, children before parents.
  const summaries: ActivityInput[] = []
  const visited = new Set<string>()
  for (const root of input.activities) {
    if (visited.has(root.id)) continue
    const stack: Array<{ id: string; i: number }> = [{ id: root.id, i: 0 }]
    visited.add(root.id)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const kids = childrenOf.get(top.id) ?? []
      if (top.i < kids.length) {
        const k = kids[top.i++]
        if (!visited.has(k)) {
          visited.add(k)
          stack.push({ id: k, i: 0 })
        }
      } else {
        const a = byId.get(top.id)!
        if (a.type === 'summary') summaries.push(a)
        stack.pop()
      }
    }
  }

  const rank = new Map(order.map((id, i) => [id, i]))
  const sortedLeaves = [...leaves].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return { value: { leaves: sortedLeaves, summaries, childrenOf, links, predsOf, succsOf }, issues }
}
