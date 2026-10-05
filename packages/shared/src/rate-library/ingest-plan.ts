/**
 * Ingest planning: parsed priced lines → review state, new catalogue items and
 * collapsed observations. Pure — the caller performs the writes.
 *
 * Status per line:
 *   auto_confirmed  rule match with every required attribute
 *   suggested       partial match that fits EXACTLY ONE known item (a person
 *                   still confirms it)
 *   unmatched       nothing to suggest
 *   excluded        not a unit rate (reason kept)
 *
 * Observations collapse on (item, exact supply, install and total rate): one
 * contractor's single conduit rate repeated across forty tenant bills is one
 * observation with occurrences = 40, not forty votes in the median.
 */
import type { QuantityMode } from '../schemas/boq.schema'
import { codeForSignature, describeSignature } from './catalogue'
import { groupKey } from './group'
import { lineTotalRate, matchLine, type Attrs, type ExclusionReason, type RateCategory } from './match'

export interface IngestLine {
  sheet: string | null
  rowRef: string | null
  code: string | null
  sectionPath: string[]
  description: string
  unit: string | null
  quantity: number | null
  supplyRate: number | null
  installRate: number | null
  rate: number | null
  amount: number | null
  quantityMode?: QuantityMode | null
}

export interface KnownItem { id: string; signature: string; category: RateCategory | string; unit: string; attributes: Attrs }

export type LineStatus = 'auto_confirmed' | 'suggested' | 'unmatched' | 'excluded'

export interface PlannedLine extends IngestLine {
  groupKey: string
  status: LineStatus
  exclusionReason: ExclusionReason | null
  /** Set for auto_confirmed (the matched item) and suggested (the proposed item). */
  matchedSignature: string | null
  suggestedItemSignature: string | null
  detail: Record<string, unknown>
}

export interface NewItem { signature: string; code: string; description: string; category: RateCategory; unit: string; attributes: Attrs }

export interface PlannedObservation {
  signature: string
  unit: string
  supplyRate: number | null
  installRate: number | null
  rate: number
  occurrences: number
  lineIndexes: number[]
}

export interface CollapseInput { key: string; unit: string; supplyRate: number | null; installRate: number | null; rate: number; lineIndex: number }
export interface Collapsed { key: string; unit: string; supplyRate: number | null; installRate: number | null; rate: number; occurrences: number; lineIndexes: number[] }

const r4 = (n: number | null) => (n === null || n === undefined ? null : Math.round(Number(n) * 10000) / 10000)

export function collapseObservations(rows: CollapseInput[]): Collapsed[] {
  const map = new Map<string, Collapsed>()
  for (const r of rows) {
    const k = [r.key, r.unit, r4(r.supplyRate), r4(r.installRate), r4(r.rate)].join('§')
    const hit = map.get(k)
    if (hit) { hit.occurrences++; hit.lineIndexes.push(r.lineIndex) }
    else map.set(k, { key: r.key, unit: r.unit, supplyRate: r4(r.supplyRate), installRate: r4(r.installRate), rate: r4(r.rate) as number, occurrences: 1, lineIndexes: [r.lineIndex] })
  }
  return [...map.values()]
}

export function planIngest(lines: IngestLine[], known: KnownItem[]): { lines: PlannedLine[]; newItems: NewItem[]; observations: PlannedObservation[] } {
  const newItems = new Map<string, NewItem>()
  const planned: PlannedLine[] = []
  const toCollapse: CollapseInput[] = []

  // First pass: rule matches (they also grow the set of known items).
  const results = lines.map(l => matchLine({
    sectionPath: l.sectionPath, description: l.description, unit: l.unit, quantityMode: l.quantityMode ?? null,
    supplyRate: l.supplyRate, installRate: l.installRate, rate: l.rate,
  }))
  const knownBySig = new Map(known.map(k => [k.signature, k]))
  results.forEach(r => {
    if (r.kind === 'match' && !knownBySig.has(r.signature) && !newItems.has(r.signature)) {
      newItems.set(r.signature, {
        signature: r.signature, code: codeForSignature(r.signature), description: describeSignature(r.signature),
        category: r.category, unit: r.unit, attributes: r.attributes,
      })
    }
  })
  const pool: { signature: string; category: string; unit: string; attributes: Attrs }[] = [
    ...known, ...[...newItems.values()],
  ]

  lines.forEach((l, i) => {
    const r = results[i]
    const base = { ...l, groupKey: groupKey(l.sectionPath, l.description, l.unit), exclusionReason: null, matchedSignature: null, suggestedItemSignature: null }
    if (r.kind === 'excluded') { planned.push({ ...base, status: 'excluded', exclusionReason: r.reason, detail: {} }); return }
    if (r.kind === 'match') {
      planned.push({ ...base, status: 'auto_confirmed', matchedSignature: r.signature, detail: { method: 'rule', category: r.category, assumed: r.assumed } })
      toCollapse.push({ key: r.signature, unit: r.unit, supplyRate: l.supplyRate, installRate: l.installRate, rate: lineTotalRate(l), lineIndex: i })
      return
    }
    if (r.kind === 'partial') {
      const fits = pool.filter(p => p.category === r.category && (r.unit === null || p.unit === r.unit)
        && Object.entries(r.attributes).every(([k, v]) => p.attributes[k] === v))
      const only = fits.length === 1 ? fits[0].signature : null
      planned.push({
        ...base, status: only ? 'suggested' : 'unmatched', suggestedItemSignature: only,
        detail: { method: 'rule', category: r.category, attributes: r.attributes, missing: r.missing, candidates: fits.length },
      })
      return
    }
    planned.push({ ...base, status: 'unmatched', detail: {} })
  })

  const observations = collapseObservations(toCollapse).map(c => ({
    signature: c.key, unit: c.unit, supplyRate: c.supplyRate, installRate: c.installRate, rate: c.rate,
    occurrences: c.occurrences, lineIndexes: c.lineIndexes,
  }))
  return { lines: planned, newItems: [...newItems.values()], observations }
}
