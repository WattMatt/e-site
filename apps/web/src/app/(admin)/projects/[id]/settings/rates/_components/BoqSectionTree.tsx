'use client'

/**
 * BoqSectionTree — the drill-down for one selected bill.
 *
 * Renders the bill's section/category subtree as nested expandable rows, each
 * showing its rolled-up total (totals[id]). A node's own line items render via
 * BoqLineItemTable when it is expanded. Child sections nest underneath.
 *
 * `sections` / `items` are the full import; this component filters to the
 * descendants of `bill`. Sort is by sortOrder then code.
 *
 * When `revised`/`revisedTotals` are set (the project has any approved
 * variation), each section row shows Contract | Revised totals and the line
 * tables gain a Revised column; otherwise the layout is unchanged.
 */

import { useState } from 'react'
import type { BoqItem, BoqSection } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import { fmtMoney } from './format'
import { BoqLineItemTable } from './BoqLineItemTable'

interface Props {
  bill: BoqSection
  sections: BoqSection[]
  items: BoqItem[]
  totals: Record<string, number>
  /** Per-item revised amounts; null/absent = no revisions (layout unchanged). */
  revised?: Record<string, number | null> | null
  /** Section rollups over the revised amounts. */
  revisedTotals?: Record<string, number> | null
  projectId: string
  canEdit: boolean
  onItemUpdated: (item: BoqItem) => void
}

function sortSections(a: BoqSection, b: BoqSection): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return naturalCompare(a.code ?? '', b.code ?? '')
}

export function BoqSectionTree({
  bill,
  sections,
  items,
  totals,
  revised,
  revisedTotals,
  projectId,
  canEdit,
  onItemUpdated,
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

  const childrenOf = (id: string): BoqSection[] =>
    [...(childrenBySection.get(id) ?? [])].sort(sortSections)

  const directChildren = childrenOf(bill.id)
  const billItems = itemsBySection.get(bill.id) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Items directly under the bill (rare, but possible) */}
      {billItems.length > 0 && (
        <div style={{ paddingLeft: 4 }}>
          <BoqLineItemTable
            items={billItems}
            revised={revised}
            projectId={projectId}
            canEdit={canEdit}
            onItemUpdated={onItemUpdated}
          />
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
          totals={totals}
          revised={revised}
          revisedTotals={revisedTotals}
          projectId={projectId}
          canEdit={canEdit}
          onItemUpdated={onItemUpdated}
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
  totals,
  revised,
  revisedTotals,
  projectId,
  canEdit,
  onItemUpdated,
}: {
  section: BoqSection
  depth: number
  childrenOf: (id: string) => BoqSection[]
  itemsBySection: Map<string, BoqItem[]>
  totals: Record<string, number>
  revised?: Record<string, number | null> | null
  revisedTotals?: Record<string, number> | null
  projectId: string
  canEdit: boolean
  onItemUpdated: (item: BoqItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const subSections = childrenOf(section.id)
  const ownItems = itemsBySection.get(section.id) ?? []
  const total = totals[section.id] ?? 0

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          textAlign: 'left',
        }}
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
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>
            {section.code}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', flex: 1 }}>
          {section.title}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: revisedTotals ? 'var(--c-text-dim)' : 'var(--c-text-mid)' }}>
          {fmtMoney(total)}
        </span>
        {revisedTotals && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text)' }}>
            {fmtMoney(revisedTotals[section.id] ?? 0)}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ padding: '8px 0 8px 8px' }}>
          {ownItems.length > 0 && (
            <BoqLineItemTable
              items={ownItems}
              revised={revised}
              projectId={projectId}
              canEdit={canEdit}
              onItemUpdated={onItemUpdated}
            />
          )}
          {subSections.map((child) => (
            <SectionNode
              key={child.id}
              section={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              itemsBySection={itemsBySection}
              totals={totals}
              revised={revised}
              revisedTotals={revisedTotals}
              projectId={projectId}
              canEdit={canEdit}
              onItemUpdated={onItemUpdated}
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
