'use client'

import { useState, useTransition } from 'react'
import { submitRatingAction } from '@/actions/rating.actions'

interface Props {
  supplierId: string
  orderId: string
}

const CRITERIA = [
  { key: 'deliveryScore', label: 'Delivery Timeliness', description: 'Was the order delivered on time?' },
  { key: 'qualityScore', label: 'Product Quality', description: 'Were products as described?' },
  { key: 'communicationScore', label: 'Communication', description: 'Was the supplier responsive?' },
  { key: 'pricingScore', label: 'Pricing', description: 'Were prices fair and competitive?' },
] as const

function StarPicker({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="text-2xl leading-none transition-transform hover:scale-110"
        >
          {star <= (hovered || value) ? '⭐' : '☆'}
        </button>
      ))}
      <input type="hidden" name={name} value={value} />
      {value > 0 && (
        <span className="text-sm text-slate-400 ml-1">{['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][value]}</span>
      )}
    </div>
  )
}

export function RateSupplierForm({ supplierId, orderId }: Props) {
  const [scores, setScores] = useState({ deliveryScore: 0, qualityScore: 0, communicationScore: 0, pricingScore: 0 })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allFilled = Object.values(scores).every(s => s > 0)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!allFilled) { setError('Please rate all criteria'); return }
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await submitRatingAction(fd)
      if (result && 'error' in result) setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="orderId" value={orderId} />

      {CRITERIA.map(({ key, label, description }) => (
        <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-sm font-semibold text-white mb-0.5">{label}</p>
          <p className="text-xs text-slate-400 mb-3">{description}</p>
          <StarPicker
            name={key}
            value={scores[key]}
            onChange={v => setScores(prev => ({ ...prev, [key]: v }))}
          />
        </div>
      ))}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <label className="block text-sm font-semibold text-white mb-2">Comment (optional)</label>
        <textarea
          name="comment"
          rows={3}
          className="w-full bg-slate-800 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-slate-500"
          placeholder="Share your experience with this supplier…"
        />
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || !allFilled}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
      >
        {isPending ? 'Submitting…' : 'Submit Rating'}
      </button>
    </form>
  )
}
