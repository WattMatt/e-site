'use client'

/**
 * TenantDocumentList — documents list for a single (kind, node) pair.
 *
 * - Renders documents in their given order (no drag-drop; reorder not in scope)
 * - Each row: title · current rev label + issued date · revision-count badge
 * - "Revisions" button opens DocumentRevisionDrawer for that document
 * - When not readOnly: rename, delete-document (with confirm), + Add drawing form
 * - Add drawing: title input + file → upload route → createTenantDocumentAction (optimistic)
 *
 * Mirrors the upload-then-attach-then-rollback pattern from ScopeOfWorkPanel.
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import {
  listTenantDocumentsAction,
  createTenantDocumentAction,
  renameTenantDocumentAction,
  deleteTenantDocumentAction,
  type TenantDocument,
  type TenantDocumentKind,
} from '@/actions/tenant-documents.actions'
import { DocumentRevisionDrawer } from './DocumentRevisionDrawer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  kind: TenantDocumentKind
  projectId: string
  nodeId: string
  readOnly: boolean
  initialDocuments?: TenantDocument[]
}

// ---------------------------------------------------------------------------
// TenantDocumentList
// ---------------------------------------------------------------------------

export function TenantDocumentList({
  kind,
  projectId,
  nodeId,
  readOnly,
  initialDocuments,
}: Props) {
  const [documents, setDocuments] = useState<TenantDocument[]>(initialDocuments ?? [])
  const [isLoading, setIsLoading] = useState(initialDocuments === undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Drawer state
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // Add-drawing form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newFile, setNewFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Rename state: documentId → draft title
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  // Delete-document confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Load on mount when initialDocuments not provided ─────────────────────

  useEffect(() => {
    if (initialDocuments !== undefined) return
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      const res = await listTenantDocumentsAction(projectId, nodeId)
      if (cancelled) return
      if ('error' in res) {
        setLoadError(res.error)
      } else {
        setDocuments(res.documents)
      }
      setIsLoading(false)
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, nodeId])

  // ── Refresh helper (called by drawer after mutations) ─────────────────────

  async function refresh() {
    const res = await listTenantDocumentsAction(projectId, nodeId)
    if ('error' in res) return
    setDocuments(res.documents)
    // Keep the active drawer pointing at the updated document
    if (activeDocId) {
      const updated = res.documents.find((d) => d.id === activeDocId)
      if (!updated) setActiveDocId(null)
    }
  }

  // ── Add drawing ───────────────────────────────────────────────────────────

  async function handleAddDrawingSubmit() {
    if (!newFile || !newTitle.trim()) return
    setAddError(null)
    setIsUploading(true)

    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeId', nodeId)
      fd.append('file', newFile)
      fd.append('kind', kind)

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

      const res = await createTenantDocumentAction(projectId, nodeId, kind, newTitle.trim(), {
        storagePath,
        fileName: filename,
        revLabel: 'Rev A',
      })

      if ('error' in res) {
        // Best-effort orphan cleanup
        await fetch('/api/tenant-schedule/upload-scope-document', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(res.error)
      }

      // Optimistic: add a synthetic document row so the user sees immediate feedback.
      // The real row (with correct sort_order) loads on next refresh.
      const optimisticDoc: TenantDocument = {
        id: res.documentId,
        node_id: nodeId,
        kind,
        title: newTitle.trim(),
        sort_order: documents.length,
        revisions: [
          {
            id: crypto.randomUUID(),
            tenant_document_id: res.documentId,
            rev_label: 'Rev A',
            storage_path: storagePath,
            file_name: filename,
            note: null,
            issued_at: new Date().toISOString(),
            uploaded_by: null,
            created_at: new Date().toISOString(),
          },
        ],
      }
      setDocuments((prev) => [...prev, optimisticDoc])

      // Reset form
      setNewTitle('')
      setNewFile(null)
      setShowAddForm(false)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  async function handleRenameSubmit(docId: string) {
    if (!renameDraft.trim()) return
    setIsRenaming(true)
    setRenameError(null)
    const res = await renameTenantDocumentAction(projectId, docId, renameDraft.trim())
    setIsRenaming(false)
    if ('error' in res) {
      setRenameError(res.error)
      return
    }
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, title: renameDraft.trim() } : d)),
    )
    setRenameId(null)
  }

  // ── Delete document ───────────────────────────────────────────────────────

  async function handleDeleteDocument(docId: string) {
    setDeleteError(null)
    setIsDeletingId(docId)
    const snapshot = documents
    setDocuments((prev) => prev.filter((d) => d.id !== docId))
    const res = await deleteTenantDocumentAction(projectId, docId)
    setIsDeletingId(null)
    setConfirmDeleteId(null)
    if ('error' in res) {
      setDeleteError(res.error)
      setDocuments(snapshot)
    }
    if (activeDocId === docId) setActiveDocId(null)
  }

  // ── Active document (for drawer) ──────────────────────────────────────────

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--c-text-dim)' }}>
        Loading documents…
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--c-red)' }}>
        Failed to load documents: {loadError}
      </div>
    )
  }

  return (
    <>
      <div>
        {/* Error banners */}
        {deleteError && (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 12px',
              background: 'var(--c-red-dim)',
              border: '1px solid var(--c-red)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--c-red)',
            }}
          >
            {deleteError}
          </div>
        )}
        {renameError && (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 12px',
              background: 'var(--c-red-dim)',
              border: '1px solid var(--c-red)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--c-red)',
            }}
          >
            {renameError}
          </div>
        )}

        {/* Empty state */}
        {documents.length === 0 && !showAddForm && (
          <div style={{ fontSize: 13, color: 'var(--c-text-dim)', fontStyle: 'italic', marginBottom: 12 }}>
            No drawings yet.
          </div>
        )}

        {/* Document rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((doc) => {
            const currentRev = doc.revisions[0] ?? null
            const revCount = doc.revisions.length
            const isConfirmingDelete = confirmDeleteId === doc.id

            return (
              <div
                key={doc.id}
                style={{
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 8,
                  padding: '10px 14px',
                }}
              >
                {renameId === doc.id ? (
                  /* Inline rename form */
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                      style={{
                        flex: 1,
                        minWidth: 120,
                        padding: '5px 10px',
                        fontSize: 13,
                        borderRadius: 5,
                        border: '1px solid var(--c-border)',
                        background: 'var(--c-bg)',
                        color: 'var(--c-text)',
                      }}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRenameSubmit(doc.id)}
                      disabled={!renameDraft.trim() || isRenaming}
                      isLoading={isRenaming}
                      style={{ fontSize: 11 }}
                    >
                      Save
                    </Button>
                    <button
                      onClick={() => setRenameId(null)}
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
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Title */}
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text)', flex: 1, minWidth: 100 }}>
                      {doc.title}
                    </div>

                    {/* Current rev label */}
                    {currentRev && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--c-amber)',
                          background: 'var(--c-amber-dim)',
                          borderRadius: 4,
                          padding: '2px 7px',
                        }}
                      >
                        {currentRev.rev_label}
                      </span>
                    )}

                    {/* Issued date */}
                    {currentRev && (
                      <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                        {formatDate(currentRev.issued_at)}
                      </span>
                    )}

                    {/* Revision count badge */}
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--c-text-dim)',
                        background: 'var(--c-panel)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 4,
                        padding: '1px 6px',
                      }}
                    >
                      {revCount === 1 ? '1 revision' : `${revCount} revisions`}
                    </span>

                    {/* Actions */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveDocId(doc.id)}
                      style={{ fontSize: 11 }}
                    >
                      Revisions
                    </Button>

                    {!readOnly && (
                      <>
                        <button
                          onClick={() => {
                            setRenameId(doc.id)
                            setRenameDraft(doc.title)
                            setRenameError(null)
                          }}
                          aria-label={`Rename ${doc.title}`}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: 'var(--c-text-dim)',
                            padding: '2px 4px',
                          }}
                        >
                          Rename
                        </button>

                        {isConfirmingDelete ? (
                          <>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeleteDocument(doc.id)}
                              isLoading={isDeletingId === doc.id}
                              style={{ fontSize: 11 }}
                            >
                              Confirm
                            </Button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
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
                            onClick={() => setConfirmDeleteId(doc.id)}
                            aria-label={`Delete ${doc.title}`}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 11,
                              color: 'var(--c-text-dim)',
                              padding: '2px 4px',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add drawing */}
        {!readOnly && (
          <div style={{ marginTop: 12 }}>
            {showAddForm ? (
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
                  Add Drawing
                </div>

                {/* Title */}
                <div style={{ marginBottom: 10 }}>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Drawing title"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      fontSize: 13,
                      borderRadius: 5,
                      border: '1px solid var(--c-border)',
                      background: 'var(--c-bg)',
                      color: 'var(--c-text)',
                      boxSizing: 'border-box',
                    }}
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
                      cursor: isUploading ? 'default' : 'pointer',
                      fontSize: 12,
                      color: newFile ? 'var(--c-text)' : 'var(--c-text-mid)',
                    }}
                  >
                    {isUploading ? (
                      <>
                        <svg className="animate-spin" width="12" height="12" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Uploading…
                      </>
                    ) : (
                      newFile ? newFile.name : '↑ Choose file'
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        setNewFile(e.target.files?.[0] ?? null)
                        setAddError(null)
                      }}
                      disabled={isUploading}
                      data-testid="add-drawing-file-input"
                    />
                  </label>
                </div>

                {addError && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--c-red)' }}>
                    {addError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAddDrawingSubmit}
                    disabled={!newFile || !newTitle.trim() || isUploading}
                    isLoading={isUploading}
                    style={{ fontSize: 11 }}
                  >
                    Upload
                  </Button>
                  <button
                    onClick={() => {
                      setShowAddForm(false)
                      setNewTitle('')
                      setNewFile(null)
                      setAddError(null)
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
                  setAddError(null)
                  setShowAddForm(true)
                }}
                style={{ fontSize: 12 }}
              >
                + Add drawing
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Revision drawer */}
      {activeDoc && (
        <DocumentRevisionDrawer
          document={activeDoc}
          projectId={projectId}
          readOnly={readOnly}
          onClose={() => setActiveDocId(null)}
          onChanged={refresh}
        />
      )}
    </>
  )
}
