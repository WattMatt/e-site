'use client'

/**
 * OrderDocSlot — a single document slot on a material-order row.
 *
 * One of three slots per order: Quote, Order Instruction, Shop Drawing.
 * Empty → an upload button. Filled → the file name + view + remove.
 * Upload goes through /api/node-order-documents then attachNodeOrderDocumentAction.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  attachNodeOrderDocumentAction,
  clearNodeOrderDocumentAction,
  getNodeOrderDocumentSignedUrlAction,
} from '@/actions/node-order-document.actions'

export type OrderDocType = 'quote' | 'order_instruction' | 'shop_drawing'

export interface OrderDoc {
  storage_path: string
  file_name: string
}

interface Props {
  projectId: string
  nodeOrderId: string
  docType: OrderDocType
  label: string
  doc: OrderDoc | null
}

export function OrderDocSlot({ projectId, nodeOrderId, docType, label, doc }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeOrderId', nodeOrderId)
      fd.append('docType', docType)
      fd.append('file', file)

      const res = await fetch('/api/node-order-documents', { method: 'POST', body: fd })
      const json = (await res.json()) as { storagePath?: string; fileName?: string; error?: string }
      if (!res.ok || !json.storagePath) {
        throw new Error(json.error ?? `Upload failed (HTTP ${res.status})`)
      }

      const attach = await attachNodeOrderDocumentAction(
        projectId,
        nodeOrderId,
        docType,
        json.storagePath,
        json.fileName ?? file.name,
      )
      if ('error' in attach) {
        // Upload succeeded but the DB attach failed — clean up the orphan.
        await fetch('/api/node-order-documents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: json.storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(attach.error)
      }
      startTransition(() => router.refresh())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleView() {
    if (!doc) return
    setError(null)
    const res = await getNodeOrderDocumentSignedUrlAction(projectId, doc.storage_path)
    if ('error' in res) setError(res.error)
    else window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  async function handleRemove() {
    setError(null)
    setBusy(true)
    try {
      const res = await clearNodeOrderDocumentAction(projectId, nodeOrderId, docType)
      if ('error' in res) throw new Error(res.error)
      startTransition(() => router.refresh())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minHeight: 22 }}>
      <span style={{ color: 'var(--c-text-dim)', minWidth: 84, flexShrink: 0 }}>{label}</span>
      {doc ? (
        <>
          <button
            type="button"
            onClick={handleView}
            title={doc.file_name}
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 4,
              padding: '1px 6px',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              color: 'var(--c-text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            {doc.file_name}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            title="Remove"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 13, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </>
      ) : (
        <label
          style={{
            cursor: busy ? 'default' : 'pointer',
            color: 'var(--c-amber)',
            border: '1px dashed var(--c-border)',
            borderRadius: 4,
            padding: '1px 6px',
          }}
        >
          {busy ? 'Uploading…' : '↑ upload'}
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFile}
            disabled={busy}
          />
        </label>
      )}
      {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
