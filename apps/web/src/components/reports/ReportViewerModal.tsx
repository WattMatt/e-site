'use client'

/**
 * ReportViewerModal — contained in-app viewer for a saved report PDF. Centered
 * overlay with an <iframe> of the inline signed URL (cross-origin Supabase, so
 * X-Frame-Options does not apply — it frames cleanly).
 */
import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
  title: string
  label: string
  /** Inline (non-attachment) signed URL for the PDF. */
  url: string
  onDownload: () => void
  isDownloading: boolean
  onClose: () => void
}

export function ReportViewerModal({ title, label, url, onDownload, isDownloading, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${label}`}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(90vw, 880px)', height: '90vh', background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, boxShadow: '0 14px 48px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <Button variant="secondary" size="sm" onClick={onDownload} isLoading={isDownloading} style={{ fontSize: 12 }}>Download</Button>
          <button onClick={onClose} aria-label="Close report viewer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>
        <iframe src={url} title={`${title} — ${label}`} style={{ flex: 1, width: '100%', border: 'none', background: 'var(--c-surface)' }} />
      </div>
    </div>
  )
}
