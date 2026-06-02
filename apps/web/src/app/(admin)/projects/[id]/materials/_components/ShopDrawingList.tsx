'use client'

/**
 * ShopDrawingList — the multi shop-drawing control on a material-order row.
 *
 * Lists each drawing with a status chip (Awaiting/Received/Approved), advances
 * status, and uploads new drawings. Upload reuses the /api/node-order-documents
 * POST (docType='shop_drawing'); the DB row is then recorded via
 * addShopDrawingAction. Approving an unmapped item type prompts for a handover
 * category inline.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { CATEGORY_LABELS, ALL_CATEGORIES, type HandoverCategory } from '@esite/shared'
import {
  addShopDrawingAction,
  markShopDrawingReceivedAction,
  approveShopDrawingAction,
  revertShopDrawingAction,
  removeShopDrawingAction,
  getShopDrawingSignedUrlAction,
} from '@/actions/node-order-shop-drawing.actions'

export type ShopDrawingStatus = 'awaiting' | 'received' | 'approved'

export interface ShopDrawing {
  id: string
  file_name: string
  storage_path: string
  status: ShopDrawingStatus
  handover_category: HandoverCategory | null
}

const STATUS_VARIANT: Record<ShopDrawingStatus, 'warning' | 'info' | 'success'> = {
  awaiting: 'warning',
  received: 'info',
  approved: 'success',
}
const STATUS_LABEL: Record<ShopDrawingStatus, string> = {
  awaiting: 'Awaiting',
  received: 'Received',
  approved: 'Approved',
}

export function ShopDrawingList({
  projectId,
  nodeOrderId,
  drawings,
}: {
  projectId: string
  nodeOrderId: string
  drawings: ShopDrawing[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeOrderId', nodeOrderId)
      fd.append('docType', 'shop_drawing')
      fd.append('file', file)
      const res = await fetch('/api/node-order-documents', { method: 'POST', body: fd })
      const json = (await res.json()) as { storagePath?: string; fileName?: string; error?: string }
      if (!res.ok || !json.storagePath) throw new Error(json.error ?? `Upload failed (HTTP ${res.status})`)

      const add = await addShopDrawingAction(projectId, nodeOrderId, json.storagePath, json.fileName ?? file.name)
      if ('error' in add) {
        await fetch('/api/node-order-documents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: json.storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(add.error)
      }
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runAction<T extends { ok: true } | { error: string } | { needsCategory: true }>(
    fn: () => Promise<T>,
  ): Promise<T | null> {
    setError(null)
    setBusy(true)
    try {
      const res = await fn()
      if ('error' in res) {
        setError(res.error)
        return null
      }
      return res
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleView(d: ShopDrawing) {
    setError(null)
    const res = await getShopDrawingSignedUrlAction(projectId, d.storage_path)
    if ('error' in res) setError(res.error)
    else window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  async function handleAdvance(d: ShopDrawing) {
    if (d.status === 'awaiting') {
      await runAction(() => markShopDrawingReceivedAction(projectId, d.id))
      refresh()
    } else if (d.status === 'received') {
      const res = await runAction(() => approveShopDrawingAction(projectId, d.id))
      if (res && 'needsCategory' in res) {
        setPickFor(d.id)
      } else if (res) {
        refresh()
      }
    }
  }

  async function handlePickCategory(drawingId: string, category: HandoverCategory) {
    const res = await runAction(() => approveShopDrawingAction(projectId, drawingId, category))
    if (res && 'ok' in res) {
      setPickFor(null)
      refresh()
    }
  }

  async function handleRevert(d: ShopDrawing) {
    await runAction(() => revertShopDrawingAction(projectId, d.id))
    refresh()
  }

  async function handleRemove(d: ShopDrawing) {
    await runAction(() => removeShopDrawingAction(projectId, d.id))
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, minWidth: 230 }}>
      <span style={{ color: 'var(--c-text-dim)' }}>Shop drawings</span>

      {drawings.length === 0 && <span style={{ color: 'var(--c-text-dim)' }}>—</span>}

      {drawings.map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleView(d)}
            title={d.file_name}
            style={{
              maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)', color: 'var(--c-text)',
              background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
              padding: '1px 6px', cursor: 'pointer',
            }}
          >
            {d.file_name}
          </button>
          <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABEL[d.status]}</Badge>

          {d.status !== 'approved' && (
            <button
              type="button"
              onClick={() => handleAdvance(d)}
              disabled={busy}
              style={advanceBtn}
            >
              {d.status === 'awaiting' ? 'Mark received' : 'Mark approved'}
            </button>
          )}
          {d.status === 'approved' && d.handover_category && (
            <span style={{ color: 'var(--c-green)' }}>
              Filed › {CATEGORY_LABELS[d.handover_category]}
            </span>
          )}
          {d.status !== 'awaiting' && (
            <button type="button" onClick={() => handleRevert(d)} disabled={busy} title="Step status back" style={linkBtn}>
              ↩
            </button>
          )}
          <button type="button" onClick={() => handleRemove(d)} disabled={busy} title="Remove" style={removeBtn}>
            ×
          </button>

          {pickFor === d.id && (
            <select
              autoFocus
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value
                if (v) handlePickCategory(d.id, v as HandoverCategory)
              }}
              style={{ fontSize: 11, padding: '1px 4px' }}
            >
              <option value="" disabled>
                Pick handover category…
              </option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}

      <label style={{ cursor: busy ? 'default' : 'pointer', color: 'var(--c-amber)', border: '1px dashed var(--c-border)', borderRadius: 4, padding: '1px 6px', alignSelf: 'flex-start' }}>
        {busy ? 'Working…' : '+ Add drawing'}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={busy} />
      </label>

      {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}

const advanceBtn: React.CSSProperties = {
  background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
  padding: '1px 6px', cursor: 'pointer', color: 'var(--c-text)', fontSize: 11,
}
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: 0,
}
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 13, lineHeight: 1, padding: 0,
}
