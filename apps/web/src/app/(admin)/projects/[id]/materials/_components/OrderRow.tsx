'use client'

/**
 * OrderRow — one row of the Material Order Tracker.
 *
 * Node · label · status · dates · the three document slots (Quote / Order
 * Instruction / Shop Drawing) · notes · status actions.
 *
 * Status lifecycle: by_tenant | required → ordered → received
 */

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { markOrderedAction, markReceivedAction } from '@/actions/node-order.actions'
import { OrderDocSlot, type OrderDoc } from './OrderDocSlot'
import { ShopDrawingList, type ShopDrawing } from './ShopDrawingList'

export interface OrderRowData {
  id: string
  node_code: string
  node_name: string | null
  label: string
  status: 'by_tenant' | 'required' | 'ordered' | 'received'
  ordered_at: string | null
  received_at: string | null
  required_by: string | null
  rag: 'red' | 'amber' | 'green' | 'neutral'
  notes: string
  documents: {
    quote: OrderDoc | null
    order_instruction: OrderDoc | null
  }
  shopDrawings: ShopDrawing[]
}

const RAG_COLOR: Record<OrderRowData['rag'], string> = {
  red: 'var(--c-red)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  neutral: 'var(--c-text-dim)',
}

const RAG_TITLE: Record<OrderRowData['rag'], string> = {
  red: 'Overdue',
  amber: 'Due soon',
  green: 'On track',
  neutral: 'No deadline',
}

function statusBadge(status: OrderRowData['status']) {
  const map: Record<
    OrderRowData['status'],
    { variant: 'ghost' | 'warning' | 'info' | 'success'; label: string }
  > = {
    by_tenant: { variant: 'ghost', label: 'By tenant' },
    required: { variant: 'warning', label: 'Required' },
    ordered: { variant: 'info', label: 'Ordered' },
    received: { variant: 'success', label: 'Received' },
  }
  const { variant, label } = map[status] ?? { variant: 'ghost', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

export function OrderRow({ order, projectId }: { order: OrderRowData; projectId: string }) {
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
        <td style={{ padding: '10px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--c-text)', verticalAlign: 'top' }}>
          {order.node_code}
          {order.node_name && (
            <span style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
              {order.node_name}
            </span>
          )}
        </td>
        {/* Label */}
        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text-mid)', verticalAlign: 'top' }}>
          {order.label}
        </td>
        {/* Status */}
        <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>{statusBadge(order.status)}</td>
        {/* Required by */}
        <td style={{ padding: '10px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          {order.required_by ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                title={RAG_TITLE[order.rag]}
                style={{ width: 8, height: 8, borderRadius: '50%', background: RAG_COLOR[order.rag], flexShrink: 0 }}
              />
              <span style={{ color: order.rag === 'red' ? 'var(--c-red)' : 'var(--c-text-mid)' }}>
                {order.required_by}
              </span>
            </span>
          ) : (
            <span style={{ color: 'var(--c-text-dim)' }}>—</span>
          )}
        </td>
        {/* Ordered at */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', verticalAlign: 'top' }}>
          {order.ordered_at ?? '—'}
        </td>
        {/* Received at */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', verticalAlign: 'top' }}>
          {order.received_at ?? '—'}
        </td>
        {/* Documents — 3 slots */}
        <td style={{ padding: '8px 12px', verticalAlign: 'top', minWidth: 250 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="quote" label="Quote" doc={order.documents.quote} />
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="order_instruction" label="Order instr." doc={order.documents.order_instruction} />
            <ShopDrawingList projectId={projectId} nodeOrderId={order.id} drawings={order.shopDrawings} />
          </div>
        </td>
        {/* Notes */}
        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', maxWidth: 200, verticalAlign: 'top' }}>
          {order.notes || '—'}
        </td>
        {/* Actions */}
        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
          {order.status === 'required' && (
            <Button variant="secondary" size="sm" onClick={handleMarkOrdered} isLoading={isPendingOrdered}>
              Mark ordered
            </Button>
          )}
          {order.status === 'ordered' && (
            <Button variant="secondary" size="sm" onClick={handleMarkReceived} isLoading={isPendingReceived}>
              Mark received
            </Button>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={9} style={{ padding: '6px 12px', fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)' }}>
            {error}
          </td>
        </tr>
      )}
    </>
  )
}
