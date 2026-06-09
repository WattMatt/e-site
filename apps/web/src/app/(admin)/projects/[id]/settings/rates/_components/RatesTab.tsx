'use client'

/**
 * RatesTab — the Rates / BOQ tab shell (client).
 *
 * Empty state (no current import): a prompt + an Import button (only when
 * canEdit). Otherwise: BoqMainSummary (bill list + grand totals) with a
 * drill-down into the selected bill's BoqSectionTree, plus a Re-import button
 * (canEdit).
 *
 * Owns: the selected bill, and a local copy of items/totals so an inline rate
 * edit updates the section/bill rollups optimistically (computeRollups) before
 * the server revalidation lands.
 *
 * Prop contract (set by the server page, Task 11):
 *   <RatesTab projectId canEdit initial={data | null} />
 * where data = { import, sections, items, totals, importedByName }.
 */

import { useMemo, useState } from 'react'
import {
  computeRollups,
  type BoqImport,
  type BoqItem,
  type BoqSection,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { BoqMainSummary } from './BoqMainSummary'
import { BoqSectionTree } from './BoqSectionTree'
import { BoqImportDialog } from './BoqImportDialog'

export interface RatesTabData {
  import: BoqImport | null
  sections: BoqSection[]
  items: BoqItem[]
  totals: Record<string, number>
  importedByName: string | null
}

interface Props {
  projectId: string
  canEdit: boolean
  initial: RatesTabData | null
}

export function RatesTab({ projectId, canEdit, initial }: Props) {
  const [importing, setImporting] = useState(false)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  // Local item copy so inline rate edits can recompute rollups optimistically.
  const [items, setItems] = useState<BoqItem[]>(initial?.items ?? [])

  // Stable reference (initial is a server-passed prop, constant for the mount).
  const sections = useMemo(() => initial?.sections ?? [], [initial])
  const importRow = initial?.import ?? null

  // Recompute rollups from the local items whenever they change; falls back to
  // the server-provided totals on first render (identical values).
  const totals = useMemo(
    () => Object.fromEntries(computeRollups(sections, items)),
    [sections, items],
  )

  function handleItemUpdated(updated: BoqItem) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!importRow) {
    return (
      <>
        <Card>
          <CardBody>
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
                No BOQ imported yet
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', maxWidth: 420, marginInline: 'auto' }}>
                Import your priced tender Bill of Quantities (.xlsx) to capture the contract baseline and edit supply / install rates.
              </p>
              {canEdit && (
                <Button type="button" variant="primary" onClick={() => setImporting(true)}>
                  Import BOQ
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
        {importing && <BoqImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
      </>
    )
  }

  // ── Populated state ──────────────────────────────────────────────────────────
  const selectedBill = selectedBillId
    ? sections.find((s) => s.id === selectedBillId && s.kind === 'bill') ?? null
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header strip: import provenance + re-import */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
          {importRow.sourceFilename}
          {initial?.importedByName ? ` · imported by ${initial.importedByName}` : ''}
          {importRow.importedAt ? ` · ${new Date(importRow.importedAt).toLocaleDateString('en-ZA')}` : ''}
        </div>
        {canEdit && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setImporting(true)}>
            Re-import
          </Button>
        )}
      </div>

      {selectedBill ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => setSelectedBillId(null)}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--c-amber)',
              fontFamily: 'var(--font-sans)',
              padding: 0,
            }}
          >
            ← Back to Main Summary
          </button>
          <div>
            <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
              {selectedBill.code ? `${selectedBill.code} · ` : ''}
              {selectedBill.title}
            </h3>
            <BoqSectionTree
              bill={selectedBill}
              sections={sections}
              items={items}
              totals={totals}
              projectId={projectId}
              canEdit={canEdit}
              onItemUpdated={handleItemUpdated}
            />
          </div>
        </div>
      ) : (
        <BoqMainSummary
          importRow={importRow}
          sections={sections}
          totals={totals}
          onSelectBill={(bill) => setSelectedBillId(bill.id)}
        />
      )}

      {importing && <BoqImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
    </div>
  )
}
