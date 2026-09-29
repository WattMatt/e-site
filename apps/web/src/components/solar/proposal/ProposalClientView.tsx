'use client'
/**
 * What the client sees (spec §9.4) — by secure link or in the portal. Renders ONLY the frozen
 * snapshot, through keyFigures() / financeOptionTable(): the same functions the PDF uses, so the
 * numbers are the same strings as the PDF — never a second, drifting set of assumptions.
 * Accept / Decline are two-step; the server stamps time, IP, user agent and the PDF hash.
 */
import { useState } from 'react'
import { FINANCE_OPTION_LABELS, financeOptionTable, isoDate, keyFigures } from '@esite/shared/solar-reports'
import type { ClientProposalView } from '@/lib/solar/proposals/client'
import { getPortalProposalPdfUrlAction, respondToPortalProposalAction } from '@/actions/solar-portal-proposals.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'
import { SignaturePad } from './SignaturePad'

type Mode = { kind: 'token'; token: string } | { kind: 'portal'; projectId: string; proposalId: string }
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600 }

function contact(issuer: ClientProposalView['issuer']): string {
  return issuer ? ` — contact ${issuer.proposerName}${issuer.proposerEmail ? ` (${issuer.proposerEmail})` : ''}.` : '.'
}

export function ProposalClientView({ mode, view }: { mode: Mode; view: ClientProposalView }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [authority, setAuthority] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answered, setAnswered] = useState<null | 'accepted' | 'declined'>(null)
  const acc = useArmedConfirm(), dec = useArmedConfirm()

  if (!view.snapshot || view.state === 'expired' || view.state === 'withdrawn' || view.state === 'not_found') {
    const text = view.state === 'expired' ? `This proposal has expired${contact(view.issuer)}` : `This proposal is no longer available${contact(view.issuer)}`
    return <p style={{ fontSize: 15 }}>{text}</p>
  }
  const s = view.snapshot
  const t = financeOptionTable(s)

  async function respond(decision: 'accepted' | 'declined') {
    acc.disarm(); dec.disarm(); setBusy(true); setError(null)
    const body = { decision, name, email, authority: decision === 'accepted' ? authority : false, signature: decision === 'accepted' ? signature : null, reason: decision === 'declined' ? reason || null : null }
    let err: string | null = null
    if (mode.kind === 'token') {
      const res = await fetch('/api/solar/proposal-response', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: mode.token, ...body }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) err = j.error ?? 'Something went wrong — try again.'
    } else {
      const r = await respondToPortalProposalAction({ projectId: mode.projectId, proposalId: mode.proposalId, ...body })
      if ('error' in r) err = r.error
    }
    setBusy(false)
    if (err) setError(err); else setAnswered(decision)
  }
  async function download() {
    setError(null)
    if (mode.kind === 'token') {
      const res = await fetch('/api/solar/proposal-download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: mode.token }) })
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (j.url) window.location.href = j.url; else setError(j.error ?? 'The PDF could not be prepared — try again.')
    } else {
      const r = await getPortalProposalPdfUrlAction({ projectId: mode.projectId, proposalId: mode.proposalId })
      if ('url' in r) window.location.href = r.url; else setError(r.error)
    }
  }

  const done = answered ?? (view.state === 'accepted' || view.state === 'declined' ? view.state : null)
  const section = (title: string, body: string) => body.trim() ? <section><h3 style={{ fontSize: 15 }}>{title}</h3>{body.split('\n').map((l, i) => <p key={i} style={{ margin: '2px 0' }}>{l}</p>)}</section> : null
  const list = (title: string, items: string[]) => items.length ? <section><h3 style={{ fontSize: 15 }}>{title}</h3><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></section> : null

  return (
    <article style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <header>
        <p style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.issuer.orgName}</p>
        <h1 style={{ margin: '4px 0', fontSize: 22 }}>{s.proposal.title}</h1>
        <p style={{ margin: 0, fontSize: 13 }}>{`Prepared for ${s.client.name} · ${s.project.name}${s.project.address ? `, ${s.project.address}` : ''} · version ${s.proposal.version} · valid until ${isoDate(s.proposal.validUntil)}`}</p>
      </header>
      <section>
        <h2 style={{ fontSize: 17 }}>Key figures</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: '4px 12px', margin: 0 }}>
          {keyFigures(s).map((f, i) => (
            <div key={f.label} style={{ display: 'contents' }}>
              <dt data-testid={`kf-label-${i}`}>{f.label}</dt>
              <dd data-testid={`kf-value-${i}`} style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {section('Summary', s.text.summary)}
      {section('About this proposal', s.text.narrative)}
      {section('Scope', s.text.scope)}
      {list('Included', s.text.inclusions)}
      {list('Excluded', s.text.exclusions)}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: 17 }}>Finance options</h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead><tr>{t.columns.map((c, i) => <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1', padding: 4 }}>{c}</th>)}</tr></thead>
          <tbody>{t.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ci === 0 ? <th key={ci} data-testid={`fo-${ri}-${ci}`} style={{ textAlign: 'left', padding: 4 }}>{c}</th> : <td key={ci} data-testid={`fo-${ri}-${ci}`} style={{ padding: 4 }}>{c}</td>))}</tr>)}</tbody>
        </table>
        <p style={{ fontSize: 12 }}>{`Options offered: ${s.financeOptions.map((o) => FINANCE_OPTION_LABELS[o.kind]).join(', ')}. Figures are estimates from a modelled year; prices exclude VAT unless marked.`}</p>
      </section>
      {section('Price and payment terms', s.text.priceTerms)}
      {section('Assumptions', s.text.assumptions)}
      {section('Terms and conditions', s.text.terms)}
      {section('Disclaimer', s.text.disclaimer)}
      <p style={{ fontSize: 13 }}>{`Questions? Contact ${s.issuer.proposerName}${s.issuer.proposerEmail ? ` (${s.issuer.proposerEmail})` : ''}.`}</p>
      <div><button type="button" style={btn} onClick={download}>Download PDF</button></div>

      {done ? (
        <p role="status" style={{ fontSize: 15, fontWeight: 600 }}>
          {answered === 'accepted' ? 'Thank you — you accepted this proposal.'
            : answered === 'declined' ? 'You declined this proposal.'
            : view.response ? `${view.response.kind === 'accepted' ? 'Accepted' : 'Declined'} by ${view.response.name} on ${view.response.at.slice(0, 10)}.`
            : done === 'accepted' ? 'This proposal has been accepted.' : 'This proposal has been declined.'}
        </p>
      ) : (
        <section style={{ display: 'grid', gap: 8, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Your response</h2>
          <label style={{ display: 'grid', gap: 2 }}>Your full name<input aria-label="Your full name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ display: 'grid', gap: 2 }}>Your email<input aria-label="Your email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><input type="checkbox" aria-label={`I have authority to accept on behalf of ${s.client.name}`} checked={authority} onChange={(e) => setAuthority(e.target.checked)} />{` I have authority to accept on behalf of ${s.client.name}`}</label>
          <SignaturePad onChange={setSignature} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {acc.armed
              ? <button type="button" style={{ ...btn, background: '#166534', color: '#fff' }} disabled={busy} onClick={() => respond('accepted')}>Confirm acceptance</button>
              : <button type="button" style={btn} disabled={busy || !name.trim() || !email.trim() || !authority} onClick={acc.arm}>Accept proposal</button>}
          </div>
          <label style={{ display: 'grid', gap: 2 }}>Reason (optional)<textarea aria-label="Reason (optional)" value={reason} maxLength={2000} rows={2} onChange={(e) => setReason(e.target.value)} /></label>
          <div>
            {dec.armed
              ? <button type="button" style={{ ...btn, background: '#991b1b', color: '#fff' }} disabled={busy} onClick={() => respond('declined')}>Confirm decline</button>
              : <button type="button" style={btn} disabled={busy || !name.trim() || !email.trim()} onClick={dec.arm}>Decline proposal</button>}
          </div>
          <p style={{ fontSize: 12, margin: 0 }}>When you respond we record the time, your IP address and browser, and the fingerprint (SHA-256) of the PDF you were shown.</p>
        </section>
      )}
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    </article>
  )
}
