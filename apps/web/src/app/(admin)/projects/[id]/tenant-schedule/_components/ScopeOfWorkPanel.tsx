'use client'

/**
 * ScopeOfWorkPanel — per-tenant scope-of-work editor.
 *
 * Renders:
 *   1. Scope status toggle (awaited / received) with document upload on "received"
 *   2. Per-scope-item Landlord / Tenant radio grid
 *
 * This is an "inline expand" panel — ScheduleTable renders it in a full-width
 * row below the tenant row when the user clicks the scope edit button.
 */

import { useState, useTransition, useRef } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  setScopeItemPartyAction,
  setScopeStatusAction,
  attachScopeDocumentAction,
  clearScopeDocumentAction,
  getScopeSignedUrlAction,
} from '@/actions/tenant-scope.actions'

// ---------------------------------------------------------------------------
// Types (local — structure schema isn't in generated DB types yet)
// ---------------------------------------------------------------------------

export interface ScopeItemType {
  id: string
  key: string
  label: string
  sort_order: number
}

export interface TenantScopeItem {
  id: string
  node_id: string
  scope_item_type_id: string
  party: 'landlord' | 'tenant'
}

export interface TenantDetails {
  node_id: string
  scope_status: 'awaited' | 'received'
  scope_document_path: string | null
}

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  scopeItemTypes: ScopeItemType[]
  scopeItems: TenantScopeItem[]
  tenantDetails: TenantDetails | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// ScopeOfWorkPanel
// ---------------------------------------------------------------------------

export function ScopeOfWorkPanel({
  projectId,
  nodeId,
  shopName,
  scopeItemTypes,
  scopeItems: initialScopeItems,
  tenantDetails: initialDetails,
  onClose,
}: Props) {
  const [scopeItems, setScopeItems] = useState<TenantScopeItem[]>(initialScopeItems)
  const [details, setDetails] = useState<TenantDetails>(
    initialDetails ?? { node_id: nodeId, scope_status: 'awaited', scope_document_path: null },
  )
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Scope item party toggle ───────────────────────────────────────────────

  function currentParty(typeId: string): 'landlord' | 'tenant' | null {
    return scopeItems.find((s) => s.scope_item_type_id === typeId)?.party ?? null
  }

  function handlePartyChange(typeId: string, party: 'landlord' | 'tenant') {
    setError(null)
    // Optimistic update
    setScopeItems((prev) => {
      const exists = prev.find((s) => s.scope_item_type_id === typeId)
      if (exists) {
        return prev.map((s) => (s.scope_item_type_id === typeId ? { ...s, party } : s))
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), node_id: nodeId, scope_item_type_id: typeId, party },
      ]
    })

    startTransition(async () => {
      const res = await setScopeItemPartyAction(projectId, nodeId, typeId, party)
      if ('error' in res) {
        setError(res.error)
        // Revert optimistic update on failure
        setScopeItems(initialScopeItems)
      }
    })
  }

  // ── Scope status toggle ───────────────────────────────────────────────────

  function handleStatusChange(status: 'awaited' | 'received') {
    setError(null)
    setDetails((d) => ({ ...d, scope_status: status }))
    startTransition(async () => {
      const res = await setScopeStatusAction(projectId, nodeId, status)
      if ('error' in res) {
        setError(res.error)
        setDetails((d) => ({
          ...d,
          scope_status: status === 'awaited' ? 'received' : 'awaited',
        }))
      }
    })
  }

  // ── Document upload ───────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setSignedUrl(null)
    setIsUploading(true)

    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeId', nodeId)
      fd.append('file', file)

      const res = await fetch('/api/tenant-schedule/upload-scope-document', {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`)
      }

      const { storagePath } = (await res.json()) as { storagePath: string }

      // Persist path to DB and flip status to received
      const attach = await attachScopeDocumentAction(projectId, nodeId, storagePath)
      if ('error' in attach) throw new Error(attach.error)

      setDetails((d) => ({ ...d, scope_document_path: storagePath, scope_status: 'received' }))
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemoveDocument() {
    if (!details.scope_document_path) return
    setSignedUrl(null)
    const path = details.scope_document_path
    setDetails((d) => ({ ...d, scope_document_path: null }))
    const res = await clearScopeDocumentAction(projectId, nodeId, path)
    if ('error' in res) {
      setError(res.error)
      setDetails((d) => ({ ...d, scope_document_path: path }))
    }
  }

  async function handlePreview() {
    if (!details.scope_document_path) return
    setIsLoadingUrl(true)
    const res = await getScopeSignedUrlAction(projectId, details.scope_document_path)
    setIsLoadingUrl(false)
    if ('error' in res) {
      setUploadError(res.error)
    } else {
      setSignedUrl(res.url)
      window.open(res.url, '_blank', 'noopener,noreferrer')
    }
  }

  // ── Filename display ──────────────────────────────────────────────────────

  const documentFilename = details.scope_document_path
    ? details.scope_document_path.split('/').pop()?.replace(/^\d+-/, '') ?? 'document'
    : null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--c-bg)',
        borderTop: '1px solid var(--c-border)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginRight: 8,
            }}
          >
            Scope of Work
          </span>
          {shopName && (
            <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{shopName}</span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-text-dim)',
            fontSize: 18,
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label="Close scope panel"
        >
          ×
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--c-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Section 1: Scope status + document ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        {/* Status toggle */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Scope Status
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['awaited', 'received'] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={isPending}
                style={{
                  padding: '5px 12px',
                  borderRadius: 5,
                  border: '1px solid',
                  cursor: isPending ? 'default' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  background:
                    details.scope_status === s
                      ? s === 'received'
                        ? 'var(--c-green-dim)'
                        : 'var(--c-amber-dim, rgba(245,158,11,0.15))'
                      : 'var(--c-panel)',
                  borderColor:
                    details.scope_status === s
                      ? s === 'received'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-border)',
                  color:
                    details.scope_status === s
                      ? s === 'received'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-text-dim)',
                }}
              >
                {s === 'awaited' ? 'Awaited' : 'Received'}
              </button>
            ))}
          </div>
        </div>

        {/* Document upload */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Scope Document
          </div>

          {details.scope_document_path ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--c-text)',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 4,
                  padding: '3px 8px',
                  maxWidth: 260,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={documentFilename ?? undefined}
              >
                {documentFilename}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePreview}
                isLoading={isLoadingUrl}
                style={{ fontSize: 11 }}
              >
                Preview / Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveDocument}
                style={{ fontSize: 11, color: 'var(--c-red)' }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-panel)',
                  cursor: isUploading ? 'default' : 'pointer',
                  fontSize: 12,
                  color: 'var(--c-text-mid)',
                  transition: 'border-color 0.15s',
                }}
              >
                {isUploading ? (
                  <>
                    <svg
                      className="animate-spin"
                      width="13"
                      height="13"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Uploading…
                  </>
                ) : (
                  <>↑ Upload scope doc (.xlsx / .pdf)</>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </label>
            </div>
          )}

          {uploadError && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-red)' }}>{uploadError}</div>
          )}
          {signedUrl && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--c-text-dim)' }}>
              URL expires in 5 minutes.{' '}
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--c-amber)' }}
              >
                Open again
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Landlord / Tenant scope grid ── */}
      {scopeItemTypes.length > 0 && (
        <div>
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
            Scope Items
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            {scopeItemTypes.map((type) => {
              const party = currentParty(type.id)
              return (
                <div
                  key={type.id}
                  style={{
                    background: 'var(--c-panel)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 12,
                      color: 'var(--c-text)',
                      marginBottom: 8,
                    }}
                  >
                    {type.label}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['landlord', 'tenant'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePartyChange(type.id, p)}
                        disabled={isPending}
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          borderRadius: 4,
                          border: '1px solid',
                          cursor: isPending ? 'default' : 'pointer',
                          fontSize: 11,
                          fontWeight: 600,
                          transition: 'all 0.15s',
                          background:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue-dim, rgba(59,130,246,0.15))'
                                : 'var(--c-amber-dim, rgba(245,158,11,0.15))'
                              : 'transparent',
                          borderColor:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue, #3b82f6)'
                                : 'var(--c-amber)'
                              : 'var(--c-border)',
                          color:
                            party === p
                              ? p === 'landlord'
                                ? 'var(--c-blue, #3b82f6)'
                                : 'var(--c-amber)'
                              : 'var(--c-text-dim)',
                        }}
                      >
                        {p === 'landlord' ? 'LL' : 'T'}
                      </button>
                    ))}
                  </div>
                  {party && (
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {party === 'landlord' ? 'Landlord scope' : 'By Tenant'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {scopeItemTypes.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
          No scope item types defined for this organisation yet.
        </div>
      )}
    </div>
  )
}
