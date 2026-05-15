'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteProjectAction } from '@/actions/project.actions'

/**
 * Danger-zone panel rendered at the bottom of the project detail page.
 * Owner-only (parent server component decides visibility via the `isOwner`
 * prop sourced from user_organisations.role).
 *
 * Type-to-confirm pattern mirrors DeleteAccountForm. The server action
 * re-validates everything (auth, role, name match) so the client gate is
 * UX-only — server is the canonical truth.
 */
export function DeleteProjectPanel({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const router = useRouter()
  const [confirmName, setConfirmName] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const matches = confirmName.trim() === projectName.trim()
  const canSubmit = matches && !pending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await deleteProjectAction(projectId, confirmName)
      if ('ok' in res) {
        router.replace('/projects')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

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

      <div style={{ padding: '14px 18px' }}>
        {!open ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
              Permanently delete this project and everything linked to it: snags,
              RFIs, diary entries, floor-plan markups, schedule items, procurement
              records, shop drawings, goods-received notes and supplier invoices.
              This cannot be undone.
            </p>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => setOpen(true)}
            >
              Delete project…
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 0 }}>
              Type <strong>{projectName}</strong> below to confirm. Every snag, RFI,
              diary entry, markup, schedule, procurement row, GRN and supplier
              invoice attached to this project will be deleted irreversibly.
            </p>
            <div>
              <label className="ob-label" htmlFor="confirmProjectName">
                Project name
              </label>
              <input
                id="confirmProjectName"
                className="ob-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={projectName}
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
                Permanently delete project
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  setConfirmName('')
                  setError(null)
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              {!matches && confirmName.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Name must match exactly.
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
