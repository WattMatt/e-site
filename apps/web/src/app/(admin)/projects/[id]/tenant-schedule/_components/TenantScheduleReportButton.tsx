'use client'

/**
 * TenantScheduleReportButton — generate the tenant schedule report, preview it
 * inline (iframe of the streaming preview route), then Save (persist to
 * projects.reports) or Download (the streamed PDF). Self-contained modal.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'

export function TenantScheduleReportButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewUrl = `/api/projects/${projectId}/tenant-schedule/report-preview`

  function download() {
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = 'tenant-schedule-report.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/tenant-schedule/reports`, { method: 'POST' })
      if (res.status === 201) { setSaved(true); return }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Save failed (HTTP ${res.status})`)
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => { setOpen(true); setSaved(false); setError(null) }}>
        Generate report
      </Button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>Tenant Schedule Report</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
                {saved && <span style={{ fontSize: 12, color: 'var(--c-green)' }}>Saved to project ✓</span>}
                <Button variant="ghost" size="sm" onClick={download} style={{ fontSize: 12 }}>Download</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || saved} isLoading={saving} style={{ fontSize: 12 }}>
                  {saved ? 'Saved' : 'Save to project'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Close</Button>
              </div>
            </div>
            <iframe title="Tenant Schedule Report preview" src={previewUrl} style={{ flex: 1, border: 'none', background: '#fff' }} />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
