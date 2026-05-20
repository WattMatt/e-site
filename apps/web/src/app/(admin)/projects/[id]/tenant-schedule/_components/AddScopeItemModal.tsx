'use client'

/**
 * AddScopeItemModal — small form to add a new org-level scope item type.
 *
 * Renders as an inline modal (portalled to body via CSS fixed positioning).
 * Inserts a row into structure.scope_item_types via addScopeItemTypeAction.
 * The new item immediately appears in every tenant's scope panel on next
 * page load (registry-backed, not DDL).
 */

import { useState, useTransition, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { addScopeItemTypeAction } from '@/actions/tenant-scope.actions'

interface Props {
  projectId: string
  orgId: string
  onClose: () => void
  onAdded: (id: string, key: string, label: string) => void
}

export function AddScopeItemModal({ projectId, orgId, onClose, onAdded }: Props) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    labelRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function deriveKey(l: string): string {
    return l
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = label.trim()
    if (!trimmed) {
      setError('Label is required.')
      return
    }
    const key = deriveKey(trimmed)
    if (!key) {
      setError('Label must contain at least one letter or number.')
      return
    }

    startTransition(async () => {
      const res = await addScopeItemTypeAction(projectId, orgId, key, trimmed)
      if ('error' in res) {
        setError(res.error)
      } else {
        onAdded(res.id, key, trimmed)
        onClose()
      }
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add scope item"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1001,
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 10,
          padding: '24px 28px',
          width: 360,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--c-text)',
            marginBottom: 6,
          }}
        >
          Add scope item
        </h2>
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 20 }}>
          New items are added to the organisation-level registry and will appear
          for all tenants in this and future projects.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 6,
            }}
          >
            Label
          </label>
          <input
            ref={labelRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Power Points"
            maxLength={100}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 10px',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--c-text)',
              fontFamily: 'var(--font-sans)',
              outline: 'none',
              marginBottom: 4,
              boxSizing: 'border-box',
            }}
            disabled={isPending}
          />

          {label.trim() && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--c-text-dim)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 12,
              }}
            >
              Key: <code>{deriveKey(label)}</code>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '7px 10px',
                marginBottom: 12,
                background: 'var(--c-red-dim)',
                border: '1px solid var(--c-red)',
                borderRadius: 5,
                fontSize: 12,
                color: 'var(--c-red)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isPending}>
              Add item
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
