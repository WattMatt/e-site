'use client'

/**
 * ReportsPanel — saved report revisions for the generator cost-recovery module.
 *
 * - Generate report (readiness-gated) → POST /api/projects/[id]/generator-cost-recovery/reports
 *   → new immutable revision (Rev 1, 2, 3…) → router.refresh()
 * - View → inline signed URL in the contained ReportViewerModal (iframe)
 * - Download → signed URL with attachment disposition
 * - Delete → confirm, ORG_WRITE enforced by the server action
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  checkReadiness,
  type GcrReportRevisionRow,
  type GcrSettingsRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
  type TenantNodeRow,
} from '@esite/shared'
import { getGcrReportUrlAction, deleteGcrReportRevisionAction } from './gcr-reports.actions'
import { ReportViewerModal } from './ReportViewerModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function zar(n: number): string {
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  revisions: GcrReportRevisionRow[]
  /** True when the server-side revision load failed (don't claim "no reports"). */
  loadFailed?: boolean
  settings: GcrSettingsRow | null
  zones: GcrZoneRow[]
  generators: GcrZoneGeneratorRow[]
  tenants: TenantNodeRow[]
}

// ─── ReportsPanel ─────────────────────────────────────────────────────────────

export function ReportsPanel({ projectId, revisions, loadFailed, settings, zones, generators, tenants }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateGaps, setGenerateGaps] = useState<string[]>([])

  // Viewer state covers both saved revisions and the unsaved draft preview —
  // everything opens in the contained in-app modal, never a new tab.
  const [viewer, setViewer] = useState<{
    revLabel: string
    url: string
    rev: GcrReportRevisionRow | null // null = draft preview
  } | null>(null)
  const [busyRevId, setBusyRevId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  // Draft preview: the same-origin route can't be framed directly — every app
  // response carries X-Frame-Options: DENY (next.config.ts), which blanks the
  // iframe. So we fetch the PDF and frame a blob: URL instead (frame-src allows
  // blob:, and blob URLs carry no X-Frame-Options). This ref holds the URL so
  // we can revoke it. Saved revisions are unaffected — they frame cross-origin
  // Supabase signed URLs, which don't carry our header.
  const draftBlobRef = useRef<string | null>(null)
  const [isPreviewingDraft, setIsPreviewingDraft] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const readiness = useMemo(
    () => checkReadiness({ settings, zones, generators, tenantNodes: tenants }),
    [settings, zones, generators, tenants],
  )

  // ── Generate ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setIsGenerating(true)
    setGenerateError(null)
    setGenerateGaps([])
    try {
      const res = await fetch(`/api/projects/${projectId}/generator-cost-recovery/reports`, {
        method: 'POST',
      })
      if (res.status === 201) {
        startTransition(() => router.refresh())
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; gaps?: string[] }
      if (res.status === 422 && body.gaps?.length) {
        setGenerateGaps(body.gaps)
        setGenerateError(body.error ?? 'Generator data is not ready for a report')
        return
      }
      setGenerateError(body.error ?? `Failed to generate report (HTTP ${res.status})`)
    } catch {
      setGenerateError('Failed to generate report — check your connection and try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  // ── View / Download ─────────────────────────────────────────────────────────

  async function handleView(rev: GcrReportRevisionRow) {
    setBusyRevId(rev.id)
    setRowError(null)
    try {
      const res = await getGcrReportUrlAction(projectId, rev.id)
      if ('error' in res) { setRowError(res.error); return }
      setViewer({ revLabel: `Rev ${rev.revision_number}`, url: res.url, rev })
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyRevId(null)
    }
  }

  const previewUrl = `/api/projects/${projectId}/generator-cost-recovery/report-preview`

  function revokeDraftBlob() {
    if (draftBlobRef.current) {
      URL.revokeObjectURL(draftBlobRef.current)
      draftBlobRef.current = null
    }
  }

  // Revoke any outstanding draft object URL when the panel unmounts.
  useEffect(() => revokeDraftBlob, [])

  function closeViewer() {
    revokeDraftBlob()
    setViewer(null)
  }

  async function handlePreviewDraft() {
    // Fetch the same-origin route (cookie auth) and frame the resulting blob:
    // URL — framing the route directly is blocked by X-Frame-Options: DENY.
    // Surfacing the route's error body turns a silent blank frame into a message.
    setIsPreviewingDraft(true)
    setRowError(null)
    revokeDraftBlob()
    try {
      const res = await fetch(previewUrl)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setRowError(body.error ?? `Preview failed (HTTP ${res.status})`)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      draftBlobRef.current = url
      setViewer({ revLabel: 'Draft', url, rev: null })
    } catch {
      setRowError('Failed to render the report preview — check your connection and try again.')
    } finally {
      setIsPreviewingDraft(false)
    }
  }

  function downloadDraft() {
    const a = document.createElement('a')
    // Reuse the already-fetched blob; fall back to the route if it's gone.
    a.href = draftBlobRef.current ?? previewUrl
    a.download = 'generator-cost-recovery-draft.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleDownload(rev: GcrReportRevisionRow) {
    setBusyRevId(rev.id)
    setRowError(null)
    try {
      const res = await getGcrReportUrlAction(projectId, rev.id, { download: true })
      if ('error' in res) { setRowError(res.error); return }
      // Attachment disposition — navigating triggers the download without leaving the page.
      const a = document.createElement('a')
      a.href = res.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyRevId(null)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(rev: GcrReportRevisionRow) {
    setBusyRevId(rev.id)
    setRowError(null)
    try {
      const res = await deleteGcrReportRevisionAction(projectId, rev.id)
      if ('error' in res) { setRowError(res.error); return }
      startTransition(() => router.refresh())
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyRevId(null)
      setConfirmDeleteId(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Generate card */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
              Saved reports
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePreviewDraft}
                disabled={isPreviewingDraft}
                isLoading={isPreviewingDraft}
                style={{ fontSize: 12 }}
              >
                Preview draft
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleGenerate}
                disabled={!readiness.ready || isGenerating}
                isLoading={isGenerating}
                title={readiness.ready ? undefined : readiness.gaps.join(' · ')}
              >
                Generate report
              </Button>
            </div>
          </div>
        </CardHeader>
        {(!readiness.ready || generateError) && (
          <CardBody>
            {!readiness.ready && (
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {readiness.gaps.map((gap) => (
                  <li key={gap} style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{gap}</li>
                ))}
              </ul>
            )}
            {generateError && (
              <div
                role="alert"
                style={{
                  marginTop: readiness.ready ? 0 : 10,
                  padding: '8px 12px',
                  border: '1px solid var(--c-red)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--c-red)',
                }}
              >
                {generateError}
                {generateGaps.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {generateGaps.map((g) => <li key={g}>{g}</li>)}
                  </ul>
                )}
              </div>
            )}
          </CardBody>
        )}
      </Card>

      {rowError && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--c-red)',
          }}
        >
          {rowError}
        </div>
      )}

      {/* Revision list */}
      {revisions.length === 0 ? (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          {loadFailed
            ? 'Couldn’t load saved reports — refresh to try again.'
            : 'No saved reports yet. Generate one to create Rev 1.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {revisions.map((rev) => {
            const busy = busyRevId === rev.id
            const isConfirmingDelete = confirmDeleteId === rev.id
            return (
              <Card key={rev.id}>
                <CardBody>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>
                      Rev {rev.revision_number}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
                      {formatDate(rev.created_at)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 140,
                        fontSize: 12,
                        color: 'var(--c-text-mid)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={rev.file_name}
                    >
                      {rev.file_name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Button variant="secondary" size="sm" onClick={() => handleView(rev)} disabled={busy} style={{ fontSize: 11 }}>
                        View
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(rev)} disabled={busy} style={{ fontSize: 11 }}>
                        Download
                      </Button>
                      {isConfirmingDelete ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(rev)} disabled={busy} style={{ fontSize: 11 }}>
                            Confirm delete
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={busy} style={{ fontSize: 11 }}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(rev.id)}
                          disabled={busy}
                          style={{ fontSize: 11, color: 'var(--c-red)' }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {rev.summary && (
                    <div style={{ display: 'flex', gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                        Monthly repayment: <strong>{zar(rev.summary.monthlyCapitalRepayment)}</strong>
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                        Tariff: <strong>{zar(rev.summary.finalTariff)}/kWh</strong>
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                        Tenants: <strong>{rev.summary.tenantCount}</strong>
                      </span>
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* Contained in-app viewer — saved revisions and the draft preview alike */}
      {viewer && (
        <ReportViewerModal
          title="Generator Cost-Recovery Report"
          revLabel={viewer.revLabel}
          url={viewer.url}
          onDownload={() => (viewer.rev ? handleDownload(viewer.rev) : downloadDraft())}
          isDownloading={viewer.rev ? busyRevId === viewer.rev.id : false}
          onClose={closeViewer}
        />
      )}
    </div>
  )
}
