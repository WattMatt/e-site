'use client'

/**
 * NodeOrderCell — inline order-status badge + advance buttons.
 *
 * Shared by the Equipment Schedule and Tenant Schedule pages.
 * Reuses the same status map and action calls as Task 4.4's OrderRow.
 *
 * Status lifecycle: by_tenant | required → ordered → received
 * Writes go through Task 4.3's markOrderedAction / markReceivedAction.
 */

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { markOrderedAction, markReceivedAction } from '@/actions/node-order.actions'

export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

export interface NodeOrderData {
  id: string
  status: NodeOrderStatus
}

const STATUS_BADGE: Record<NodeOrderStatus, { variant: 'ghost' | 'warning' | 'info' | 'success'; label: string }> = {
  by_tenant: { variant: 'ghost',   label: 'By tenant' },
  required:  { variant: 'warning', label: 'Required'  },
  ordered:   { variant: 'info',    label: 'Ordered'   },
  received:  { variant: 'success', label: 'Received'  },
}

interface Props {
  order: NodeOrderData | null
  projectId: string
  /** True for viewers without a write role — badge only, no advance buttons. */
  readOnly?: boolean
}

/**
 * Renders the order status for a single node order.
 * Shows a badge; for `required` adds a "Mark ordered" button;
 * for `ordered` adds a "Mark received" button.
 * Shows "—" when no order row exists yet.
 */
export function NodeOrderCell({ order, projectId, readOnly = false }: Props) {
  const [isPendingOrdered, startOrdered] = useTransition()
  const [isPendingReceived, startReceived] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!order) {
    return <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>—</span>
  }

  const { variant, label } = STATUS_BADGE[order.status] ?? { variant: 'ghost' as const, label: order.status }

  if (readOnly) {
    return <Badge variant={variant}>{label}</Badge>
  }

  function handleMarkOrdered() {
    setError(null)
    startOrdered(async () => {
      const result = await markOrderedAction(projectId, order!.id)
      if ('error' in result) setError(result.error)
    })
  }

  function handleMarkReceived() {
    setError(null)
    startReceived(async () => {
      const result = await markReceivedAction(projectId, order!.id)
      if ('error' in result) setError(result.error)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <Badge variant={variant}>{label}</Badge>
      {order.status === 'required' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleMarkOrdered}
          isLoading={isPendingOrdered}
          disabled={isPendingOrdered}
          style={{ fontSize: 11, padding: '1px 6px' }}
        >
          Mark ordered
        </Button>
      )}
      {order.status === 'ordered' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleMarkReceived}
          isLoading={isPendingReceived}
          disabled={isPendingReceived}
          style={{ fontSize: 11, padding: '1px 6px' }}
        >
          Mark received
        </Button>
      )}
      {error && (
        <span style={{ fontSize: 11, color: 'var(--c-red)' }}>{error}</span>
      )}
    </div>
  )
}
