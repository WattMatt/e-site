'use client'

/**
 * LayoutIssuedPanel — per-tenant layout-issued editor.
 *
 * Renders:
 *   1. Layout status toggle (not_issued / issued)
 *   2. Issued date input (YYYY-MM-DD)
 *   3. Drawing upload + preview + download
 *
 * This is an "inline expand" panel — ScheduleTable renders it in a full-width
 * row below the tenant row when the user clicks the layout edit button.
 *
 * Mirrors ScopeOfWorkPanel exactly for the layout side of tenant_details.
 */

import { useState, useTransition, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import {
  setLayoutStatusAction,
  attachLayoutDrawingAction,
  clearLayoutDrawingAction,
  getLayoutSignedUrlAction,
} from '@/actions/tenant-scope.actions'

// ---------------------------------------------------------------------------
// Types (re-exported so the page / ScheduleTable can import them)
// ---------------------------------------------------------------------------

export interface LayoutDetails {
  node_id: string
  layout_status: 'not_issued' | 'issued'
  layout_issued_at: string | null   // YYYY-MM-DD date string or null
  layout_drawing_path: string | null
}

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  layoutDetails: LayoutDetails | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// LayoutIssuedPanel
// ---------------------------------------------------------------------------

export function LayoutIssuedPanel({
  projectId,
  nodeId,
  shopName,
  layoutDetails: initialDetails,
  onClose,
}: Props) {
  const [details, setDetails] = useState<LayoutDetails>(
    initialDetails ?? {
      node_id: nodeId,
      layout_status: 'not_issued',
      layout_issued_at: null,
      layout_drawing_path: null,
    },
  )
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Status toggle ─────────────────────────────────────────────────────────

  function handleStatusChange(status: 'not_issued' | 'issued') {
    setError(null)
    const snapshot = details
    // Optimistic: set status + default issuedAt to today when flipping to 'issued'
    const issuedAt =
      status === 'issued' ? (details.layout_issued_at ?? new Date().toISOString().slice(0, 10)) : null
    setDetails((d) => ({ ...d, layout_status: status, layout_issued_at: issuedAt }))
    startTransition(async () => {
      const res = await setLayoutStatusAction(projectId, nodeId, status, issuedAt)
      if ('error' in res) {
        setError(res.error)
        setDetails(snapshot)
      }
    })
  }

  // ── Issued-date change ────────────────────────────────────────────────────

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value || null
    setError(null)
    const snapshot = details
    setDetails((d) => ({ ...d, layout_issued_at: value }))
    startTransition(async () => {
      const res = await setLayoutStatusAction(projectId, nodeId, details.layout_status, value)
      if ('error' in res) {
        setError(res.error)
        setDetails(snapshot)
      }
    })
  }

  // ── Drawing upload ────────────────────────────────────────────────────────

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
      fd.append('kind', 'layout')
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

      // Persist path to DB; also flips status to 'issued' + sets issuedAt if blank
      const attach = await attachLayoutDrawingAction(projectId, nodeId, storagePath)
      if ('error' in attach) {
        // Upload succeeded but DB attach failed — delete the orphaned storage
        // object best-effort so the bucket doesn't accumulate dangling files.
        await fetch('/api/tenant-schedule/upload-scope-document', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(attach.error)
      }

      // Reflect server changes locally (status = issued, date preserved/set)
      const today = new Date().toISOString().slice(0, 10)
      setDetails((d) => ({
        ...d,
        layout_drawing_path: storagePath,
        layout_status: 'issued',
        layout_issued_at: d.layout_issued_at ?? today,
      }))
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemoveDrawing() {
    if (!details.layout_drawing_path) return
    setSignedUrl(null)
    const path = details.layout_drawing_path
    setDetails((d) => ({ ...d, layout_drawing_path: null }))
    const res = await clearLayoutDrawingAction(projectId, nodeId, path)
    if ('error' in res) {
      setError(res.error)
      setDetails((d) => ({ ...d, layout_drawing_path: path }))
    }
  }

  async function handlePreview() {
    if (!details.layout_drawing_path) return
    setIsLoadingUrl(true)
    const res = await getLayoutSignedUrlAction(projectId, details.layout_drawing_path)
    setIsLoadingUrl(false)
    if ('error' in res) {
      setUploadError(res.error)
    } else {
      setSignedUrl(res.url)
      window.open(res.url, '_blank', 'noopener,noreferrer')
    }
  }

  // ── Filename display ──────────────────────────────────────────────────────

  const drawingFilename = details.layout_drawing_path
    ? details.layout_drawing_path.split('/').pop()?.replace(/^\d+-/, '') ?? 'drawing'
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
            Layout Issued
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
          aria-label="Close layout panel"
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

      {/* ── Controls: status + date + drawing ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
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
            Layout Status
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['not_issued', 'issued'] as const).map((s) => (
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
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green-dim)'
                        : 'var(--c-amber-dim)'
                      : 'var(--c-panel)',
                  borderColor:
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-border)',
                  color:
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-text-dim)',
                }}
              >
                {s === 'not_issued' ? 'Not Issued' : 'Issued'}
              </button>
            ))}
          </div>
        </div>

        {/* Issued date */}
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
            Issued Date
          </div>
          <input
            type="date"
            value={details.layout_issued_at ?? ''}
            onChange={handleDateChange}
            disabled={isPending}
            style={{
              padding: '5px 10px',
              borderRadius: 5,
              border: '1px solid var(--c-border)',
              background: 'var(--c-panel)',
              color: 'var(--c-text)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              cursor: isPending ? 'default' : 'text',
            }}
          />
        </div>

        {/* Drawing upload */}
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
            Layout Drawing
          </div>

          {details.layout_drawing_path ? (
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
                title={drawingFilename ?? undefined}
              >
                {drawingFilename}
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
                onClick={handleRemoveDrawing}
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
                  <>↑ Upload drawing (PDF, DWG, DXF, …)</>
                )}
                <input
                  ref={fileRef}
                  type="file"
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
    </div>
  )
}
