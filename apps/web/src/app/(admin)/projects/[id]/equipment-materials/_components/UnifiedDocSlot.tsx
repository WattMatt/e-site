'use client'

/**
 * UnifiedDocSlot — a single document slot (Quote / Order Instruction) on an
 * Equipment & Materials procurement line.
 *
 * Copy of the Materials tab's OrderDocSlot, with one change for D10: the
 * filename click opens an in-app DocumentPreviewModal instead of a new browser
 * tab (the new-tab `previewViaSignedUrl` is replaced by the modal here).
 *
 * Empty → an upload button. Filled → the file name (modal preview) + download +
 * remove. Upload goes through /api/node-order-documents then
 * attachNodeOrderDocumentAction.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  attachNodeOrderDocumentAction,
  clearNodeOrderDocumentAction,
  getNodeOrderDocumentSignedUrlAction,
} from '@/actions/node-order-document.actions'
import { triggerDownload } from '@/lib/file-open'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { OrderDoc } from '@/app/(admin)/projects/[id]/equipment-materials/_lib/order-types'

export type OrderDocType = 'quote' | 'order_instruction'

interface Props {
  projectId: string
  nodeOrderId: string
  docType: OrderDocType
  label: string
  doc: OrderDoc | null
}

export function UnifiedDocSlot({ projectId, nodeOrderId, docType, label, doc }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
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

  async function handleDownload() {
    if (!doc) return
    setError(null)
    const res = await getNodeOrderDocumentSignedUrlAction(projectId, doc.storage_path, doc.file_name)
    if ('error' in res) setError(res.error)
    else triggerDownload(res.url)
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
            onClick={() => setPreviewing(true)}
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
            onClick={handleDownload}
            title="Download"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-mid)', fontSize: 13, lineHeight: 1, padding: 0 }}
          >
            ↓
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
          {previewing && (
            <DocumentPreviewModal
              fileName={doc.file_name}
              fetchUrl={(download) =>
                getNodeOrderDocumentSignedUrlAction(
                  projectId,
                  doc.storage_path,
                  download ? doc.file_name : undefined,
                )
              }
              onClose={() => setPreviewing(false)}
            />
          )}
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
