'use client'

/**
 * TenantDeleteModal — confirmation dialog for permanently deleting a tenant
 * board from the Tenant Schedule. DESTRUCTIVE + irreversible.
 *
 * On mount it calls getTenantDeleteSummaryAction and renders one of:
 *   - a loading state,
 *   - the blocked reason (Cancel only) when an issued cable revision / child
 *     boards prevent the delete, or
 *   - the destruction summary (non-zero counts) + a single "Delete permanently"
 *     danger button (no type-to-confirm, per the spec).
 *
 * On confirm → hardDeleteTenantAction → router.refresh() + onClose(); any error
 * surfaces inline. Mirrors BoardManageModals' DecommissionBoardModal
 * (createPortal + useTransition; all hooks unconditional — React #310 history).
 */

import { useState, useEffect, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  getTenantDeleteSummaryAction,
  hardDeleteTenantAction,
  type TenantDeleteSummary,
} from '@/actions/tenant-delete.actions'

export function TenantDeleteModal({
  projectId,
  nodeId,
  code,
  onClose,
}: {
  projectId: string
  nodeId: string
  code: string
  onClose: () => void
}) {
  const router = useRouter()
  const [summary, setSummary] = useState<TenantDeleteSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, startDelete] = useTransition()

  useEffect(() => {
    let active = true
    getTenantDeleteSummaryAction(projectId, nodeId).then((res) => {
      if (active) setSummary(res)
    })
    return () => {
      active = false
    }
  }, [projectId, nodeId])

  function handleDelete() {
    setError(null)
    startDelete(async () => {
      const result = await hardDeleteTenantAction(projectId, nodeId)
      if ('error' in result) {
        setError(result.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  const blocked = summary !== null && 'blocked' in summary
  const loadError = summary !== null && 'error' in summary ? summary.error : null
  const ok = summary !== null && 'ok' in summary ? summary : null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete tenant ${code}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) onClose() }}
    >
      <div style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        width: '100%',
        maxWidth: 460,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
          Delete {code}
        </h2>

        {summary === null && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
            Checking what will be removed…
          </p>
        )}

        {loadError && (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
              {loadError}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </>
        )}

        {blocked && summary && 'blocked' in summary && (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
              This tenant can’t be deleted yet.
            </p>
            <div style={{
              marginBottom: 16, padding: '10px 12px', borderRadius: 6,
              background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber)',
              fontSize: 13, color: 'var(--c-text)', fontFamily: 'var(--font-sans)', lineHeight: 1.5,
            }}>
              {summary.reason}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}

        {ok && (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
              This permanently deletes the tenant board and everything under it. This cannot be undone.
            </p>

            <DestructionSummary counts={ok.counts} />

            {ok.counts.inspectionsTargeting > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
                {ok.counts.inspectionsTargeting} inspection{ok.counts.inspectionsTargeting === 1 ? '' : 's'} targeting this
                tenant will be kept but lose their target.
              </p>
            )}

            {error && (
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isDeleting}>
                Cancel
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={handleDelete} isLoading={isDeleting} disabled={isDeleting}>
                Delete permanently
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Destruction summary — the non-zero counts as a compact list
// ---------------------------------------------------------------------------

function DestructionSummary({ counts }: { counts: import('@/actions/tenant-delete.actions').TenantDeleteCounts }) {
  const items: string[] = []
  const add = (n: number, singular: string, plural = `${singular}s`) => {
    if (n > 0) items.push(`${n} ${n === 1 ? singular : plural}`)
  }
  add(counts.scopeItems, 'scope item')
  add(counts.documents, 'document')
  add(counts.documentRevisions, 'document revision')
  add(counts.units, 'unit')
  add(counts.orders, 'order')
  add(counts.shopDrawings, 'shop drawing')
  add(counts.orderDocuments, 'order document')
  add(counts.cableSupplies, 'cable connection')
  add(counts.storageFiles, 'stored file')

  if (items.length === 0) {
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 6,
        background: 'var(--c-red-dim)', border: '1px solid #6b1e1e',
        fontSize: 13, color: 'var(--c-text)', fontFamily: 'var(--font-sans)',
      }}>
        No linked records — just the tenant board itself.
      </div>
    )
  }

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6,
      background: 'var(--c-red-dim)', border: '1px solid #6b1e1e',
    }}>
      <p style={{ margin: '0 0 6px', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-red)' }}>
        Will be permanently deleted
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--c-text)', fontFamily: 'var(--font-sans)', lineHeight: 1.6 }}>
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </div>
  )
}
