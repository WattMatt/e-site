'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { deleteInspectionAction } from '@/actions/inspections.actions'

interface Props {
  inspectionId: string
  projectId: string
  status: string
  /** Inspection's target label, shown in the modal for clarity. */
  label: string
}

/**
 * Inline per-row Delete button. Owner-only, blocked when status='certified'.
 * Opens a modal with type-to-confirm. Mirrors the pattern in DeletePanel
 * (inside InspectionActions.tsx) but rendered as a single button next to Open.
 */
export default function InspectionRowDeleteButton({
  inspectionId,
  projectId,
  status,
  label,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Hard-block at the UI layer; server action also blocks
  if (status === 'certified') return null

  const expectedText = `delete-inspection-${inspectionId.slice(0, 8)}`
  const matches = confirmText === expectedText
  const canSubmit = matches && !pending

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await deleteInspectionAction(inspectionId, projectId, confirmText)
      if (res.ok) {
        setOpen(false)
        setConfirmText('')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  function reset() {
    setOpen(false)
    setConfirmText('')
    setError(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginLeft: 12,
          fontSize: 12,
          color: 'var(--c-red, #dc2626)',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textDecoration: 'underline',
          fontFamily: 'inherit',
        }}
        aria-label={`Delete inspection: ${label}`}
      >
        Delete
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete inspection"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) reset()
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <form
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--c-panel, #1a1a1a)',
              border: '1px solid var(--c-red, #dc2626)',
              borderRadius: 6,
              padding: 24,
              maxWidth: 480,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 16, color: 'var(--c-red, #dc2626)' }}>
              Permanently delete inspection
            </h2>

            <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
              You are about to delete <strong>{label}</strong>. This permanently removes
              the inspection, all responses, photos, signatures, and certificates. This
              cannot be undone.
            </p>

            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>
              Type{' '}
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  background: 'var(--c-bg, #000)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  color: 'var(--c-text)',
                }}
              >
                {expectedText}
              </code>{' '}
              to confirm.
            </p>

            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expectedText}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: '8px 10px',
                background: 'var(--c-bg, #000)',
                color: 'var(--c-text)',
                border: '1px solid var(--c-border)',
                borderRadius: 4,
                outline: 'none',
              }}
            />

            {error && (
              <p style={{ color: 'var(--c-red, #dc2626)', fontSize: 12, margin: 0 }}>{error}</p>
            )}

            {!matches && confirmText.length > 0 && (
              <p style={{ color: 'var(--c-text-dim)', fontSize: 11, margin: 0 }}>
                Text must match exactly.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                style={{
                  fontSize: 12,
                  padding: '6px 14px',
                  background: 'transparent',
                  color: 'var(--c-text-dim)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 4,
                  cursor: pending ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  fontSize: 12,
                  padding: '6px 14px',
                  background: canSubmit ? 'var(--c-red, #dc2626)' : 'var(--c-border)',
                  color: canSubmit ? '#fff' : 'var(--c-text-dim)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                {pending ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
