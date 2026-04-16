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
    <div>
      <button
        onClick={generateReport}
        disabled={loading}
        className="text-sm px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 transition-colors"
      >
        {loading ? 'Generating…' : label}
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
