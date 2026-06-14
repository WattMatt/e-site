'use client'

/**
 * ValuationDetail — one valuation's progress capture + live certificate.
 *
 * Layout mirrors the Rates tab: a Main-Summary bill list that drills into a
 * selected bill's section tree (here ValuationSectionTree). Each leaf carries a
 * progress input (% or qty); a section header carries a "set whole section to
 * N%" control. Every write re-fetches the valuation (onChanged) so value_to_date
 * + the certificate figures stay live and consistent — no client-side money math
 * beyond rolling up the server-computed per-line value_to_date.
 *
 * Editable only while status === 'draft' AND canEdit; certified valuations are
 * fully read-only (the CertifyBar slot then shows the view-certificate link).
 */

import { useMemo, useState } from 'react'
import type { BoqItem, BoqSection, Valuation, ValuationLine, ValuationProgressPatch } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import { updateValuationLineAction, setSectionPercentAction } from '@/actions/valuation.actions'
import { fmtMoney } from '../../rates/_components/format'
import { ValuationSectionTree } from './ValuationSectionTree'
import { CertificateSummary, type CertificateBillRow } from './CertificateSummary'

interface Props {
  projectId: string
  valuation: Valuation
  lines: ValuationLine[]
  /** Revised amount per boqItemId from approved variation adjustments. */
  revisedByItem?: Map<string, number | null>
  /** The current BOQ tree (from the page's listBoqAction). */
  sections: BoqSection[]
  items: BoqItem[]
  /** Live certificate figures (from getValuationAction). */
  certificate: {
    grossToDate: number
    retention: number
    netToDate: number
    previousNet: number
    dueExVat: number
    vat: number
    dueInclVat: number
  }
  canEdit: boolean
  /** Re-fetch the valuation after a write (keeps lines + figures live). */
  onChanged: () => void
  /** The CertifyBar (or certified read-only banner), rendered at the top. */
  certifyBar?: React.ReactNode
}

/** Recursive rollup of a per-item value into each section (mirrors computeRollups). */
function rollupValues(
  sections: BoqSection[],
  items: BoqItem[],
  valueByItem: Map<string, number>,
): Record<string, number> {
  const childrenOf = new Map<string, string[]>()
  for (const s of sections) {
    if (!s.parentSectionId) continue
    const list = childrenOf.get(s.parentSectionId)
    if (list) list.push(s.id)
    else childrenOf.set(s.parentSectionId, [s.id])
  }
  const directSum = new Map<string, number>()
  for (const it of items) {
    directSum.set(it.sectionId, (directSum.get(it.sectionId) ?? 0) + (valueByItem.get(it.id) ?? 0))
  }
  const totals: Record<string, number> = {}
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const visit = (id: string): number => {
    if (id in totals) return totals[id]
    let sum = directSum.get(id) ?? 0
    for (const childId of childrenOf.get(id) ?? []) sum += visit(childId)
    sum = round2(sum)
    totals[id] = sum
    return sum
  }
  for (const s of sections) visit(s.id)
  return totals
}

/** Walk a section up to its nearest kind='bill' ancestor (the gatherer's rule). */
function findOwningBill(startId: string | null, byId: Map<string, BoqSection>): BoqSection | null {
  let current = startId ? byId.get(startId) ?? null : null
  let topmost = current
  const visited = new Set<string>()
  while (current) {
    if (current.kind === 'bill') return current
    topmost = current
    if (visited.has(current.id)) break
    visited.add(current.id)
    current = current.parentSectionId ? byId.get(current.parentSectionId) ?? null : null
  }
  return topmost
}

export function ValuationDetail({
  projectId,
  valuation,
  lines,
  revisedByItem,
  sections,
  items,
  certificate,
  canEdit,
  onChanged,
  certifyBar,
}: Props) {
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const editable = canEdit && valuation.status === 'draft'

  const linesByItem = useMemo(() => {
    const m = new Map<string, ValuationLine>()
    for (const l of lines) m.set(l.boqItemId, l)
    return m
  }, [lines])

  const valueByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.boqItemId, l.valueToDate)
    return m
  }, [lines])

  const valueBySection = useMemo(
    () => rollupValues(sections, items, valueByItem),
    [sections, items, valueByItem],
  )

  // Bills (kind='bill') in display order, with their live rolled-up value.
  const bills = useMemo(
    () => sections.filter((s) => s.kind === 'bill').sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return naturalCompare(a.code ?? '', b.code ?? '')
    }),
    [sections],
  )

  // Per-bill schedule for the certificate (line → item's section → owning bill).
  const certBills: CertificateBillRow[] = useMemo(() => {
    const byId = new Map(sections.map((s) => [s.id, s]))
    const itemSection = new Map(items.map((it) => [it.id, it.sectionId]))
    const order: string[] = []
    const gross = new Map<string, number>()
    const meta = new Map<string, { code: string; title: string }>()
    for (const l of lines) {
      const sectionId = itemSection.get(l.boqItemId) ?? null
      const bill = findOwningBill(sectionId, byId)
      const key = bill?.id ?? '__unattributed__'
      if (!gross.has(key)) {
        order.push(key)
        gross.set(key, 0)
        meta.set(key, { code: bill?.code ?? '', title: bill?.title ?? 'Unattributed' })
      }
      gross.set(key, gross.get(key)! + l.valueToDate)
    }
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
    return order.map((key) => {
      const g = round2(gross.get(key)!)
      const m = meta.get(key)!
      return { code: m.code, title: m.title, grossToDate: g, retention: round2(g * (valuation.retentionPct / 100)) }
    })
  }, [lines, sections, items, valuation.retentionPct])

  async function handleCommit(patch: ValuationProgressPatch): Promise<string | null> {
    setActionError(null)
    const res = await updateValuationLineAction(projectId, valuation.id, patch)
    if ('error' in res) {
      setActionError(res.error)
      return res.error
    }
    onChanged()
    return null
  }

  async function handleSetSectionPercent(sectionId: string, percent: number): Promise<string | null> {
    setActionError(null)
    const res = await setSectionPercentAction(projectId, valuation.id, sectionId, percent)
    if ('error' in res) {
      setActionError(res.error)
      return res.error
    }
    onChanged()
    return null
  }

  const selectedBill = selectedBillId ? bills.find((b) => b.id === selectedBillId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {certifyBar}

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid #6b1e1e', borderRadius: 6, padding: '8px 12px' }}>
          {actionError}
        </div>
      )}

      {/* Progress capture: bill list → section tree */}
      {selectedBill ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => setSelectedBillId(null)}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--c-amber)', fontFamily: 'var(--font-sans)', padding: 0 }}
          >
            ← Back to bills
          </button>
          <div>
            <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
              {selectedBill.code ? `${selectedBill.code} · ` : ''}
              {selectedBill.title}
            </h3>
            <ValuationSectionTree
              bill={selectedBill}
              sections={sections}
              items={items}
              linesByItem={linesByItem}
              revisedByItem={revisedByItem}
              valueBySection={valueBySection}
              canEdit={editable}
              onCommit={handleCommit}
              onSetSectionPercent={handleSetSectionPercent}
            />
          </div>
        </div>
      ) : (
        <BillList bills={bills} valueBySection={valueBySection} onSelect={(id) => setSelectedBillId(id)} />
      )}

      {/* Live certificate */}
      <CertificateSummary summary={certificate} bills={certBills} retentionPct={valuation.retentionPct} />
    </div>
  )
}

function BillList({
  bills,
  valueBySection,
  onSelect,
}: {
  bills: BoqSection[]
  valueBySection: Record<string, number>
  onSelect: (billId: string) => void
}) {
  if (bills.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
        The current BOQ has no bills.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {bills.map((bill) => (
        <button
          key={bill.id}
          type="button"
          onClick={() => onSelect(bill.id)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: '10px 14px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            textAlign: 'left',
          }}
        >
          {bill.code && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>{bill.code}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', flex: 1 }}>{bill.title}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
            {fmtMoney(valueBySection[bill.id] ?? 0)}
          </span>
          <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>→</span>
        </button>
      ))}
    </div>
  )
}
