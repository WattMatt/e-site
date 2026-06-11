'use client'

/**
 * DocumentRevisionDrawer — side panel showing all revisions for ONE document.
 *
 * - Lists revisions newest-first (passed in via `document.revisions`)
 * - Download: getRevisionSignedUrlAction → window.open
 * - Add revision (hidden when readOnly): upload → addTenantDocumentRevisionAction → onChanged()
 * - Delete revision (hidden when readOnly): deleteTenantDocumentRevisionAction → onChanged()
 */

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import {
  getRevisionSignedUrlAction,
  addTenantDocumentRevisionAction,
  deleteTenantDocumentRevisionAction,
  type TenantDocument,
  type TenantDocumentRevision,
} from '@/actions/tenant-documents.actions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the next alphabetic revision label after the highest existing one. */
function nextRevLabel(revisions: TenantDocumentRevision[]): string {
  if (revisions.length === 0) return 'Rev A'
  // Labels are "Rev A", "Rev B", etc. Grab the highest letter.
  const letters = revisions
    .map((r) => {
      const m = r.rev_label.match(/Rev\s+([A-Z]+)/i)
      return m ? m[1].toUpperCase() : null
    })
    .filter(Boolean) as string[]
  if (letters.length === 0) return 'Rev A'
  // Sort alphabetically (single-letter case) and take the last
  letters.sort()
  const last = letters[letters.length - 1]
  const next = String.fromCharCode(last.charCodeAt(0) + 1)
  return `Rev ${next}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  document: TenantDocument
  projectId: string
  readOnly: boolean
  onClose: () => void
  /** Called after any successful mutation so the parent can refresh the list */
  onChanged: () => void
}

// ---------------------------------------------------------------------------
// DocumentRevisionDrawer
// ---------------------------------------------------------------------------

export function DocumentRevisionDrawer({
  document,
  projectId,
  readOnly,
  onClose,
  onChanged,
}: Props) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const [isAddingRevision, setIsAddingRevision] = useState(false)
  const [revLabel, setRevLabel] = useState<string>(nextRevLabel(document.revisions))
  const [revNote, setRevNote] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [confirmDeleteRevId, setConfirmDeleteRevId] = useState<string | null>(null)
  const [isDeletingRevId, setIsDeletingRevId] = useState<string | null>(null)
  const [deleteRevError, setDeleteRevError] = useState<string | null>(null)

  // Mirrors the upload route's kind validation (scope = PDF/Excel only; layout = any).
  const fileAccept = document.kind === 'scope' ? '.pdf,.xlsx,.xls' : undefined

  // ── Download ──────────────────────────────────────────────────────────────

  async function handleDownload(revision: TenantDocumentRevision) {
    setDownloadingId(revision.id)
    setDownloadError(null)
    const res = await getRevisionSignedUrlAction(projectId, revision.id)
    setDownloadingId(null)
    if ('error' in res) {
      setDownloadError(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  // ── Add revision upload ───────────────────────────────────────────────────

  async function handleAddRevisionSubmit() {
    if (!selectedFile) return
    setUploadError(null)
    setIsUploading(true)

    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeId', document.node_id)
      fd.append('file', selectedFile)
      fd.append('kind', document.kind)

      const uploadRes = await fetch('/api/tenant-schedule/upload-scope-document', {
        method: 'POST',
        body: fd,
      })

      if (!uploadRes.ok) {
        const body = (await uploadRes.json()) as { error?: string }
        throw new Error(body.error ?? `Upload failed (HTTP ${uploadRes.status})`)
      }

      const { storagePath, filename } = (await uploadRes.json()) as {
        storagePath: string
        filename: string
      }

      const attach = await addTenantDocumentRevisionAction(projectId, document.id, {
        storagePath,
        fileName: filename,
        revLabel: revLabel.trim() || nextRevLabel(document.revisions),
        note: revNote.trim() || null,
      })

      if ('error' in attach) {
        // Best-effort orphan cleanup
        await fetch('/api/tenant-schedule/upload-scope-document', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(attach.error)
      }

      setIsAddingRevision(false)
      setSelectedFile(null)
      setRevLabel(nextRevLabel(document.revisions))
      setRevNote('')
      if (fileRef.current) fileRef.current.value = ''
      onChanged()
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // ── Delete revision ───────────────────────────────────────────────────────

  async function handleDeleteRevision(revisionId: string) {
    setDeleteRevError(null)
    setIsDeletingRevId(revisionId)
    const res = await deleteTenantDocumentRevisionAction(projectId, revisionId)
    setIsDeletingRevId(null)
    setConfirmDeleteRevId(null)
    if ('error' in res) {
      setDeleteRevError(res.error)
      return
    }
    onChanged()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        maxWidth: '95vw',
        background: 'var(--c-bg)',
        borderLeft: '1px solid var(--c-border)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.25)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--c-border)',
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 3,
            }}
          >
            Revisions
          </div>
          <div
            style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}
          >
            {document.title}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close revisions drawer"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-text-dim)',
            fontSize: 20,
            lineHeight: 1,
            padding: '2px 8px',
          }}
        >
          ×
        </button>
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* Error banners */}
        {downloadError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)' }}>
            {downloadError}
          </div>
        )}
        {deleteRevError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)' }}>
            {deleteRevError}
          </div>
        )}

        {/* Revision timeline (newest first — already sorted by parent) */}
        {document.revisions.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
            No revisions yet.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {document.revisions.map((rev) => (
            <div
              key={rev.id}
              style={{
                background: 'var(--c-panel)',
                border: '1px solid var(--c-border)',
                borderRadius: 8,
                padding: '12px 14px',
              }}
            >
              {/* Rev label + date */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--c-amber)',
                  }}
                >
                  {rev.rev_label}
                </span>
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  {formatDate(rev.issued_at)}
                </span>
              </div>

              {/* File name */}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--c-text-mid)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: rev.note ? 6 : 0,
                }}
                title={rev.file_name}
              >
                {rev.file_name}
              </div>

              {/* Note */}
              {rev.note && (
                <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginBottom: 4, fontStyle: 'italic' }}>
                  {rev.note}
                </div>
              )}

              {/* Actions row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(rev)}
                  isLoading={downloadingId === rev.id}
                  style={{ fontSize: 11 }}
                >
                  Download
                </Button>

                {!readOnly && (
                  confirmDeleteRevId === rev.id ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteRevision(rev.id)}
                        isLoading={isDeletingRevId === rev.id}
                        style={{ fontSize: 11 }}
                      >
                        Confirm delete
                      </Button>
                      <button
                        onClick={() => setConfirmDeleteRevId(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          color: 'var(--c-text-dim)',
                          padding: '2px 4px',
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteRevId(rev.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11,
                        color: 'var(--c-text-dim)',
                        padding: '2px 4px',
                      }}
                      aria-label={`Delete revision ${rev.rev_label}`}
                    >
                      Delete revision
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add revision */}
        {!readOnly && (
          <div style={{ marginTop: 20 }}>
            {isAddingRevision ? (
              <div
                style={{
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text-dim)',
                    marginBottom: 10,
                  }}
                >
                  Add Revision
                </div>

                {/* Revision label */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'var(--c-text-dim)', display: 'block', marginBottom: 4 }}>
                    Revision label
                  </label>
                  <input
                    value={revLabel}
                    onChange={(e) => setRevLabel(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 5,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-bg)',
                      color: 'var(--c-text)',
                      boxSizing: 'border-box',
                    }}
                    placeholder="Rev B"
                  />
                </div>

                {/* Note */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: 'var(--c-text-dim)', display: 'block', marginBottom: 4 }}>
                    Note (optional)
                  </label>
                  <input
                    value={revNote}
                    onChange={(e) => setRevNote(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 5,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-bg)',
                      color: 'var(--c-text)',
                      boxSizing: 'border-box',
                    }}
                    placeholder="Incorporates landlord comments"
                  />
                </div>

                {/* File picker */}
                <div style={{ marginBottom: 10 }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-bg)',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: selectedFile ? 'var(--c-text)' : 'var(--c-text-mid)',
                    }}
                  >
                    {selectedFile ? selectedFile.name : '↑ Choose file'}
                    <input
                      ref={fileRef}
                      type="file"
                      accept={fileAccept}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        setSelectedFile(e.target.files?.[0] ?? null)
                        setUploadError(null)
                      }}
                      data-testid="add-revision-file-input"
                    />
                  </label>
                </div>

                {uploadError && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--c-red)' }}>
                    {uploadError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAddRevisionSubmit}
                    disabled={!selectedFile || isUploading}
                    isLoading={isUploading}
                    style={{ fontSize: 11 }}
                  >
                    Upload revision
                  </Button>
                  <button
                    onClick={() => {
                      setIsAddingRevision(false)
                      setSelectedFile(null)
                      setUploadError(null)
                      if (fileRef.current) fileRef.current.value = ''
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--c-text-dim)',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRevLabel(nextRevLabel(document.revisions))
                  setIsAddingRevision(true)
                }}
                style={{ fontSize: 12 }}
              >
                + Add revision
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
