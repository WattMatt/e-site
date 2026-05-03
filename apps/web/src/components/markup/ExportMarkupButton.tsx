'use client'

import { useState } from 'react'
import { exportRfiMarkupPdfAction } from '@/actions/markup-export.actions'

/**
 * Tiny client component for the "Export PDF" action on a markup
 * thumbnail. Calls the server action, decodes the returned base64
 * PDF in-browser, and triggers a Blob download.
 */
export function ExportMarkupButton({ annotationId }: { annotationId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      const res = await exportRfiMarkupPdfAction({ annotationId })
      if (res.error || !res.pdfBase64 || !res.fileName) {
        setError(res.error ?? 'Export failed')
        return
      }
      // base64 → bytes → Blob → download
      const bin = atob(res.pdfBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after the browser starts the download (1s buffer is plenty).
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title={busy ? 'Generating PDF…' : 'Export this markup as PDF'}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--c-amber)',
          textDecoration: 'none',
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid var(--c-border)',
          background: 'var(--c-panel)',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'PDF…' : 'PDF ↓'}
      </button>
      {error && (
        <span role="alert" style={{ color: '#dc2626', fontSize: 10, marginLeft: 6 }}>
          {error}
        </span>
      )}
    </>
  )
}
