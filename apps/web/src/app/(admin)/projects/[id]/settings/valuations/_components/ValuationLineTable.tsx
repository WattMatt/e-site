'use client'

/**
 * ValuationLineTable — priced leaf rows for one section, with a progress column.
 *
 * Mirrors the Rates tab's BoqLineItemTable (code · description · unit · qty ·
 * amount, natural-sorted by code, RATE-ONLY / provisional / PC-sum badges) but
 * swaps the editable rate cells for a per-line PROGRESS cell + a live
 * VALUE TO DATE cell.
 *
 * Progress entry:
 *   - Normal items: a "%" input (inputMethod 'percent', 0–100).
 *   - RATE-ONLY items (no contract amount): a "qty" input (inputMethod
 *     'quantity') — there is no amount to take a percentage of.
 * An over-measure warning badge shows when a quantity line values more than the
 * contract amount (isOverMeasure). Read-only (certified / no edit) renders the
 * stored percent/qty + value as plain text.
 */

import { useState } from 'react'
import type { BoqItem, ValuationLine, ValuationProgressPatch } from '@esite/shared'
import { isOverMeasure } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { naturalCompare } from '@/lib/natural-compare'
import { fmtMoney, fmtQty } from '../../rates/_components/format'

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}
const thNum: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 12, verticalAlign: 'top' }
const tdNum: React.CSSProperties = {
  ...td,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
  color: 'var(--c-text-mid)',
}

/** True when this item has no contract amount → progress must be by quantity. */
function isRateOnly(item: BoqItem): boolean {
  return item.quantityMode === 'rate_only' || item.amount == null
}

function quantityModeBadge(mode: BoqItem['quantityMode']) {
  switch (mode) {
    case 'rate_only':
      return <Badge variant="info">RATE ONLY</Badge>
    case 'provisional':
      return <Badge variant="warning">provisional</Badge>
    case 'pc_sum':
      return <Badge variant="warning">PC sum</Badge>
    default:
      return null
  }
}

interface Props {
  items: BoqItem[]
  /** The valuation line for an item id (its current progress), if any. */
  linesByItem: Map<string, ValuationLine>
  /** Revised amount per boqItemId from approved variation adjustments (null = no adjustment). */
  revisedByItem?: Map<string, number | null>
  canEdit: boolean
  /** Commit a progress patch for one item; resolves to an error string or null. */
  onCommit: (patch: ValuationProgressPatch) => Promise<string | null>
}

export function ValuationLineTable({ items, linesByItem, revisedByItem, canEdit, onCommit }: Props) {
  const sorted = [...items].sort((a, b) => naturalCompare(a.code ?? '', b.code ?? ''))

  if (sorted.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)', margin: '8px 0' }}>
        No line items in this section.
      </p>
    )
  }

  return (
    <TableScrollX>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
            <th style={th}>Code</th>
            <th style={th}>Description</th>
            <th style={th}>Unit</th>
            <th style={thNum}>Qty</th>
            <th style={thNum}>Amount</th>
            <th style={thNum}>Progress</th>
            <th style={thNum}>Value to date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <LineRow
              key={item.id}
              item={item}
              line={linesByItem.get(item.id) ?? null}
              revisedAmount={revisedByItem ? (revisedByItem.get(item.id) ?? null) : null}
              canEdit={canEdit}
              onCommit={onCommit}
            />
          ))}
        </tbody>
      </table>
    </TableScrollX>
  )
}

function LineRow({
  item,
  line,
  revisedAmount,
  canEdit,
  onCommit,
}: {
  item: BoqItem
  line: ValuationLine | null
  /** Revised amount from approved variation adjustments, or null when none. */
  revisedAmount: number | null
  canEdit: boolean
  onCommit: (patch: ValuationProgressPatch) => Promise<string | null>
}) {
  const rateOnly = isRateOnly(item)
  const valueToDate = line?.valueToDate ?? 0

  // Over-measure: only meaningful for quantity lines against a (revised) amount.
  // When the item has an approved VO the revised amount replaces the contract
  // cap — so an approved over-measure VO correctly suppresses the badge.
  const over = line
    ? isOverMeasure(
        { amount: item.amount, supplyRate: item.supplyRate, installRate: item.installRate, rate: item.rate, rateModel: item.rateModel },
        { inputMethod: line.inputMethod, qtyComplete: line.qtyComplete },
        revisedAmount != null ? { revisedAmount, revisedQty: null } : undefined,
      )
    : false

  return (
    <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
      <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
        {item.code ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
      </td>
      <td style={{ ...td, color: 'var(--c-text-mid)', minWidth: 220 }}>
        <span>{item.description}</span>
        {item.quantityMode !== 'measured' && item.quantityMode !== 'lump_sum' && (
          <span style={{ marginLeft: 8 }}>{quantityModeBadge(item.quantityMode)}</span>
        )}
        {over && (
          <span style={{ marginLeft: 8 }}>
            <Badge variant="warning">over-measure</Badge>
          </span>
        )}
      </td>
      <td style={{ ...td, color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
        {item.unit ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
      </td>
      <td style={tdNum}>{fmtQty(item.quantity)}</td>
      <td style={tdNum}>{fmtMoney(item.amount)}</td>
      {/* Progress */}
      <td style={tdNum}>
        {canEdit ? (
          <ProgressCell item={item} line={line} rateOnly={rateOnly} onCommit={onCommit} />
        ) : (
          <ReadOnlyProgress line={line} rateOnly={rateOnly} />
        )}
      </td>
      {/* Value to date */}
      <td style={{ ...tdNum, color: 'var(--c-text)', fontWeight: 600 }}>{fmtMoney(valueToDate)}</td>
    </tr>
  )
}

function ReadOnlyProgress({ line, rateOnly }: { line: ValuationLine | null; rateOnly: boolean }) {
  if (!line) return <span style={{ color: 'var(--c-text-dim)' }}>—</span>
  if (rateOnly || line.inputMethod === 'quantity') {
    return <span>{fmtQty(line.qtyComplete)}</span>
  }
  return <span>{line.percentComplete != null ? `${line.percentComplete}%` : '—'}</span>
}

const CELL_INPUT: React.CSSProperties = {
  width: 80,
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '4px 8px',
  color: 'var(--c-text)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  boxSizing: 'border-box',
}

/**
 * An editable progress cell. RATE-ONLY → quantity input (inputMethod
 * 'quantity'); otherwise → percent input (inputMethod 'percent'). Commits on
 * blur / Enter when the value changed; shows a transient error inline.
 */
function ProgressCell({
  item,
  line,
  rateOnly,
  onCommit,
}: {
  item: BoqItem
  line: ValuationLine | null
  rateOnly: boolean
  onCommit: (patch: ValuationProgressPatch) => Promise<string | null>
}) {
  const initial = rateOnly
    ? line?.qtyComplete != null ? String(line.qtyComplete) : ''
    : line?.percentComplete != null ? String(line.percentComplete) : ''

  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function commit() {
    setErr(null)
    const trimmed = draft.trim()
    // Empty → treat as 0 so a cleared cell zeroes the line.
    const n = trimmed === '' ? 0 : Number(trimmed)
    if (Number.isNaN(n) || n < 0) {
      setErr('Invalid')
      return
    }
    const patch: ValuationProgressPatch = rateOnly
      ? { boqItemId: item.id, inputMethod: 'quantity', qtyComplete: n }
      : { boqItemId: item.id, inputMethod: 'percent', percentComplete: Math.min(100, n) }

    // No-op if unchanged from the persisted value.
    const current = rateOnly ? line?.qtyComplete ?? null : line?.percentComplete ?? null
    const next = rateOnly ? n : Math.min(100, n)
    if (current === next) return

    setBusy(true)
    const error = await onCommit(patch)
    setBusy(false)
    if (error) setErr(error)
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          min={0}
          max={rateOnly ? undefined : 100}
          step={rateOnly ? 'any' : 1}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          style={CELL_INPUT}
          aria-label={rateOnly ? 'Quantity complete' : 'Percent complete'}
        />
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{rateOnly ? item.unit ?? 'qty' : '%'}</span>
      </span>
      {err && <span style={{ fontSize: 10, color: 'var(--c-red)' }}>{err}</span>}
    </span>
  )
}
