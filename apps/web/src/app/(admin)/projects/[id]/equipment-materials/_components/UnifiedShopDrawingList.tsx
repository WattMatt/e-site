'use client'

/**
 * UnifiedShopDrawingList — the multi shop-drawing control on an Equipment &
 * Materials procurement line.
 *
 * Copy of the Materials tab's ShopDrawingList, with one change for D10: the
 * filename click opens an in-app DocumentPreviewModal instead of a new browser
 * tab. All status/upload/handover logic is reused verbatim from the existing
 * node-order-shop-drawing actions.
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
import { triggerDownload } from '@/lib/file-open'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { ShopDrawing, ShopDrawingStatus } from '@/app/(admin)/projects/[id]/materials/_components/ShopDrawingList'

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

export function UnifiedShopDrawingList({
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
  const [preview, setPreview] = useState<ShopDrawing | null>(null)
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

  async function handleDownload(d: ShopDrawing) {
    setError(null)
    const res = await getShopDrawingSignedUrlAction(projectId, d.storage_path, d.file_name)
    if ('error' in res) setError(res.error)
    else triggerDownload(res.url)
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
            onClick={() => setPreview(d)}
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
          <button type="button" onClick={() => handleDownload(d)} disabled={busy} title="Download" style={linkBtn}>
            ↓
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

      {preview && (
        <DocumentPreviewModal
          fileName={preview.file_name}
          fetchUrl={(download) =>
            getShopDrawingSignedUrlAction(projectId, preview.storage_path, download ? preview.file_name : undefined)
          }
          onClose={() => setPreview(null)}
        />
      )}
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
