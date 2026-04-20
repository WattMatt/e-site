'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  type: 'snag-list' | 'compliance' | 'diary-weekly'
  entityId: string
  label?: string
}

export function ReportButton({ type, entityId, label = 'Download Report' }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generateReport() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Not authenticated'); setLoading(false); return }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const res = await fetch(`${supabaseUrl}/functions/v1/generate-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ type, entityId }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      setError(err.error ?? 'Failed to generate report')
      setLoading(false)
      return
    }

    // Open HTML in a new window — user can Ctrl+P to save as PDF
    const html = await res.text()
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (!win) setError('Pop-up blocked — please allow pop-ups for this site')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    setLoading(false)
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={generateReport}
        disabled={loading}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '7px 14px',
          borderRadius: 6,
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.55 : 1,
          transition: 'border-color 0.15s, background 0.15s, color 0.15s',
        }}
      >
        {loading ? 'Generating…' : label}
      </button>
      {error && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--c-red)' }} role="alert">{error}</p>
      )}
    </div>
  )
}
