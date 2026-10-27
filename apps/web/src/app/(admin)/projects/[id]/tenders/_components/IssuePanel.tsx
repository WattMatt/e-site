'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { issueTenderAction } from '@/actions/tender-invite.actions'

/** Draft → issued. The database refuses it unless the BOQ is imported and every fixed sum has an amount. */
export function IssuePanel({
  tenderId,
  closingAt,
  documentCount,
  hasParticulars,
}: {
  tenderId: string
  closingAt: string | null
  /** Issued documents attached so far (the pack). */
  documentCount: number
  /** Reference, scope, validity or contact filled in. */
  hasParticulars: boolean
}) {
  const router = useRouter()
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
  const [closing, setClosing] = useState(toLocal(closingAt))
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function issue() {
    if (!closing) return setError('Set the closing date and time')
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await issueTenderAction(tenderId, new Date(closing).toISOString())
      if ('error' in r) return setError(r.error)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Issue the tender</span></CardHeader>
      <CardBody>
        <p style={{ marginTop: 0, fontSize: 13 }}>
          Issuing freezes the BOQ, the tender documents, the particulars and the list of documents requested from bidders.
          Invited companies can see the tender only once it is issued.
        </p>
        {documentCount === 0 && (
          <p role="status" style={{ fontSize: 13, color: 'var(--c-amber)' }}>
            ⚠ No tender documents are attached. Bidders would receive the BOQ alone — no specifications, drawings, P&amp;G or
            conditions of tender. Add them under <strong>Tender documents</strong> before issuing.
          </p>
        )}
        {!hasParticulars && (
          <p role="status" style={{ fontSize: 13, color: 'var(--c-amber)' }}>
            ⚠ The tender particulars are empty (reference, scope, validity, queries contact). Fill them in under{' '}
            <strong>Tender particulars</strong> before issuing — they are frozen at issue.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>Closes <input type="datetime-local" value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
          <Button isLoading={busy} onClick={issue}>{armed ? 'Tap again to issue (cannot be undone)' : 'Issue tender'}</Button>
          {error && <span role="alert" style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
