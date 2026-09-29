/**
 * The meter supply hierarchy drawn on schematics (functional spec §13.3). Supply lines only; a
 * `check` line (a check meter beside a supply meter) never enters it. The database refuses loops
 * (00214 schematic_lines_bind); these functions still survive one, so a legacy row cannot hang them.
 */
export interface MeterLine {
  fromMeterId: string
  toMeterId: string
  lineType?: 'supply' | 'check'
}

/** Monthly parent vs Σ children beyond this share is flagged (spec §13.3: ±10 %). */
export const RECONCILIATION_TOLERANCE = 0.1

const supplyOnly = (lines: MeterLine[]) => lines.filter((l) => (l.lineType ?? 'supply') === 'supply')

export function supplyChildren(lines: MeterLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of supplyOnly(lines)) {
    const c = out.get(l.fromMeterId) ?? []
    if (!c.includes(l.toMeterId)) c.push(l.toMeterId)
    out.set(l.fromMeterId, c)
  }
  return out
}

export function descendants(meterId: string, children: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(children.get(meterId) ?? [])]
  while (stack.length > 0) {
    const m = stack.pop() as string
    if (m === meterId || seen.has(m)) continue
    seen.add(m)
    stack.push(...(children.get(m) ?? []))
  }
  return seen
}

export function wouldCreateCycle(lines: MeterLine[], candidate: MeterLine): boolean {
  if ((candidate.lineType ?? 'supply') !== 'supply') return false
  if (candidate.fromMeterId === candidate.toMeterId) return true
  return descendants(candidate.toMeterId, supplyChildren(lines)).has(candidate.fromMeterId)
}

export interface DoubleCountResult {
  kept: string[]
  droppedParents: Array<{ meterId: string; includedDescendants: string[] }>
}

/** §13.3: an included meter with an included descendant is a PARENT — buildSiteLoad counts only its residual. */
export function doubleCountGuard(includedMeterIds: string[], lines: MeterLine[]): DoubleCountResult {
  const children = supplyChildren(lines)
  const included = new Set(includedMeterIds)
  const droppedParents: DoubleCountResult['droppedParents'] = []
  for (const id of included) {
    const d = [...descendants(id, children)].filter((x) => included.has(x)).sort()
    if (d.length > 0) droppedParents.push({ meterId: id, includedDescendants: d })
  }
  const dropped = new Set(droppedParents.map((d) => d.meterId))
  return { kept: [...included].filter((id) => !dropped.has(id)), droppedParents }
}

export interface ParentReconciliation {
  parentMeterId: string
  childMeterIds: string[]
  months: Array<{ month: number; parentKwh: number; childrenKwh: number; ratio: number | null; flagged: boolean }>
}

/** `monthlyKwh`: 12 values per meter, January first; NaN = no data that month (skipped). */
export function reconcileParents(lines: MeterLine[], monthlyKwh: Map<string, number[]>): ParentReconciliation[] {
  const out: ParentReconciliation[] = []
  for (const [parent, kids] of supplyChildren(lines)) {
    const pm = monthlyKwh.get(parent)
    const withData = kids.filter((k) => monthlyKwh.has(k))
    if (!pm || withData.length === 0) continue
    const months: ParentReconciliation['months'] = []
    for (let i = 0; i < 12; i++) {
      const p = pm[i]
      const cs = withData.map((k) => (monthlyKwh.get(k) as number[])[i])
      if (!Number.isFinite(p) || cs.some((c) => !Number.isFinite(c))) continue
      const c = cs.reduce((a, b) => a + b, 0)
      const ratio = p > 0 ? c / p : null
      months.push({ month: i + 1, parentKwh: p, childrenKwh: c, ratio, flagged: ratio === null ? c > 0 : Math.abs(ratio - 1) > RECONCILIATION_TOLERANCE })
    }
    out.push({ parentMeterId: parent, childMeterIds: withData, months })
  }
  return out
}
