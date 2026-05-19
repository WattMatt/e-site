'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteTemplateAction } from '@/actions/inspections-template.actions'

interface Props {
  /** DB row UUID (inspections.templates.id) */
  id: string
  organisationId: string
  templateId: string
  version: string
  /** Pre-fetched count of inspections referencing this (template_id, version). */
  inspectionCount: number
  /** Where to redirect after successful deletion. Defaults to /settings/inspections/templates */
  redirectTo?: string
}

/**
 * Owner-only danger-zone button for hard-deleting a template version.
 *
 * Shows a blocked state with a count message if any inspections reference
 * the template version. Otherwise renders a type-to-confirm modal.
 */
export default function DeleteTemplateButton({
  id,
  organisationId,
  templateId,
  version,
  inspectionCount,
  redirectTo = '/settings/inspections/templates',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const expectedText = `delete-template-${templateId}-${version}`
  const matches = confirmText === expectedText
  const canSubmit = matches && !pending

  const isBlocked = inspectionCount > 0

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await deleteTemplateAction(id, organisationId, confirmText)
      if (res.ok) {
        router.replace(redirectTo)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setOpen(true)}
        style={{ marginLeft: 8 }}
      >
        Delete
      </Button>
    )
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: '14px 18px',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-red, #dc2626)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {isBlocked ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
            <strong>Deletion blocked.</strong>{' '}
            {inspectionCount} inspection{inspectionCount === 1 ? '' : 's'} reference
            {inspectionCount === 1 ? 's' : ''} this template version. Delete or abandon
            those inspections first, then return here to delete the template.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
            Permanently delete{' '}
            <strong>
              {templateId} v{version}
            </strong>
            . This cannot be undone. Type{' '}
            <code
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                background: 'var(--c-bg)',
                padding: '1px 4px',
                borderRadius: 3,
              }}
            >
              {expectedText}
            </code>{' '}
            to confirm.
          </p>
          <div>
            <label className="ob-label" htmlFor={`confirmDeleteTemplate-${id}`}>
              Confirm deletion
            </label>
            <input
              id={`confirmDeleteTemplate-${id}`}
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
            <p style={{ color: 'var(--c-red, #dc2626)', fontSize: 12, margin: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button
              type="submit"
              size="sm"
              variant="danger"
              isLoading={pending}
              disabled={!canSubmit}
            >
              Permanently delete
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
      )}
    </div>
  )
}
