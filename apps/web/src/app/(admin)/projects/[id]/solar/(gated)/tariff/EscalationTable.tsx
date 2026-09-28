'use client'
/** Escalation path (spec §5; D-07): year n -> %, with where each value comes from. */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { EscalationRow } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSolarEscalationAction } from '@/actions/solar-tariff.actions'

const TD: CSSProperties = { padding: '4px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)' }

function sourceLabel(r: EscalationRow): string {
  if (r.source === 'published') return `Approved increase ${r.financialYear}`
  if (r.source === 'override') return 'Set for this project'
  return 'Org default (D-07)'
}

export function EscalationTable({ projectId, updatedAt, rows }: { projectId: string; updatedAt: string; rows: EscalationRow[] }) {
  const router = useRouter()
  const [form, setForm] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (rows.length === 0) {
    return <p style={{ fontSize: 13, margin: 0 }}>No escalation path yet: set the analysis period in the organisation&apos;s Solar settings.</p>
  }
  const kept = Object.fromEntries(rows.filter((r) => r.source === 'override').map((r) => [String(r.year), String(r.pct)]))
  const save = async (f: Record<string, string>) => {
    setBusy(true); setMsg(null); setErrors({})
    const r = await saveSolarEscalationAction({ projectId, expectedUpdatedAt: updatedAt, form: f })
    setBusy(false)
    if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else if ('error' in r) setMsg(r.error)
    else { setForm({}); setMsg('Saved.'); router.refresh() }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>Year</th><th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 11 }}>Increase</th><th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>From</th><th style={{ padding: '4px 8px', fontSize: 11 }}>Change to (%)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.year}>
              <td style={TD}>Year {r.year}</td>
              <td style={{ ...TD, textAlign: 'right' }}>{r.pct.toFixed(2)} %</td>
              <td style={TD}>{sourceLabel(r)}</td>
              <td style={TD}>
                <input aria-label={`Year ${r.year} escalation %`} value={form[String(r.year)] ?? ''} onChange={(e) => setForm({ ...form, [String(r.year)]: e.target.value })} style={{ width: 70 }} /> %
                {errors[String(r.year)] && <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}> {errors[String(r.year)]}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={() => save({ ...kept, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')) })}>Save escalation</Button>
        <Button variant="ghost" isLoading={busy} onClick={() => save({})}>Reset to defaults</Button>
        {msg && <span role="status" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}
