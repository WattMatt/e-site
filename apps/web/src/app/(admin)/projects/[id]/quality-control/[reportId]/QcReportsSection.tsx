'use client'

import { useState } from 'react'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { IssueReportButton } from './IssueReportButton'
import { QcLifecycleButtons } from './QcLifecycleButtons'

interface Props {
  projectId: string
  reportId: string
  status: string
  /** ORG_WRITE_ROLES — controls issue/close/reopen/delete and saved-report Delete. */
  canManage: boolean
}

/**
 * Lifecycle actions + saved-reports panel. Client wrapper because issue and
 * the panel share state: an issue saves a new projects.reports row, so the
 * (self-loading) panel's reloadKey must bump to re-fetch — the VisitDetail
 * reportsKey idiom. Issue is hidden on closed reports (Reopen shows instead,
 * via QcLifecycleButtons — re-issuing a closed report is refused server-side).
 */
export function QcReportsSection({ projectId, reportId, status, canManage }: Props) {
  const [reportsKey, setReportsKey] = useState(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <QcLifecycleButtons projectId={projectId} reportId={reportId} status={status} />
          {status !== 'closed' && (
            <IssueReportButton
              projectId={projectId}
              reportId={reportId}
              status={status}
              onIssued={() => setReportsKey((k) => k + 1)}
            />
          )}
        </div>
      )}
      <SavedReportsPanel
        projectId={projectId}
        kind="qc"
        source={{ table: 'qc_reports', id: reportId }}
        reloadKey={reportsKey}
        canManage={canManage}
        title="Saved reports"
      />
    </div>
  )
}
