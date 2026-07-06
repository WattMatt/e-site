/**
 * Shared run-grouping for the cable-schedule exporters (Excel + PDF).
 * Section/conductor bucketing + ordering lived duplicated in both renderers;
 * a change to section semantics now happens in exactly one place.
 */
import type { ExportPayload } from './export-payload'

export interface RunGroup {
  section: 'NORMAL' | 'EMERGENCY' | null
  conductor: 'CU' | 'AL'
  runs: ExportPayload['runs']
}

export function groupRunsBySectionConductor(runs: ExportPayload['runs']): RunGroup[] {
  // Bucket runs by (section, conductor). Section + conductor live ON the run
  // already (run.section is the supply's section; run.conductor is the head
  // strand's metal — and in practice all parallels share conductor).
  const buckets = new Map<string, RunGroup>()
  const orderKeys: string[] = []
  for (const r of runs) {
    const section = r.section === 'EMERGENCY' ? 'EMERGENCY'
                  : r.section === 'NORMAL' ? 'NORMAL'
                  : null
    const key = `${section ?? '_'}|${r.conductor}`
    if (!buckets.has(key)) {
      buckets.set(key, { section, conductor: r.conductor, runs: [] })
      orderKeys.push(key)
    }
    buckets.get(key)!.runs.push(r)
  }
  // Stable order: NORMAL first, then EMERGENCY, then null. CU before AL.
  orderKeys.sort((a, b) => {
    const [sa, ca] = a.split('|')
    const [sb, cb] = b.split('|')
    const sectionRank = (s: string) => (s === 'NORMAL' ? 0 : s === 'EMERGENCY' ? 1 : 2)
    if (sectionRank(sa) !== sectionRank(sb)) return sectionRank(sa) - sectionRank(sb)
    const condRank = (c: string) => (c === 'CU' ? 0 : 1)
    return condRank(ca) - condRank(cb)
  })
  return orderKeys.map((k) => buckets.get(k)!)
}
