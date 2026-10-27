'use client'

/**
 * ScopeItemsModal — the org-wide scope item registry (structure.scope_item_types).
 *
 * Every item here is a column for EVERY tenant on EVERY project in the
 * organisation (incident 2026-10-16: a "Shop 6" typed on one project's
 * schedule appeared everywhere). So the add form says so in plain words and
 * needs an explicit "applies to all projects" tick before Add is enabled.
 *
 * Lists the current items; a non-built-in item can be removed with a two-step
 * inline confirm (no window.confirm — Safari suppresses it). The server action
 * refuses an item still in use and the modal shows its sentence.
 *
 * Add and Remove render only when `canManage` (org owner/admin/PM, computed on
 * the server — the actions enforce the same org-role gate).
 */

import { useState, useTransition, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { addScopeItemTypeAction, removeScopeItemTypeAction } from '@/actions/tenant-scope.actions'
import { isBuiltInScopeItem } from '@/lib/tenant-schedule/scope-item-registry'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'
import type { ScopeItemType } from './ScopeOfWorkPanel'

interface Props {
  projectId: string
  orgId: string
  /** Display name of the organisation the registry belongs to. */
  orgName: string
  items: ScopeItemType[]
  /** Org owner/admin/PM — may add and remove items. */
  canManage: boolean
  onClose: () => void
  onAdded: (id: string, key: string, label: string) => void
  onRemoved: (id: string) => void
}

const errorBox: React.CSSProperties = {
  padding: '7px 10px',
  marginBottom: 12,
  background: 'var(--c-red-dim)',
  border: '1px solid var(--c-red)',
  borderRadius: 5,
  fontSize: 12,
  color: 'var(--c-red)',
}

const sectionLabel: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  marginBottom: 6,
}

function deriveKey(l: string): string {
  return l
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

function ScopeItemRow({
  item,
  canRemove,
  onRemove,
}: {
  item: ScopeItemType
  canRemove: boolean
  onRemove: (id: string) => Promise<string | null>
}) {
  const { armed, arm, disarm } = useArmedConfirm()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const builtIn = isBuiltInScopeItem(item.key)

  function handleClick() {
    setError(null)
    if (!armed) {
      arm()
      return
    }
    disarm()
    startTransition(async () => {
      const err = await onRemove(item.id)
      if (err) setError(err)
    })
  }

  return (
    <li style={{ padding: '6px 0', borderBottom: '1px solid var(--c-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--c-text)' }}>
          {item.label}
          {builtIn && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--c-text-dim)' }}>built-in</span>
          )}
        </span>
        {canRemove && !builtIn && (
          <Button
            type="button"
            variant={armed ? 'danger' : 'ghost'}
            size="sm"
            onClick={handleClick}
            isLoading={isPending}
            aria-label={armed ? `Confirm remove ${item.label}` : `Remove ${item.label}`}
          >
            {armed ? 'Press again to remove' : 'Remove'}
          </Button>
        )}
      </div>
      {error && <div style={{ ...errorBox, marginTop: 6, marginBottom: 0 }}>{error}</div>}
    </li>
  )
}

export function ScopeItemsModal({
  projectId,
  orgId,
  orgName,
  items,
  canManage,
  onClose,
  onAdded,
  onRemoved,
}: Props) {
  const [label, setLabel] = useState('')
  const [understood, setUnderstood] = useState(false)
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!understood) return

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
        setLabel('')
        setUnderstood(false)
      }
    })
  }

  async function handleRemove(id: string): Promise<string | null> {
    const res = await removeScopeItemTypeAction(projectId, orgId, id)
    if ('error' in res) return res.error
    onRemoved(id)
    return null
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
        aria-label="Scope items"
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
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 12 }}>
          Scope items
        </h2>

        <span style={sectionLabel}>
          Current scope items
        </span>
        <ul
          aria-label="Current scope items"
          style={{ listStyle: 'none', margin: '0 0 20px', padding: 0 }}
        >
          {items.map((item) => (
            <ScopeItemRow key={item.id} item={item} canRemove={canManage} onRemove={handleRemove} />
          ))}
        </ul>

        {canManage && (
          <form onSubmit={handleSubmit}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', marginBottom: 8 }}>
              Add a scope item for ALL tenants
            </h3>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                color: 'var(--c-text)',
                background: 'var(--c-amber-dim, rgba(245,158,11,0.12))',
                border: '1px solid var(--c-amber)',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 14,
              }}
            >
              This adds a column for every tenant on every project in {orgName}. To note something for
              one shop, use that shop&apos;s scope documents or notes instead.
            </p>

            <label htmlFor="scope-item-label" style={sectionLabel}>
              Label
            </label>
            <input
              id="scope-item-label"
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

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--c-text)',
                margin: '10px 0 14px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                disabled={isPending}
              />
              I understand this applies to all projects
            </label>

            {error && <div style={errorBox}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
                Close
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isPending}
                disabled={!understood || isPending}
              >
                Add item
              </Button>
            </div>
          </form>
        )}

        {!canManage && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
