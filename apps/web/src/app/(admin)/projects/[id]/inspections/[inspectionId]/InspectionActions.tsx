'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  abandonInspectionAction,
  deleteInspectionAction,
} from '@/actions/inspections.actions'

interface Props {
  inspectionId: string
  projectId: string
  status: string
  /** Org-level role resolved by the parent server component. */
  role: string | null
}

/**
 * Danger-zone panel rendered at the bottom of the inspection detail page.
 *
 * Abandon: visible to PM/admin/owner when status is not certified or already abandoned.
 * Delete:  owner-only, when status != certified. Hidden inside an "Advanced" toggle.
 */
export default function InspectionActions({
  inspectionId,
  projectId,
  status,
  role,
}: Props) {
  const router = useRouter()

  const canAbandon =
    !['certified', 'abandoned'].includes(status) &&
    role != null &&
    ['owner', 'admin', 'project_manager'].includes(role)

  const canDelete = role === 'owner' && status !== 'certified'

  if (!canAbandon && !canDelete) return null

  return (
    <div
      className="data-panel animate-fadeup animate-fadeup-4"
      style={{ marginTop: 24, borderColor: 'var(--c-red, #dc2626)' }}
    >
      <div className="data-panel-header" style={{ borderColor: 'var(--c-red, #dc2626)' }}>
        <span className="data-panel-title" style={{ color: 'var(--c-red, #dc2626)' }}>
          Danger zone
        </span>
      </div>

      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {canAbandon && (
          <AbandonPanel
            inspectionId={inspectionId}
            projectId={projectId}
          />
        )}

        {canDelete && (
          <DeletePanel
            inspectionId={inspectionId}
            projectId={projectId}
            onDeleted={() => {
              router.replace(`/projects/${projectId}/inspections`)
              router.refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}

// ─── AbandonPanel ────────────────────────────────────────────────────────

function AbandonPanel({
  inspectionId,
  projectId,
}: {
  inspectionId: string
  projectId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const canSubmit = reason.trim().length > 0 && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await abandonInspectionAction(inspectionId, projectId, reason)
      if (res.ok) {
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div>
      {!open ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
            Mark this inspection as abandoned. It will be closed with a reason on record.
            Responses and photos are preserved for audit purposes.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Abandon inspection…
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="ob-label" htmlFor="abandonReason">
              Reason for abandoning <span style={{ color: 'var(--c-red, #dc2626)' }}>*</span>
            </label>
            <textarea
              id="abandonReason"
              className="ob-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Scope changed — inspection superseded by revised assignment"
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              isLoading={pending}
              disabled={!canSubmit}
            >
              Confirm abandon
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setReason('')
                setError(null)
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── DeletePanel ─────────────────────────────────────────────────────────

function DeletePanel({
  inspectionId,
  projectId,
  onDeleted,
}: {
  inspectionId: string
  projectId: string
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const expectedText = `delete-inspection-${inspectionId.slice(0, 8)}`
  const matches = confirmText === expectedText
  const canSubmit = matches && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await deleteInspectionAction(inspectionId, projectId, confirmText)
      if (res.ok) {
        onDeleted()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--c-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 8,
          cursor: 'pointer',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Advanced (owner only)
      </p>

      {open && (
        <>
          {!open ? null : !confirmText && !error ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Permanently delete this inspection, all responses, photos, signatures and
                certificates. This cannot be undone. Certified inspections cannot be deleted.
              </p>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => setOpen(true)}
              >
                Delete inspection…
              </Button>
            </>
          ) : null}

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 0 }}>
              Permanently delete this inspection, all responses, photos, signatures and
              certificates. This cannot be undone. Type{' '}
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  background: 'var(--c-panel)',
                  padding: '1px 4px',
                  borderRadius: 3,
                }}
              >
                {expectedText}
              </code>{' '}
              to confirm.
            </p>
            <div>
              <label className="ob-label" htmlFor="confirmDeleteInspection">
                Confirm deletion
              </label>
              <input
                id="confirmDeleteInspection"
                className="ob-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={expectedText}
              />
            </div>

            {error && (
              <p style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button
                type="submit"
                size="sm"
                variant="danger"
                isLoading={pending}
                disabled={!canSubmit}
              >
                Permanently delete inspection
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  setConfirmText('')
                  setError(null)
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              {!matches && confirmText.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Text must match exactly.
                </span>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}
