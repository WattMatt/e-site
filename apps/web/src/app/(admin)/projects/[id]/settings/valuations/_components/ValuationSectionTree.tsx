'use client'

/**
 * ValuationSectionTree — the drill-down for one selected bill, valuation-side.
 *
 * Mirrors the Rates tab's BoqSectionTree exactly (same nested expandable rows,
 * sortOrder-then-code ordering, descendant filtering) but each row shows the
 * rolled-up VALUE TO DATE (valueBySection) instead of the contract total, and
 * — when editable — a section-level "%" control that sets every leaf under that
 * section to the given percent (setSectionPercentAction, via onSetSectionPercent).
 * Leaf items render through ValuationLineTable.
 */

import { useState } from 'react'
import type { BoqItem, BoqSection, ValuationLine, ValuationProgressPatch } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import { fmtMoney } from '../../rates/_components/format'
import { ValuationLineTable } from './ValuationLineTable'

interface Props {
  bill: BoqSection
  sections: BoqSection[]
  items: BoqItem[]
  linesByItem: Map<string, ValuationLine>
  valueBySection: Record<string, number>
  canEdit: boolean
  onCommit: (patch: ValuationProgressPatch) => Promise<string | null>
  /** Set every leaf under a section to `percent`; resolves to an error or null. */
  onSetSectionPercent: (sectionId: string, percent: number) => Promise<string | null>
}

function sortSections(a: BoqSection, b: BoqSection): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return naturalCompare(a.code ?? '', b.code ?? '')
}

export function ValuationSectionTree({
  bill,
  sections,
  items,
  linesByItem,
  valueBySection,
  canEdit,
  onCommit,
  onSetSectionPercent,
}: Props) {
  const childrenBySection = new Map<string, BoqSection[]>()
  for (const s of sections) {
    if (!s.parentSectionId) continue
    const arr = childrenBySection.get(s.parentSectionId) ?? []
    arr.push(s)
    childrenBySection.set(s.parentSectionId, arr)
  }

  const itemsBySection = new Map<string, BoqItem[]>()
  for (const it of items) {
    const arr = itemsBySection.get(it.sectionId) ?? []
    arr.push(it)
    itemsBySection.set(it.sectionId, arr)
  }

  const childrenOf = (id: string): BoqSection[] => [...(childrenBySection.get(id) ?? [])].sort(sortSections)

  const directChildren = childrenOf(bill.id)
  const billItems = itemsBySection.get(bill.id) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {billItems.length > 0 && (
        <div style={{ paddingLeft: 4 }}>
          <ValuationLineTable items={billItems} linesByItem={linesByItem} canEdit={canEdit} onCommit={onCommit} />
        </div>
      )}

      {directChildren.length === 0 && billItems.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
          This bill has no sections.
        </p>
      )}

      {directChildren.map((section) => (
        <SectionNode
          key={section.id}
          section={section}
          depth={0}
          childrenOf={childrenOf}
          itemsBySection={itemsBySection}
          linesByItem={linesByItem}
          valueBySection={valueBySection}
          canEdit={canEdit}
          onCommit={onCommit}
          onSetSectionPercent={onSetSectionPercent}
        />
      ))}
    </div>
  )
}

function SectionNode({
  section,
  depth,
  childrenOf,
  itemsBySection,
  linesByItem,
  valueBySection,
  canEdit,
  onCommit,
  onSetSectionPercent,
}: {
  section: BoqSection
  depth: number
  childrenOf: (id: string) => BoqSection[]
  itemsBySection: Map<string, BoqItem[]>
  linesByItem: Map<string, ValuationLine>
  valueBySection: Record<string, number>
  canEdit: boolean
  onCommit: (patch: ValuationProgressPatch) => Promise<string | null>
  onSetSectionPercent: (sectionId: string, percent: number) => Promise<string | null>
}) {
  const [expanded, setExpanded] = useState(false)
  const subSections = childrenOf(section.id)
  const ownItems = itemsBySection.get(section.id) ?? []
  const value = valueBySection[section.id] ?? 0

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: '8px 12px',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left', padding: 0 }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'var(--c-text-dim)',
              transition: 'transform 0.15s',
              display: 'inline-block',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          >
            ▼
          </span>
          {section.code && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>{section.code}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', flex: 1 }}>{section.title}</span>
        </button>
        {/* Section-level % control + rolled-up value */}
        {canEdit && <SectionPercentControl sectionId={section.id} onSetSectionPercent={onSetSectionPercent} />}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-mid)', whiteSpace: 'nowrap', minWidth: 96, textAlign: 'right' }}>
          {fmtMoney(value)}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '8px 0 8px 8px' }}>
          {ownItems.length > 0 && (
            <ValuationLineTable items={ownItems} linesByItem={linesByItem} canEdit={canEdit} onCommit={onCommit} />
          )}
          {subSections.map((child) => (
            <SectionNode
              key={child.id}
              section={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              itemsBySection={itemsBySection}
              linesByItem={linesByItem}
              valueBySection={valueBySection}
              canEdit={canEdit}
              onCommit={onCommit}
              onSetSectionPercent={onSetSectionPercent}
            />
          ))}
          {ownItems.length === 0 && subSections.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)', paddingLeft: 8 }}>
              Empty section.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** A compact "set whole section to N%" control. */
function SectionPercentControl({
  sectionId,
  onSetSectionPercent,
}: {
  sectionId: string
  onSetSectionPercent: (sectionId: string, percent: number) => Promise<string | null>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function apply() {
    const n = Number(draft.trim())
    if (draft.trim() === '' || Number.isNaN(n) || n < 0 || n > 100) return
    setBusy(true)
    await onSetSectionPercent(sectionId, n)
    setBusy(false)
    setDraft('')
  }

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      // Stop the row's expand toggle from firing when interacting with the control.
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="number"
        min={0}
        max={100}
        placeholder="set %"
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
        }}
        style={{
          width: 64,
          background: 'var(--c-panel-deep)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: '4px 8px',
          color: 'var(--c-text)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          textAlign: 'right',
          boxSizing: 'border-box',
        }}
        aria-label="Set section percent"
      />
      <button
        type="button"
        onClick={apply}
        disabled={busy || draft.trim() === ''}
        style={{
          background: 'transparent',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          color: 'var(--c-text-mid)',
          cursor: busy || draft.trim() === '' ? 'not-allowed' : 'pointer',
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          opacity: busy || draft.trim() === '' ? 0.5 : 1,
        }}
      >
        Apply
      </button>
    </span>
  )
}
