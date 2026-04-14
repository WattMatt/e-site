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
      <div className="flex flex-col gap-2 mt-2 p-3 bg-slate-800 rounded-lg border border-slate-600">
        <p className="text-xs text-slate-400 font-medium">Enter quoted price (ZAR)</p>
        <div className="flex gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={quoteValue}
            onChange={e => setQuoteValue(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            placeholder="PO # (optional)"
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => advance('quoted')}
            disabled={!quoteValue || isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold py-1.5 rounded transition-colors"
          >
            Confirm Quote
          </button>
          <button
            onClick={() => setShowQuoteInput(false)}
            className="px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs py-1.5 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-1.5 flex-wrap mt-2">
      {nextStatuses.map(s => (
        <button
          key={s}
          onClick={() => advance(s)}
          disabled={isPending}
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors disabled:opacity-50 ${
            s === 'cancelled'
              ? 'border-red-700 text-red-400 hover:bg-red-900/30'
              : 'border-blue-600 text-blue-400 hover:bg-blue-900/30'
          }`}
        >
          {STATUS_LABELS[s] ?? s}
        </button>
      ))}
    </div>
  )
}
