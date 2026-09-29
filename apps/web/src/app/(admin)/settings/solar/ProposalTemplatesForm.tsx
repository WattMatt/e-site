'use client'
/** Org proposal templates (spec §11 "Branding for Solar reports": terms and disclaimer; default validity). */
import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { saveSolarProposalTemplatesAction } from '@/actions/solar-proposal-templates.actions'

export function ProposalTemplatesForm({ initial, updatedAt }: { initial: { termsText: string; disclaimerText: string; validityDays: number }; updatedAt: string | null }) {
  const [v, setV] = useState(initial)
  const [stamp, setStamp] = useState(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setErrors({}); setMsg(null); setError(null)
    const r = await saveSolarProposalTemplatesAction({ ...v, expectedUpdatedAt: stamp })
    setBusy(false)
    if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else if ('error' in r) setError(r.error)
    else { setStamp(r.updatedAt); setMsg('Templates saved.') }
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Proposal and report templates</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Proposal terms and conditions
            <textarea aria-label="Proposal terms and conditions" rows={6} maxLength={20000} value={v.termsText} onChange={(e) => setV({ ...v, termsText: e.target.value })} />
            {errors.termsText && <span role="alert">{errors.termsText}</span>}
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Disclaimer on Solar reports and proposals
            <textarea aria-label="Disclaimer on Solar reports and proposals" rows={3} maxLength={5000} value={v.disclaimerText} onChange={(e) => setV({ ...v, disclaimerText: e.target.value })} />
            {errors.disclaimerText && <span role="alert">{errors.disclaimerText}</span>}
          </label>
          <label style={{ fontSize: 12 }}>Default validity (days){' '}
            <input aria-label="Default validity (days)" type="number" min={1} max={365} value={v.validityDays} onChange={(e) => setV({ ...v, validityDays: Math.trunc(Number(e.target.value)) })} />
          </label>
          {errors.validityDays && <span role="alert" style={{ fontSize: 12 }}>{errors.validityDays}</span>}
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>The default margin for proposals is the “Margin” field of the rate card above. New proposals copy these; an issued proposal keeps the text it was issued with.</p>
          <div><Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save templates'}</Button></div>
          {msg && <p role="status" style={{ fontSize: 12, margin: 0 }}>{msg}</p>}
          {error && <p role="alert" style={{ fontSize: 12, margin: 0, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
        </div>
      </CardBody>
    </Card>
  )
}
