'use client'

/**
 * Recycle-bin buttons for the Tenant Schedule.
 *
 *   - TenantRecycleButton — the active-row "Delete": a two-step inline confirm
 *     (Safari suppresses window.confirm — see the photo-delete lesson) that
 *     moves the tenant to the recycle bin via softDeleteTenantAction. NO
 *     type-to-confirm — the action is reversible.
 *   - TenantRestoreButton — the recycle-bin "Restore": one click → restoreTenantAction.
 *
 * Both surface any action error inline and router.refresh() on success. The
 * irreversible "Delete permanently" stays on TenantDeleteModal (type-to-confirm).
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { softDeleteTenantAction, restoreTenantAction } from '@/actions/tenant-delete.actions'

export function TenantRecycleButton({
  projectId,
  nodeId,
  code,
}: {
  projectId: string
  nodeId: string
  code: string
}) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function arm() {
    setArmed(true)
    setError('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }

  async function commit() {
    if (timer.current) clearTimeout(timer.current)
    setBusy(true)
    setError('')
    const res = await softDeleteTenantAction(projectId, nodeId)
    if ('error' in res) {
      setError(res.error)
      setBusy(false)
      setArmed(false)
      return
    }
    router.refresh()
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 11, maxWidth: 200 }}>{error}</span>}
      <button
        type="button"
        onClick={armed ? commit : arm}
        disabled={busy}
        title={`Move ${code} to the recycle bin`}
        style={{
          background: armed ? 'var(--c-red)' : 'none',
          color: armed ? '#fff' : 'var(--c-red)',
          border: '1px solid var(--c-red)',
          borderRadius: 5,
          cursor: busy ? 'wait' : 'pointer',
          padding: '4px 10px',
          fontSize: 11,
          fontWeight: 600,
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Removing…' : armed ? 'Confirm?' : 'Delete'}
      </button>
    </span>
  )
}

export function TenantRestoreButton({
  projectId,
  nodeId,
}: {
  projectId: string
  nodeId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function restore() {
    setBusy(true)
    setError('')
    const res = await restoreTenantAction(projectId, nodeId)
    if ('error' in res) {
      setError(res.error)
      setBusy(false)
      return
    }
    router.refresh()
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 11, maxWidth: 200 }}>{error}</span>}
      <button
        type="button"
        onClick={restore}
        disabled={busy}
        style={{
          background: 'none',
          color: 'var(--c-green)',
          border: '1px solid var(--c-border)',
          borderRadius: 5,
          cursor: busy ? 'wait' : 'pointer',
          padding: '4px 10px',
          fontSize: 11,
          fontWeight: 600,
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
    </span>
  )
}
