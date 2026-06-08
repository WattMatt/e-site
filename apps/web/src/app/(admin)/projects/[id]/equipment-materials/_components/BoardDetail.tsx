'use client'

/**
 * BoardDetail — the expanded procurement detail for one board.
 *
 * Renders each ProcLine (equipment boards have one "Order" line; tenant boards
 * have their scope-order lines): status badge, the single advance action
 * (Mark ordered → required; Mark received → ordered; never for by_tenant),
 * ordered/received/required-by dates, then the line's documents (Quote +
 * Order-instruction slots + shop drawings). Documents preview in an in-app
 * modal (D10) and download.
 *
 * A board with no lines (orderless — should not occur post-trigger D9) renders
 * a read-only "Required — no order yet".
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { markOrderedAction, markReceivedAction } from '@/actions/node-order.actions'
import type { ProcLine, ProcStatus, UnifiedBoard } from '../_lib/gather-unified-boards'
import { UnifiedDocSlot } from './UnifiedDocSlot'
import { UnifiedShopDrawingList } from './UnifiedShopDrawingList'

function statusBadge(status: ProcStatus) {
  const map: Record<ProcStatus, { variant: 'ghost' | 'warning' | 'info' | 'success'; label: string }> = {
    by_tenant: { variant: 'ghost', label: 'By tenant' },
    required: { variant: 'warning', label: 'Required' },
    ordered: { variant: 'info', label: 'Ordered' },
    received: { variant: 'success', label: 'Received' },
  }
  const { variant, label } = map[status] ?? { variant: 'ghost', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

const dateStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--c-text-dim)',
}

function LineActions({ projectId, line }: { projectId: string; line: ProcLine }) {
  const [isPendingOrdered, startOrdered] = useTransition()
  const [isPendingReceived, startReceived] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleMarkOrdered() {
    setError(null)
    startOrdered(async () => {
      const result = await markOrderedAction(projectId, line.orderId)
      if ('error' in result) setError(result.error)
    })
  }

  function handleMarkReceived() {
    setError(null)
    startReceived(async () => {
      const result = await markReceivedAction(projectId, line.orderId)
      if ('error' in result) setError(result.error)
    })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {line.status === 'required' && (
        <Button variant="secondary" size="sm" onClick={handleMarkOrdered} isLoading={isPendingOrdered}>
          Mark ordered
        </Button>
      )}
      {line.status === 'ordered' && (
        <Button variant="secondary" size="sm" onClick={handleMarkReceived} isLoading={isPendingReceived}>
          Mark received
        </Button>
      )}
      {error && <span style={{ fontSize: 11, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}

function LineBlock({
  projectId,
  line,
  isTenant,
}: {
  projectId: string
  line: ProcLine
  isTenant: boolean
}) {
  const title = isTenant ? line.scopeLabel ?? 'Scope' : 'Order'

  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        padding: '10px 12px',
        background: 'var(--c-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)', minWidth: 72 }}>{title}</span>
        {statusBadge(line.status)}
        {line.status !== 'by_tenant' && <LineActions projectId={projectId} line={line} />}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
          <span style={dateStyle}>Required by: {line.required_by ?? '—'}</span>
          <span style={dateStyle}>Ordered: {line.ordered_at ?? '—'}</span>
          <span style={dateStyle}>Received: {line.received_at ?? '—'}</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <UnifiedDocSlot projectId={projectId} nodeOrderId={line.orderId} docType="quote" label="Quote" doc={line.documents.quote} />
        <UnifiedDocSlot projectId={projectId} nodeOrderId={line.orderId} docType="order_instruction" label="Order instr." doc={line.documents.order_instruction} />
        <UnifiedShopDrawingList projectId={projectId} nodeOrderId={line.orderId} drawings={line.shopDrawings} />
      </div>
    </div>
  )
}

export function BoardDetail({ board, projectId }: { board: UnifiedBoard; projectId: string }) {
  const isTenant = board.type === 'tenant'

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {board.lines.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Required — no order yet</span>
      ) : (
        board.lines.map((line) => (
          <LineBlock key={line.orderId} projectId={projectId} line={line} isTenant={isTenant} />
        ))
      )}

      {isTenant && (
        <Link
          href={`/projects/${projectId}/tenant-schedule`}
          style={{ fontSize: 12, color: 'var(--c-amber)', alignSelf: 'flex-start' }}
        >
          Open {board.code} in Tenant Schedule — scope · drawings · BO ↗
        </Link>
      )}
    </div>
  )
}
