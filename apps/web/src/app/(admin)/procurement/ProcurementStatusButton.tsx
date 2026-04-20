'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { procurementService } from '@esite/shared'
import { useRouter } from 'next/navigation'

const STATUS_FLOW: Record<string, string[]> = {
  draft:     ['sent', 'cancelled'],
  sent:      ['quoted', 'cancelled'],
  quoted:    ['approved', 'cancelled'],
  approved:  ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
}

const STATUS_LABELS: Record<string, string> = {
  sent: 'Mark Sent', quoted: 'Mark Quoted', approved: 'Approve',
  fulfilled: 'Mark Fulfilled', cancelled: 'Cancel',
}

interface Props {
  id: string
  currentStatus: string
  quotedPrice?: number | null
}

export function ProcurementStatusButton({ id, currentStatus, quotedPrice }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showQuoteInput, setShowQuoteInput] = useState(false)
  const [quoteValue, setQuoteValue] = useState(quotedPrice ? String(quotedPrice / 100) : '')
  const [poNumber, setPoNumber] = useState('')

  const nextStatuses = STATUS_FLOW[currentStatus] ?? []
  if (nextStatuses.length === 0) return null

  async function advance(nextStatus: string) {
    if (nextStatus === 'quoted' && !quotedPrice) {
      setShowQuoteInput(true)
      return
    }
    const client = createClient()
    await procurementService.updateStatus(client as any, id, nextStatus, {
      quotedPrice: nextStatus === 'quoted' && quoteValue ? Math.round(parseFloat(quoteValue) * 100) : undefined,
      poNumber: poNumber || undefined,
    })
    startTransition(() => router.refresh())
    setShowQuoteInput(false)
  }

  if (showQuoteInput) {
    return (
      <div style={{
        marginTop: 10, padding: '12px 14px', borderRadius: 6,
        background: 'var(--c-elevated)', border: '1px solid var(--c-border)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--c-text-dim)', textTransform: 'uppercase' }}>
          Enter quoted price (ZAR)
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={quoteValue}
            onChange={e => setQuoteValue(e.target.value)}
            placeholder="0.00"
            className="ob-input"
            style={{ flex: 1 }}
          />
          <input
            type="text"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            placeholder="PO # (optional)"
            className="ob-input"
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => advance('quoted')}
            disabled={!quoteValue || isPending}
            className="btn-primary-amber"
            style={{ flex: 1, fontSize: 11, opacity: (!quoteValue || isPending) ? 0.5 : 1 }}
          >
            Confirm Quote
          </button>
          <button
            onClick={() => setShowQuoteInput(false)}
            style={{
              padding: '7px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid var(--c-border)', background: 'var(--c-panel)',
              color: 'var(--c-text-dim)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {nextStatuses.map(s => (
        <button
          key={s}
          onClick={() => advance(s)}
          disabled={isPending}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
            border: `1px solid ${s === 'cancelled' ? '#7f1d1d' : 'var(--c-amber-mid)'}`,
            background: s === 'cancelled' ? 'var(--c-red-dim)' : 'var(--c-amber-dim)',
            color: s === 'cancelled' ? 'var(--c-red)' : 'var(--c-amber)',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.5 : 1,
          }}
        >
          {STATUS_LABELS[s] ?? s}
        </button>
      ))}
    </div>
  )
}
