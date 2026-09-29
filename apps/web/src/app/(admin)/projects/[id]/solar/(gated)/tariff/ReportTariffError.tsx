'use client'
/** "Report a tariff error" (spec §5): a note to the platform tariff library queue (index D2b-3). */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { reportTariffErrorAction } from '@/actions/solar-tariff.actions'

export function ReportTariffError({ projectId, tariffId }: { projectId: string; tariffId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ background: 'none', border: 0, color: 'var(--c-amber)', cursor: 'pointer', padding: 0, fontSize: 13 }}>Report a tariff error</button>
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <label>What looks wrong?<textarea aria-label="What looks wrong?" value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: '100%' }} /></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" isLoading={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const r = await reportTariffErrorAction({ projectId, tariffId, note })
          setBusy(false)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Sent. The tariff library maintainers will review it.' }); setNote('') }
        }}>Send to the tariff library</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
