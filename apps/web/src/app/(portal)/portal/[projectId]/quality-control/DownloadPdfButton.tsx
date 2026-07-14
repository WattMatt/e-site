'use client'

import { useState } from 'react'
import { getPortalQcReportPdfUrlAction } from '@/actions/portal-qc.actions'

/** Per-report "Download PDF" — signs the latest issued version on demand. */
export function DownloadPdfButton({ projectId, reportId }: { projectId: string; reportId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      const res = await getPortalQcReportPdfUrlAction(projectId, reportId)
      if ('error' in res) { setError(res.error); return }
      const a = document.createElement('a')
      a.href = res.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setError('Download failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        style={{
          padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: busy ? 'wait' : 'pointer',
          color: 'var(--c-amber)', background: 'transparent',
          border: '1px solid var(--c-amber-mid)', whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Preparing…' : 'Download PDF'}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--c-danger)' }}>{error}</span>
      )}
    </span>
  )
}
