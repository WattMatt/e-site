'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelTenderAction, extendClosingAction } from '@/actions/tender-documents.actions'

/**
 * Run-the-tender controls: extend the closing time (issued only; the database
 * refuses any other move) and cancel. Both email the bidders; both take two
 * presses. Cancelling keeps every bid sealed for ever.
 */
export function TenderControls({ tenderId, status, closingAt }: { tenderId: string; status: string; closingAt: string | null }) {
  const router = useRouter()
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
  const [extending, setExtending] = useState(false)
  const [closing, setClosing] = useState(toLocal(closingAt))
  const [armed, setArmed] = useState<'extend' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const twoPress = (key: 'extend' | 'cancel', go: () => void) => {
    if (armed !== key) {
      setArmed(key)
      setTimeout(() => setArmed((a) => (a === key ? null : a)), 5000)
      return
    }
    setArmed(null)
    go()
  }

  async function run(fn: () => Promise<{ error: string } | { data: { emailed: number } }>, verb: string) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setMsg({ ok: true, text: `${verb}.${r.data.emailed ? ` Emailed ${r.data.emailed} tenderer(s).` : ''}` })
      setExtending(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const canCancel = status === 'draft' || status === 'issued' || status === 'closed'
  const canExtend = status === 'issued'

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {canExtend && !extending && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setExtending(true)}>Extend closing…</Button>
      )}
      {canExtend && extending && (
        <>
          <input type="datetime-local" aria-label="New closing time" value={closing} onChange={(e) => setClosing(e.target.value)} />
          <Button size="sm" isLoading={busy} onClick={() => twoPress('extend', () => run(() => extendClosingAction(tenderId, new Date(closing).toISOString()), 'Closing time extended'))}>
            {armed === 'extend' ? 'Tap again to extend' : 'Extend'}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setExtending(false); setArmed(null) }}>Keep as is</Button>
        </>
      )}
      {canCancel && (
        <Button size="sm" variant="secondary" isLoading={busy} onClick={() => twoPress('cancel', () => run(() => cancelTenderAction(tenderId), 'Tender cancelled'))}>
          {armed === 'cancel' ? 'Tap again to cancel the tender' : 'Cancel tender'}
        </Button>
      )}
      {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
    </span>
  )
}
