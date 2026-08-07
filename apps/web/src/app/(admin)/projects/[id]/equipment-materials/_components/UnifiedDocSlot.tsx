'use client'

/**
 * UnifiedDocSlot — a multi-document slot (Quote / Order Instruction) on an
 * Equipment & Materials procurement line.
 *
 * Each slot holds a labelled list of documents (newest first). A document
 * carries a kind (Original / Revision / Variation) and an optional supplier /
 * note label, both editable inline. Upload goes direct to storage via
 * uploadNodeOrderDocumentFile (bucket RLS is the gate) then
 * addNodeOrderDocumentAction; the filename opens an in-app
 * DocumentPreviewModal.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addNodeOrderDocumentAction,
  updateNodeOrderDocumentMetaAction,
  deleteNodeOrderDocumentAction,
  getNodeOrderDocumentSignedUrlAction,
} from '@/actions/node-order-document.actions'
import {
  uploadNodeOrderDocumentFile,
  removeNodeOrderDocumentFile,
} from '@/lib/storage/node-order-documents-upload'
import { triggerDownload } from '@/lib/file-open'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { OrderDoc, OrderDocKind } from '@/app/(admin)/projects/[id]/equipment-materials/_lib/order-types'

export type OrderDocType = 'quote' | 'order_instruction'

const KIND_OPTIONS: { value: OrderDocKind; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'revision', label: 'Revision' },
  { value: 'variation', label: 'Variation' },
]

interface Props {
  projectId: string
  nodeOrderId: string
  docType: OrderDocType
  label: string
  docs: OrderDoc[]
}

export function UnifiedDocSlot({ projectId, nodeOrderId, docType, label, docs }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<OrderDoc | null>(null)
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
      const { storagePath, fileName } = await uploadNodeOrderDocumentFile({
        projectId,
        nodeOrderId,
        docType,
        file,
      })

      const add = await addNodeOrderDocumentAction(projectId, nodeOrderId, docType, storagePath, fileName)
      if ('error' in add) {
        // Best-effort orphan cleanup
        await removeNodeOrderDocumentFile(storagePath)
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

  async function handleDownload(d: OrderDoc) {
    setError(null)
    const res = await getNodeOrderDocumentSignedUrlAction(projectId, d.storage_path, d.file_name)
    if ('error' in res) setError(res.error)
    else triggerDownload(res.url)
  }

  async function handleMeta(d: OrderDoc, next: { label?: string | null; kind?: OrderDocKind }) {
    const label = next.label !== undefined ? next.label : d.label
    const kind = next.kind ?? d.kind
    if (label === d.label && kind === d.kind) return
    setError(null)
    setBusy(true)
    try {
      const res = await updateNodeOrderDocumentMetaAction(projectId, d.id, {
        label: label && label.length > 0 ? label : null,
        kind,
      })
      if ('error' in res) throw new Error(res.error)
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(d: OrderDoc) {
    setError(null)
    setBusy(true)
    try {
      const res = await deleteNodeOrderDocumentAction(projectId, d.id)
      if ('error' in res) throw new Error(res.error)
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
      <span style={{ color: 'var(--c-text-dim)' }}>{label}</span>

      {docs.length === 0 && <span style={{ color: 'var(--c-text-dim)' }}>—</span>}

      {docs.map((d) => (
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
          <select
            value={d.kind}
            disabled={busy}
            onChange={(e) => handleMeta(d, { kind: e.target.value as OrderDocKind })}
            title="Document kind"
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            defaultValue={d.label ?? ''}
            disabled={busy}
            placeholder="Supplier / note"
            onBlur={(e) => handleMeta(d, { label: e.target.value })}
            style={{
              fontSize: 11, padding: '1px 6px', width: 130,
              background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
              color: 'var(--c-text)',
            }}
          />
          <button type="button" onClick={() => handleRemove(d)} disabled={busy} title="Remove" style={removeBtn}>
            ×
          </button>
        </div>
      ))}

      <label style={{ cursor: busy ? 'default' : 'pointer', color: 'var(--c-amber)', border: '1px dashed var(--c-border)', borderRadius: 4, padding: '1px 6px', alignSelf: 'flex-start' }}>
        {busy ? 'Working…' : '+ Add document'}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={busy} />
      </label>

      {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}

      {preview && (
        <DocumentPreviewModal
          fileName={preview.file_name}
          fetchUrl={(download) =>
            getNodeOrderDocumentSignedUrlAction(projectId, preview.storage_path, download ? preview.file_name : undefined)
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: 0,
}
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 13, lineHeight: 1, padding: 0,
}
