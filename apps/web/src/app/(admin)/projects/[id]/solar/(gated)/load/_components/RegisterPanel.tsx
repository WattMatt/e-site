'use client'
/** Meter register rows (spec §4.3 "Import meter register"): LLM / UNMAPPED matches are unconfirmed and never auto-applied. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmRegisterRowAction } from '@/actions/solar-load.actions'
import type { RegisterRowView } from '@/lib/solar/load/view-types'

export function RegisterPanel({ projectId, rows, canEdit }: { projectId: string; rows: RegisterRowView[]; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (rows.length === 0) return null
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Meter register ({rows.length} rows)</summary>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
        <thead><tr><th align="left">Site</th><th align="left">File</th><th align="left">Tenant</th><th align="left">Shop</th><th align="right">Area (m²)</th><th align="left">Match</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const untrusted = (r.matchMethod === 'llm' || r.matchMethod === 'unmapped') && !r.confirmed
            return (
              <tr key={r.id}>
                <td>{r.siteLabel ?? '—'}</td>
                <td>{r.fileName ?? '—'}{r.fileName && !r.fileImported && <span style={{ marginLeft: 6, color: 'var(--c-amber)' }}>file not yet imported</span>}</td>
                <td>{r.tenantName ?? '—'}</td>
                <td>{r.shopNo ?? '—'}</td>
                <td align="right">{r.areaM2 ?? '—'}</td>
                <td>{r.matchMethod.toUpperCase()}{r.confirmed ? ' · confirmed' : untrusted ? ' · unconfirmed' : ''}</td>
                <td>{canEdit && untrusted && (
                  <button type="button" disabled={busy === r.id} aria-label={`Confirm ${r.tenantName ?? r.fileName ?? 'row'}`} onClick={async () => {
                    setBusy(r.id); setError(null)
                    const res = await confirmRegisterRowAction({ projectId, rowId: r.id })
                    setBusy(null)
                    if ('error' in res) setError(res.error); else router.refresh()
                  }}>Confirm</button>
                )}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}
