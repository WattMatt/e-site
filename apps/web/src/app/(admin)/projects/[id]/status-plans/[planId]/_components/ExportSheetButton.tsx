'use client'

/**
 * "Export sheet" — the plan as a PDF at the drawing's own size. fetch → blob (not a bare <a href>) so a
 * refusal shows its sentence instead of downloading a JSON file named .pdf.
 * Props are strings only (page.tsx → client component must be JSON).
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export function ExportSheetButton({ projectId, planId }: { projectId: string; planId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportSheet() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/status-plans/${planId}/sheet`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Export failed (HTTP ${res.status}).`)
        return
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'status-plan.pdf'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('Export failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button variant="secondary" size="sm" onClick={exportSheet} isLoading={busy} disabled={busy}>Export sheet</Button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
