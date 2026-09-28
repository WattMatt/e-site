'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatSolarDate } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { resolveErrorReportAction } from '@/actions/tariff-library.actions'

export interface ErrorReportRow {
  id: string
  note: string
  status: string
  resolutionNote: string
  createdAt: string
  project: string
  tariff: string
}

export function ErrorReportList({ rows }: { rows: ErrorReportRow[] }) {
  return <div style={{ display: 'grid', gap: 12 }}>{rows.map((r) => <ReportRow key={r.id} row={r} />)}</div>
}

function ReportRow({ row }: { row: ErrorReportRow }) {
  const router = useRouter()
  const [note, setNote] = useState(row.resolutionNote)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = async (status: 'open' | 'resolved' | 'rejected') => {
    setBusy(true); setError(null)
    const r = await resolveErrorReportAction({ id: row.id, status, resolutionNote: note })
    setBusy(false)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  return (
    <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8, fontSize: 13 }}>
      <div><strong>{row.tariff}</strong> · {row.project} · {formatSolarDate(row.createdAt)} · <em>{row.status}</em></div>
      <p style={{ margin: '4px 0' }}>{row.note}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" style={{ minWidth: 260 }} />
        {row.status !== 'resolved' && <Button size="sm" isLoading={busy} onClick={() => set('resolved')}>Mark resolved</Button>}
        {row.status !== 'rejected' && <Button size="sm" variant="secondary" isLoading={busy} onClick={() => set('rejected')}>Reject</Button>}
        {row.status !== 'open' && <Button size="sm" variant="ghost" isLoading={busy} onClick={() => set('open')}>Reopen</Button>}
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)' }}>{error}</p>}
    </div>
  )
}
