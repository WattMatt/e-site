'use client'

/**
 * DocumentPreviewModal — in-app document preview (spec D10).
 *
 * Replaces the Part-A new-tab open: shows the file inside the app — a PDF in an
 * <iframe>, an image inline, other types fall back to a Download prompt. The
 * caller passes a `fetchUrl(download?)` thunk wrapping the existing signed-URL
 * server action; `download=true` returns a Content-Disposition-attachment URL.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { triggerDownload } from '@/lib/file-open'

type SignedUrl = { url: string } | { error: string }

const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const PDF = /\.pdf$/i

const btn: React.CSSProperties = {
  background: 'var(--c-raised)', border: '1px solid var(--c-border)', borderRadius: 6,
  padding: '3px 10px', fontSize: 12, color: 'var(--c-text)', cursor: 'pointer',
}

export function DocumentPreviewModal({
  fileName,
  fetchUrl,
  onClose,
}: {
  fileName: string
  fetchUrl: (download?: boolean) => Promise<SignedUrl>
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let live = true
    fetchUrl(false).then((res) => {
      if (!live) return
      if ('error' in res) setError(res.error)
      else setUrl(res.url)
    })
    return () => {
      live = false
    }
  }, [fetchUrl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleDownload() {
    setDownloading(true)
    const res = await fetchUrl(true)
    setDownloading(false)
    if ('error' in res) setError(res.error)
    else triggerDownload(res.url)
  }

  const isPdf = PDF.test(fileName)
  const isImg = IMG.test(fileName)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${fileName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 8,
        width: '100%', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleDownload} disabled={downloading} style={btn}>
              {downloading ? '…' : '↓ Download'}
            </button>
            <button type="button" onClick={onClose} aria-label="Close preview" style={btn}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--c-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
          {error ? (
            <span style={{ color: 'var(--c-red)', fontSize: 13, padding: 24 }}>{error}</span>
          ) : !url ? (
            <span style={{ color: 'var(--c-text-dim)', fontSize: 13, padding: 24 }}>Loading…</span>
          ) : isPdf ? (
            <iframe title={fileName} src={url} style={{ width: '100%', height: '80vh', border: 'none' }} />
          ) : isImg ? (
            <img alt={fileName} src={url} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--c-text-mid)', fontSize: 13 }}>
              Preview not available for this file type — use Download.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
