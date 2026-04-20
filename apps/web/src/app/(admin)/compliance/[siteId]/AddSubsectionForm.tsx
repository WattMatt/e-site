'use client'

import { useState, useRef } from 'react'
import { createSubsectionAction } from '@/actions/compliance.actions'

interface Props {
  siteId: string
}

export function AddSubsectionForm({ siteId }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createSubsectionAction(siteId, formData)
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      formRef.current?.reset()
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px dashed var(--c-border)',
          background: 'transparent',
          color: 'var(--c-text-dim)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.borderColor = 'var(--c-amber)'
          el.style.color = 'var(--c-amber)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.borderColor = 'var(--c-border)'
          el.style.color = 'var(--c-text-dim)'
        }}
      >
        + Add subsection
      </button>
    )
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)', border: '1px solid var(--c-border)',
        borderRadius: 8, padding: 16, width: '100%', maxWidth: 520,
      }}
    >
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-mid)', marginBottom: 14 }}>
        New subsection
      </p>
      <form ref={formRef} action={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label className="ob-label">
            Name <span style={{ color: 'var(--c-red)' }}>*</span>
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="e.g. Main Distribution Board"
            className="ob-input"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="ob-label">SANS reference</label>
            <input
              name="sans_ref"
              type="text"
              placeholder="e.g. SANS 10142-1"
              className="ob-input"
            />
          </div>
          <div>
            <label className="ob-label">Sort order</label>
            <input
              name="sort_order"
              type="number"
              min="0"
              defaultValue="0"
              className="ob-input"
            />
          </div>
        </div>

        <div>
          <label className="ob-label">Description</label>
          <input
            name="description"
            type="text"
            placeholder="Optional notes"
            className="ob-input"
          />
        </div>

        {error && <p className="ob-error" role="alert">{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary-amber"
            style={{ padding: '7px 14px' }}
          >
            {loading ? 'Adding…' : 'Add subsection'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null) }}
            className="btn-primary-amber"
            style={{
              padding: '7px 14px',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
