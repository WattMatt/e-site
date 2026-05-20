'use client'

/**
 * OrderRow — per-order status controls for the node-orders view.
 *
 * Renders a single table row with inline "Mark ordered" / "Mark received" buttons
 * wired to Task 4.3's server actions. Notes are shown as read-only text; editing
 * is v2 (a textarea inline edit would add significant complexity for minimal v1 value).
 *
 * Status lifecycle: by_tenant | required → ordered → received
 */

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  markOrderedAction,
  markReceivedAction,
} from '@/actions/node-order.actions'

export interface OrderRowData {
  id: string
  node_code: string
  node_name: string | null
  label: string
  status: 'by_tenant' | 'required' | 'ordered' | 'received'
  ordered_at: string | null
  received_at: string | null
  notes: string
}

function statusBadge(status: OrderRowData['status']) {
  const map: Record<OrderRowData['status'], { variant: 'ghost' | 'warning' | 'info' | 'success'; label: string }> = {
    by_tenant: { variant: 'ghost',   label: 'By tenant' },
    required:  { variant: 'warning', label: 'Required'  },
    ordered:   { variant: 'info',    label: 'Ordered'   },
    received:  { variant: 'success', label: 'Received'  },
  }
  const { variant, label } = map[status] ?? { variant: 'ghost', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

export function OrderRow({
  order,
  projectId,
}: {
  order: OrderRowData
  projectId: string
}) {
  const [isPendingOrdered, startOrdered] = useTransition()
  const [isPendingReceived, startReceived] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleMarkOrdered() {
    setError(null)
    startOrdered(async () => {
      const result = await markOrderedAction(projectId, order.id)
      if ('error' in result) setError(result.error)
    })
  }

  function handleMarkReceived() {
    setError(null)
    startReceived(async () => {
      const result = await markReceivedAction(projectId, order.id)
      if ('error' in result) setError(result.error)
    })
  }

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
        {/* Node */}
        <td style={{ padding: '10px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
          {order.node_code}
          {order.node_name && (
            <span style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
              {order.node_name}
            </span>
          )}
        </td>
        {/* Label */}
        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text-mid)' }}>
          {order.label}
        </td>
        {/* Status */}
        <td style={{ padding: '10px 12px' }}>
          {statusBadge(order.status)}
        </td>
        {/* Ordered at */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
          {order.ordered_at ?? '—'}
        </td>
        {/* Received at */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
          {order.received_at ?? '—'}
        </td>
        {/* Notes */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', maxWidth: 220 }}>
          {order.notes || '—'}
        </td>
        {/* Actions */}
        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
          {order.status === 'required' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkOrdered}
              isLoading={isPendingOrdered}
            >
              Mark ordered
            </Button>
          )}
          {order.status === 'ordered' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkReceived}
              isLoading={isPendingReceived}
            >
              Mark received
            </Button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td
            colSpan={7}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              color: 'var(--c-red)',
              background: 'var(--c-red-dim)',
            }}
          >
            {error}
          </td>
        </tr>
      )}
    </>
  )
}
