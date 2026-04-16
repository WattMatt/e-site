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
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">Respond to Order</h3>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {isQuoteStage && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">
            Quoted Amount (ZAR)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={quotedAmount}
            onChange={e => setQuotedAmount(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-slate-500 mt-1">Update if your price differs from the listed price.</p>
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">
          Notes / ETA (optional)
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Add notes, delivery ETA, special conditions…"
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {availableTransitions.map(status => (
          <button
            key={status}
            onClick={() => act(status)}
            disabled={isPending}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
              status === 'cancelled'
                ? 'bg-red-900/30 text-red-400 border border-red-700/40 hover:bg-red-900/50'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isPending ? '…' : STATUS_LABEL[status] ?? status}
          </button>
        ))}
      </div>
    </div>
  )
}
