'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { runDueYearCheckAction } from '@/actions/tariff-library.actions'

export function RunMonitorButton({ regime }: { regime: 'eskom' | 'municipal' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <Button variant="secondary" size="sm" isLoading={busy} onClick={async () => {
        setBusy(true); setMsg(null)
        const r = await runDueYearCheckAction({ regime })
        setBusy(false)
        if ('error' in r) setMsg(r.error)
        else { setMsg(r.inserted === 0 ? 'No new alerts.' : `${r.inserted} new alert(s).`); router.refresh() }
      }}>
        Check {regime === 'eskom' ? 'Eskom' : 'municipal'} years now
      </Button>
      {msg && <span role="status" style={{ fontSize: 12 }}>{msg}</span>}
    </span>
  )
}
