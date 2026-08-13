'use client'

/**
 * EquipmentMaterialsReportButton — render the report, preview it inline, then
 * Save (a new version in projects.reports) or Download.
 *
 * Why fetch → blob instead of `iframe src={route}`: every same-origin response
 * carries `X-Frame-Options: DENY` (next.config.ts security headers), so the
 * browser refuses to render the streaming preview route in ANY iframe, even
 * same-origin — the frame just blanks. Fetching the PDF and framing a `blob:`
 * URL works because `frame-src` allows `blob:` and blob URLs carry no
 * X-Frame-Options. The fetch also surfaces the route's error body, so a failed
 * render shows a message rather than a silent blank frame.
 *
 * (Same approach as TenantScheduleReportButton; this one adds the revision note.)
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

const MAX_NOTE_LENGTH = 500

export function EquipmentMaterialsReportButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const blobRef = useRef<string | null>(null)

  const previewUrl = `/api/projects/${projectId}/equipment-materials/report-preview`

  function revokeBlob() {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current)
      blobRef.current = null
    }
  }

  useEffect(() => revokeBlob, [])

  async function openPreview() {
    setOpen(true)
    setSaved(false)
    setError(null)
    setLoading(true)
    revokeBlob()
    setBlobUrl(null)
    try {
      const res = await fetch(previewUrl)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Preview failed (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      blobRef.current = url
      setBlobUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render the report preview.')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false)
    revokeBlob()
    setBlobUrl(null)
    setNote('')
  }

  function download() {
    const a = document.createElement('a')
    a.href = blobRef.current ?? previewUrl
    a.download = 'equipment-materials-report.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/equipment-materials/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      })
      if (res.status === 201) { setSaved(true); router.refresh(); return }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Save failed (HTTP ${res.status})`)
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const ready = !loading && !error && !!blobUrl

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openPreview}>
        Generate report
      </Button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>Equipment &amp; Materials Report</span>
              <input
                type="text"
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(e) => setNote(e.target.value)}
                disabled={saved}
                placeholder="Note for this version (optional)"
                aria-label="Note for this version"
                style={{ flex: '1 1 220px', minWidth: 160, fontSize: 12, padding: '4px 8px', background: 'var(--c-elevated)', color: 'var(--c-text)', border: '1px solid var(--c-border)', borderRadius: 4 }}
              />
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {saved && <span style={{ fontSize: 12, color: 'var(--c-green)' }}>Saved to project ✓</span>}
                <Button variant="ghost" size="sm" onClick={download} disabled={!ready} style={{ fontSize: 12 }}>Download</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={!ready || saving || saved} isLoading={saving} style={{ fontSize: 12 }}>
                  {saved ? 'Saved' : 'Save to project'}
                </Button>
                <Button variant="ghost" size="sm" onClick={close} style={{ fontSize: 12 }}>Close</Button>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {loading && <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Rendering report…</span>}
              {error && !loading && (
                <div role="alert" style={{ maxWidth: 420, textAlign: 'center', padding: 16, fontSize: 13, color: 'var(--c-red)' }}>
                  Couldn’t render the report.<br />{error}
                </div>
              )}
              {ready && (
                <iframe title="Equipment & Materials Report preview" src={blobUrl!} style={{ width: '100%', height: '100%', border: 'none', background: 'var(--c-elevated)' }} />
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
