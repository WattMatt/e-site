'use client'

/**
 * BoqLineItemTable — priced leaf rows for one selected section/category.
 *
 * Columns: code · description · unit · qty · supply · install · amount.
 * Rows are natural-sorted by code (DB-2 before DB-10). Badges flag the quantity
 * mode: RATE ONLY (info), provisional / PC sum (warning).
 *
 * Supply/install/single rate cells are editable (RateCell) when canEdit; commits
 * bubble up via onItemUpdated so the parent can refresh rollups. Read-only
 * callers see plain numbers.
 */

import { Badge } from '@/components/ui/Badge'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { naturalCompare } from '@/lib/natural-compare'
import type { BoqItem } from '@esite/shared'
import { fmtMoney, fmtQty } from './format'
import { RateCell } from './RateCell'

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

/** Badge for a non-measured quantity mode; measured/lump_sum render nothing. */
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
  projectId: string
  canEdit: boolean
  /** Bubbled when a rate edit commits, so the parent can recompute rollups. */
  onItemUpdated: (item: BoqItem) => void
}

export function BoqLineItemTable({ items, projectId, canEdit, onItemUpdated }: Props) {
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
            <th style={thNum}>Supply</th>
            <th style={thNum}>Install</th>
            <th style={thNum}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const single = item.rateModel === 'single'
            const amountOnly = item.rateModel === 'amount_only'
            return (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                {/* Code */}
                <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                  {item.code ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                </td>
                {/* Description + mode badge */}
                <td style={{ ...td, color: 'var(--c-text-mid)', minWidth: 240 }}>
                  <span>{item.description}</span>
                  {item.quantityMode !== 'measured' && item.quantityMode !== 'lump_sum' && (
                    <span style={{ marginLeft: 8 }}>{quantityModeBadge(item.quantityMode)}</span>
                  )}
                </td>
                {/* Unit */}
                <td style={{ ...td, color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                  {item.unit ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                </td>
                {/* Qty */}
                <td style={tdNum}>{fmtQty(item.quantity)}</td>
                {/* Supply (single uses this column; amount_only leaves it blank) */}
                <td style={tdNum}>
                  {amountOnly ? (
                    <span style={{ color: 'var(--c-text-dim)' }}>—</span>
                  ) : single ? (
                    canEdit ? (
                      <RateCell item={item} projectId={projectId} field="rate" onCommitted={onItemUpdated} />
                    ) : (
                      fmtMoney(item.rate)
                    )
                  ) : canEdit ? (
                    <RateCell item={item} projectId={projectId} field="supplyRate" onCommitted={onItemUpdated} />
                  ) : (
                    fmtMoney(item.supplyRate)
                  )}
                </td>
                {/* Install (only for supply_install) */}
                <td style={tdNum}>
                  {single || amountOnly ? (
                    <span style={{ color: 'var(--c-text-dim)' }}>—</span>
                  ) : canEdit ? (
                    <RateCell item={item} projectId={projectId} field="installRate" onCommitted={onItemUpdated} />
                  ) : (
                    fmtMoney(item.installRate)
                  )}
                </td>
                {/* Amount */}
                <td style={{ ...tdNum, color: 'var(--c-text)', fontWeight: 600 }}>{fmtMoney(item.amount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableScrollX>
  )
}
