'use client'

import { useState } from 'react'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { IssueReportButton } from './IssueReportButton'

interface Props {
  projectId: string
  reportId: string
  status: string
  /** ORG_WRITE_ROLES — controls the Issue button and saved-report Delete. */
  canManage: boolean
}

/**
 * Issue action + saved-reports panel. Client wrapper because the two share
 * state: an issue saves a new projects.reports row, so the (self-loading)
 * panel's reloadKey must bump to re-fetch — the VisitDetail reportsKey idiom.
 */
export function QcReportsSection({ projectId, reportId, status, canManage }: Props) {
  const [reportsKey, setReportsKey] = useState(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && status !== 'closed' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <IssueReportButton
            projectId={projectId}
            reportId={reportId}
            status={status}
            onIssued={() => setReportsKey((k) => k + 1)}
          />
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
