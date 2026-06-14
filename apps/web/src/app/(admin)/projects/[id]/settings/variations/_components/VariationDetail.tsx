'use client'

/**
 * VariationDetail — one variation order's lines, topped by the ApproveBar.
 *
 * Lines table: kind badge (adjust/add), the target contract item (adjust) or
 * the new item's description + section (add), the signed qty delta / qty, and
 * the line's value change (± coloured). While the VO is a draft AND canEdit,
 * each line has a two-step Remove and an "+ Add line" opens the
 * VariationLineEditor; approved VOs are fully read-only.
 *
 * Every write re-fetches the VO (onChanged) so value_change + the live net
 * change in the ApproveBar stay server-computed — no client-side money math
 * beyond the editor's display-only preview.
 */

import { useMemo, useState } from 'react'
import type { BoqItem, BoqSection, VariationLine, VariationOrder } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { deleteVariationLineAction } from '@/actions/variation.actions'
import { fmtQty } from '../../rates/_components/format'
import { VariationLineEditor } from './VariationLineEditor'
import { NetChange } from './VariationsList'

interface Props {
  projectId: string
  vo: VariationOrder
  lines: VariationLine[]
  /** The current BOQ tree (from the page's listBoqAction) — feeds the editor + name resolution. */
  sections: BoqSection[]
  items: BoqItem[]
  canEdit: boolean
  /** Re-fetch the VO after a write (keeps lines + net change live). */
  onChanged: () => void
  /** The ApproveBar (or approved read-only banner), rendered at the top. */
  approveBar?: React.ReactNode
}

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 12, verticalAlign: 'top' }
const tdNum: React.CSSProperties = {
  ...td,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
  color: 'var(--c-text-mid)',
}

/** Signed quantity: +12 / −3 (the sign is the point of a delta). */
function fmtSignedQty(value: number): string {
  return `${value < 0 ? '−' : '+'}${fmtQty(Math.abs(value))}`
}

export function VariationDetail({
  projectId,
  vo,
  lines,
  sections,
  items,
  canEdit,
  onChanged,
  approveBar,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const editable = canEdit && vo.status === 'draft'

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections])

  async function handleDelete(lineId: string) {
    setActionError(null)
    const res = await deleteVariationLineAction(projectId, vo.id, lineId)
    if ('error' in res) {
      setActionError(res.error)
      return
    }
    onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {approveBar}

      {vo.reason && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
          Reason: {vo.reason}
        </p>
      )}

      {actionError && (
        <div style={{ fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid #6b1e1e', borderRadius: 6, padding: '8px 12px' }}>
          {actionError}
        </div>
      )}

      {/* Lines table */}
      {lines.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
          No lines yet{editable ? ' — add the first one below.' : '.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                <th style={th}>Kind</th>
                <th style={th}>Item</th>
                <th style={{ ...th, textAlign: 'right' }}>Qty Δ / Qty</th>
                <th style={{ ...th, textAlign: 'right' }}>Value change</th>
                {editable && <th style={{ ...th, width: 1 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  itemById={itemById}
                  sectionById={sectionById}
                  editable={editable}
                  onDelete={() => handleDelete(line.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add line (draft only) */}
      {editable && !adding && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            + Add line
          </Button>
        </div>
      )}
      {editable && adding && (
        <VariationLineEditor
          projectId={projectId}
          voId={vo.id}
          sections={sections}
          items={items}
          onSaved={() => {
            setAdding(false)
            onChanged()
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function LineRow({
  line,
  itemById,
  sectionById,
  editable,
  onDelete,
}: {
  line: VariationLine
  itemById: Map<string, BoqItem>
  sectionById: Map<string, BoqSection>
  editable: boolean
  onDelete: () => Promise<void>
}) {
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isAdjust = line.kind === 'adjust'
  const targetItem = isAdjust && line.boqItemId ? itemById.get(line.boqItemId) ?? null : null
  const targetSection = !isAdjust && line.sectionId ? sectionById.get(line.sectionId) ?? null : null

  async function confirmDelete() {
    setBusy(true)
    await onDelete()
    setBusy(false)
    setArming(false)
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
      <td style={td}>
        {isAdjust ? <Badge variant="default">adjust</Badge> : <Badge variant="info">add</Badge>}
      </td>
      <td style={{ ...td, color: 'var(--c-text-mid)', minWidth: 240 }}>
        {isAdjust ? (
          targetItem ? (
            <span>
              {targetItem.code && (
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)', marginRight: 8 }}>
                  {targetItem.code}
                </span>
              )}
              {targetItem.description}
            </span>
          ) : (
            <span style={{ color: 'var(--c-text-dim)' }}>Contract item no longer in the current import</span>
          )
        ) : (
          <span>
            {line.description}
            {targetSection && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginLeft: 8 }}>
                in {targetSection.code ? `${targetSection.code} · ` : ''}{targetSection.title}
              </span>
            )}
          </span>
        )}
      </td>
      <td style={tdNum}>
        {isAdjust
          ? line.qtyDelta != null ? fmtSignedQty(line.qtyDelta) : '—'
          : `${fmtQty(line.quantity)}${line.unit ? ` ${line.unit}` : ''}`}
      </td>
      <td style={{ ...tdNum, fontWeight: 600 }}>
        <NetChange value={line.valueChange} />
      </td>
      {editable && (
        <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
          {arming ? (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Button variant="ghost" size="sm" onClick={() => setArming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" isLoading={busy} disabled={busy} onClick={confirmDelete}>
                Confirm
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setArming(true)}>
              Remove
            </Button>
          )}
        </td>
      )}
    </tr>
  )
}
