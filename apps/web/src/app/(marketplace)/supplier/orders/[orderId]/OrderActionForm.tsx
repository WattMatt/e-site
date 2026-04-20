'use client'

import { useState, useTransition } from 'react'
import { updateOrderStatusAction } from '@/actions/supplier.actions'
import { useRouter } from 'next/navigation'

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirm Order',
  in_transit: 'Mark as In Transit',
  delivered: 'Mark as Delivered',
  invoiced: 'Mark as Invoiced',
  cancelled: 'Cancel Order',
}

const NEEDS_QUOTE = ['submitted']

interface Props {
  orderId: string
  currentStatus: string
  availableTransitions: string[]
  currentNotes: string
  currentTotal: number
}

export function OrderActionForm({
  orderId,
  currentStatus,
  availableTransitions,
  currentNotes,
  currentTotal,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState(currentNotes)
  const [quotedAmount, setQuotedAmount] = useState<string>(currentTotal?.toString() ?? '')

  const isQuoteStage = NEEDS_QUOTE.includes(currentStatus)

  function act(status: string) {
    setError(null)
    startTransition(async () => {
      const result = await updateOrderStatusAction(orderId, status, {
        notes: notes.trim() || undefined,
        quotedAmount: isQuoteStage && quotedAmount ? parseFloat(quotedAmount) : undefined,
      })
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="data-panel animate-fadeup animate-fadeup-2">
      <div className="data-panel-header">
        <span className="data-panel-title">Respond to Order</span>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div
            role="alert"
            style={{
              background: 'var(--c-red-dim)',
              border: '1px solid rgba(127,29,29,0.6)',
              color: '#fca5a5',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {isQuoteStage && (
          <div>
            <label className="ob-label" htmlFor="quoted_amount">Quoted Amount (ZAR)</label>
            <input
              id="quoted_amount"
              type="number"
              min="0"
              step="0.01"
              value={quotedAmount}
              onChange={e => setQuotedAmount(e.target.value)}
              className="ob-input"
            />
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
              Update if your price differs from the listed price.
            </p>
          </div>
        )}

        <div>
          <label className="ob-label" htmlFor="notes">Notes / ETA (optional)</label>
          <textarea
            id="notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Add notes, delivery ETA, special conditions…"
            className="ob-input"
            style={{ resize: 'vertical', minHeight: 72 }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {availableTransitions.map(status => {
            const isCancel = status === 'cancelled'
            return (
              <button
                key={status}
                onClick={() => act(status)}
                disabled={isPending}
                className={isCancel ? undefined : 'btn-primary-amber'}
                style={
                  isCancel
                    ? {
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '9px 16px',
                        borderRadius: 6,
                        background: 'var(--c-red-dim)',
                        color: '#fca5a5',
                        border: '1px solid rgba(127,29,29,0.6)',
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        opacity: isPending ? 0.5 : 1,
                      }
                    : {
                        fontSize: 13,
                        fontWeight: 600,
                        padding: '9px 16px',
                        cursor: isPending ? 'not-allowed' : 'pointer',
                        opacity: isPending ? 0.5 : 1,
                      }
                }
              >
                {isPending ? '…' : STATUS_LABEL[status] ?? status}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
