'use client'

/**
 * SavedReportsPanel — lists a project's saved reports (optionally scoped to one
 * source entity), with in-app Preview, Download, and (manager-only) Delete.
 *
 * Two modes:
 *  - Server-fed: pass `reports` (the host server component pre-loads them).
 *  - Self-loading: omit `reports` → the panel fetches via listProjectReportsAction
 *    on mount and when the scope changes. Used by client-component hosts
 *    (e.g. CertifyBar, VisitDetail) that can't easily pre-load.
 */
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  listProjectReportsAction,
  getProjectReportUrlAction,
  deleteProjectReportAction,
  type ProjectReportRow,
} from '@/actions/project-reports.actions'
import { ReportViewerModal } from './ReportViewerModal'

interface Props {
  projectId: string
  kind: string
  /** Scope to one source entity (inspection/snag/valuation). Omit for project-level. */
  source?: { table: string; id: string }
  /** Server-loaded rows. Omit to self-load via the list action. */
  reports?: ProjectReportRow[]
  /** Hide Delete when false. Default true — deleteProjectReportAction is the real gate. */
  canManage?: boolean
  title?: string
  /** Bump to force a self-loading panel to re-fetch (e.g. after the host creates a report). */
  reloadKey?: number
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function SavedReportsPanel({ projectId, kind, source, reports, canManage = true, title = 'Saved reports', reloadKey }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const selfLoad = reports === undefined
  const [fetched, setFetched] = useState<ProjectReportRow[] | null>(null)

  const [viewer, setViewer] = useState<{ label: string; url: string; reportId: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Self-load: fetch this project/kind/source's rows on mount + when the scope changes.
  useEffect(() => {
    if (!selfLoad) return
    let live = true
    setFetched(null)
    listProjectReportsAction(projectId, kind, source).then((res) => {
      if (live) setFetched(Array.isArray(res) ? res : [])
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfLoad, projectId, kind, source?.table, source?.id, reloadKey])

  async function refetch() {
    const res = await listProjectReportsAction(projectId, kind, source)
    setFetched(Array.isArray(res) ? res : [])
  }

  const rows = selfLoad ? fetched : reports!
  const loading = selfLoad && fetched === null

  async function handlePreview(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await getProjectReportUrlAction(projectId, rep.id)
      if ('error' in res) { setRowError(res.error); return }
      setViewer({ label: `v${rep.version}`, url: res.url, reportId: rep.id })
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await getProjectReportUrlAction(projectId, rep.id, { download: true })
      if ('error' in res) { setRowError(res.error); return }
      const a = document.createElement('a')
      a.href = res.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await deleteProjectReportAction(projectId, rep.id)
      if ('error' in res) { setRowError(res.error); return }
      if (selfLoad) await refetch()
      else startTransition(() => router.refresh())
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>{title}</span>
      </CardHeader>
      <CardBody>
        {rowError && (
          <div role="alert" style={{ marginBottom: 10, padding: '8px 12px', border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)' }}>
            {rowError}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            No saved reports yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((rep) => {
              const busy = busyId === rep.id
              const confirming = confirmDeleteId === rep.id
              return (
                <div key={rep.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 4px', borderBottom: '1px solid var(--c-border)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>v{rep.version}</span>
                  <span style={{ fontSize: 12, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>{formatDate(rep.generated_at)}</span>
                  <span style={{ fontSize: 11, color: rep.status === 'issued' ? 'var(--c-green)' : 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{rep.status}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button variant="secondary" size="sm" onClick={() => handlePreview(rep)} disabled={busy} style={{ fontSize: 11 }}>Preview</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(rep)} disabled={busy} style={{ fontSize: 11 }}>Download</Button>
                    {canManage && (confirming ? (
                      <>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(rep)} disabled={busy} style={{ fontSize: 11 }}>Confirm delete</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={busy} style={{ fontSize: 11 }}>Cancel</Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(rep.id)} disabled={busy} style={{ fontSize: 11, color: 'var(--c-red)' }}>Delete</Button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>

      {viewer && (
        <ReportViewerModal
          title="Report"
          label={viewer.label}
          url={viewer.url}
          onDownload={() => {
            const rep = (rows ?? []).find((r) => r.id === viewer.reportId)
            if (rep) handleDownload(rep)
          }}
          isDownloading={busyId === viewer.reportId}
          onClose={() => setViewer(null)}
        />
      )}
    </Card>
  )
}
