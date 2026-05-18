'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createScheduleItemAction } from '@/actions/schedule.actions'

interface Props {
  projectId: string
}

export function AddScheduleItemForm({ projectId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [specification, setSpecification] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('')
  const [estimatedUnitCost, setEstimatedUnitCost] = useState('')
  const [instructions, setInstructions] = useState('')
  const [shopDrawingRequired, setShopDrawingRequired] = useState(false)

  function reset() {
    setItemCode('')
    setDescription('')
    setSpecification('')
    setQuantity('1')
    setUnit('')
    setEstimatedUnitCost('')
    setInstructions('')
    setShopDrawingRequired(false)
    setError(null)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be > 0')
      return
    }
    const estCost = estimatedUnitCost.trim()
      ? Number(estimatedUnitCost)
      : null
    if (estCost != null && !Number.isFinite(estCost)) {
      setError('Estimated unit cost must be a number')
      return
    }
    startTransition(async () => {
      const res = await createScheduleItemAction({
        projectId,
        itemCode: itemCode.trim() || null,
        description: description.trim(),
        specification: specification.trim() || null,
        quantity: qty,
        unit: unit.trim() || null,
        estimatedUnitCost: estCost,
        currency: 'ZAR',
        instructions: instructions.trim() || null,
        shopDrawingRequired,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn-primary-amber"
          onClick={() => setOpen(true)}
        >
          + Add schedule line
        </button>
      </div>
    )
  }

  return (
    <form
      className="data-panel"
      style={{
        padding: 16,
        marginBottom: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12,
      }}
      onSubmit={onSubmit}
    >
      <div>
        <label className="ob-label" htmlFor="sched-code">Item code</label>
        <input
          id="sched-code"
          className="ob-input"
          value={itemCode}
          onChange={(e) => setItemCode(e.target.value)}
          placeholder="EL-DB-01"
          maxLength={64}
        />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label className="ob-label" htmlFor="sched-desc">Description *</label>
        <input
          id="sched-desc"
          className="ob-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 400A Distribution Board"
          required
          maxLength={500}
        />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label className="ob-label" htmlFor="sched-spec">Specification</label>
        <input
          id="sched-spec"
          className="ob-input"
          value={specification}
          onChange={(e) => setSpecification(e.target.value)}
          placeholder="Make / model / standard"
          maxLength={1000}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="sched-qty">Quantity *</label>
        <input
          id="sched-qty"
          className="ob-input"
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="sched-unit">Unit</label>
        <input
          id="sched-unit"
          className="ob-input"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="m / each / set"
          maxLength={32}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="sched-cost">Est. unit cost (ZAR)</label>
        <input
          id="sched-cost"
          className="ob-input"
          type="number"
          step="0.01"
          min="0"
          value={estimatedUnitCost}
          onChange={(e) => setEstimatedUnitCost(e.target.value)}
          placeholder="0.00"
        />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label className="ob-label" htmlFor="sched-instructions">
          Instructions for procurement
        </label>
        <textarea
          id="sched-instructions"
          className="ob-input"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. SABS-certified only, delivery to site, match existing make"
          maxLength={4000}
        />
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--c-text)',
          gridColumn: '1 / -1',
        }}
      >
        <input
          type="checkbox"
          checked={shopDrawingRequired}
          onChange={(e) => setShopDrawingRequired(e.target.checked)}
        />
        Shop drawing approval required before order can proceed
      </label>

      {error && (
        <div
          role="alert"
          style={{ color: '#dc2626', fontSize: 12, gridColumn: '1 / -1' }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          gridColumn: '1 / -1',
        }}
      >
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="btn-primary-amber"
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-mid)',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary-amber"
          disabled={pending || description.trim().length < 2}
        >
          {pending ? 'Saving…' : 'Add line'}
        </button>
      </div>
    </form>
  )
}
