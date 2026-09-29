/**
 * Auto-match meters to tenants (functional spec §4.4): the imported meter register and serials first,
 * then shop numbers from file names, then labels. A tenant a person already chose on the meter
 * (import "Link to tenant", when no study existed to take the assignment) outranks them all.
 * It only PROPOSES; the user ticks and applies.
 * A register row matched by an LLM or marked UNMAPPED is never pre-ticked unless someone confirmed it.
 */
/** nodeId: the tenant someone chose on the meter itself (import "Link to tenant"), if any. */
export interface MatchMeter { meterId: string; label: string; kind: string; serials: string[]; shopNo: string | null; nodeId?: string | null }
export interface MatchTenant { nodeId: string; shopNumber: string | null; name: string | null }
export interface MatchRegisterRow {
  fileName: string | null
  shopNo: string | null
  tenantName: string | null
  serial: string | null
  matchMethod: 'exact' | 'llm' | 'unmapped' | 'manual' | 'none'
  confirmed: boolean
}
export type MatchSource = 'linked' | 'register' | 'serial' | 'shop_no' | 'label'
export interface MatchProposal {
  nodeId: string
  meterId: string
  source: MatchSource
  confidence: 'high' | 'medium' | 'low'
  preTicked: boolean
  note: string
}

/** Meters that never carry a single tenant's load. */
export const NOT_TENANT_KINDS: ReadonlySet<string> = new Set(['bulk', 'council', 'generator', 'solar', 'check', 'water'])

export function normShop(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.toUpperCase().replace(/\b(SHOP|UNIT|NO\.?)\b/g, '').replace(/[\s#\-_.]/g, '').replace(/^0+(?=\w)/, '')
  return t.length > 0 ? t : null
}

export function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function autoMatchMeters(input: {
  meters: MatchMeter[]
  tenants: MatchTenant[]
  register: MatchRegisterRow[]
  assignedMeterIds: Set<string>
}): MatchProposal[] {
  const byShop = new Map<string, MatchTenant>()
  const byName = new Map<string, MatchTenant>()
  for (const t of input.tenants) {
    const k = normShop(t.shopNumber)
    if (k && !byShop.has(k)) byShop.set(k, t)
    const n = normName(t.name)
    if (n.length >= 3 && !byName.has(n)) byName.set(n, t)
  }
  const candidates = input.meters.filter((m) => !NOT_TENANT_KINDS.has(m.kind) && !input.assignedMeterIds.has(m.meterId))
  const taken = new Set<string>()
  const out: MatchProposal[] = []
  const propose = (m: MatchMeter, t: MatchTenant, p: Omit<MatchProposal, 'nodeId' | 'meterId'>) => {
    if (taken.has(m.meterId)) return
    taken.add(m.meterId)
    out.push({ nodeId: t.nodeId, meterId: m.meterId, ...p })
  }

  const tenantIds = new Map(input.tenants.map((t) => [t.nodeId, t]))
  for (const m of candidates) {
    const t = m.nodeId ? tenantIds.get(m.nodeId) : undefined
    if (t) propose(m, t, { source: 'linked', confidence: 'high', preTicked: true, note: 'Tenant chosen when the meter was imported' })
  }
  for (const r of input.register) {
    const t = byShop.get(normShop(r.shopNo) ?? '')
    if (!t) continue
    const bySerial = r.serial ? candidates.find((x) => x.serials.includes(r.serial as string)) : undefined
    const byFile = r.fileName
      ? candidates.find((x) => normName(x.label).length >= 3 && normName(r.fileName).includes(normName(x.label)))
      : undefined
    const m = bySerial ?? byFile
    if (!m) continue
    const trusted = r.confirmed || r.matchMethod === 'exact' || r.matchMethod === 'manual'
    propose(m, t, {
      source: bySerial ? 'serial' : 'register',
      confidence: trusted ? 'high' : 'low',
      preTicked: trusted,
      note: trusted
        ? `Meter register (${r.confirmed ? 'confirmed' : r.matchMethod})`
        : `Meter register row matched by ${r.matchMethod === 'llm' ? 'an LLM' : 'nobody (UNMAPPED)'} — check before applying`,
    })
  }
  for (const m of candidates) {
    const t = byShop.get(normShop(m.shopNo) ?? '')
    if (t) propose(m, t, { source: 'shop_no', confidence: 'high', preTicked: true, note: `Shop number ${m.shopNo} in the file name` })
  }
  for (const m of candidates) {
    const t = byName.get(normName(m.label))
    if (t) propose(m, t, { source: 'label', confidence: 'medium', preTicked: false, note: 'Meter label equals the tenant name' })
  }
  return out
}
