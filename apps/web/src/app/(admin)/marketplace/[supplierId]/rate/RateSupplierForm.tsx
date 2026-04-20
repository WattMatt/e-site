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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          style={{
            fontSize: 22,
            lineHeight: 1,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            color: star <= (hovered || value) ? 'var(--c-amber)' : 'var(--c-text-dim)',
            transition: 'transform 0.1s',
          }}
        >
          {star <= (hovered || value) ? '★' : '☆'}
        </button>
      ))}
      <input type="hidden" name={name} value={value} />
      {value > 0 && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginLeft: 6 }}>
          {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][value]}
        </span>
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="orderId" value={orderId} />

      {CRITERIA.map(({ key, label, description }) => (
        <div key={key} className="data-panel">
          <div style={{ padding: '14px 18px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{label}</p>
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 10 }}>{description}</p>
            <StarPicker
              name={key}
              value={scores[key]}
              onChange={v => setScores(prev => ({ ...prev, [key]: v }))}
            />
          </div>
        </div>
      ))}

      <div className="data-panel">
        <div style={{ padding: '14px 18px' }}>
          <label className="ob-label" htmlFor="comment">Comment (optional)</label>
          <textarea
            id="comment"
            name="comment"
            rows={3}
            className="ob-input"
            style={{ resize: 'vertical', minHeight: 72 }}
            placeholder="Share your experience with this supplier…"
          />
        </div>
      </div>

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

      <button
        type="submit"
        disabled={isPending || !allFilled}
        className="btn-primary-amber"
        style={{
          padding: '12px 18px',
          fontSize: 13,
          fontWeight: 700,
          opacity: (isPending || !allFilled) ? 0.5 : 1,
          cursor: (isPending || !allFilled) ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? 'Submitting…' : 'Submit Rating'}
      </button>
    </form>
  )
}
