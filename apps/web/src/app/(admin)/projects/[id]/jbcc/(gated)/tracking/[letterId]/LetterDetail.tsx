'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type {
  JbccLetter, JbccNotice, JbccLetterAttachment, ServiceMethod,
  JbccLetterEvent, JbccLetterRecipient, LetterLifecycleInput,
} from '@esite/shared'
import {
  letterLifecycleAction, addAttachmentAction, deleteAttachmentAction,
} from '@/actions/jbcc.actions'

interface Props {
  projectId: string
  letter: JbccLetter
  notice: JbccNotice | null
  letterUrl: string | null
  attachments: Array<JbccLetterAttachment & { signedUrl: string | null }>
  events: JbccLetterEvent[]
  recipients: JbccLetterRecipient[]
  actorNames: Record<string, string>
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Created (draft)',
  submitted_for_review: 'Submitted for review',
  approved: 'Approved',
  issued: 'Issued',
  served: 'Served',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
  reverted_to_draft: 'Reverted to draft',
  attachment_added: 'Attachment added',
  attachment_removed: 'Attachment removed',
  legal_hold_set: 'Legal hold placed',
  legal_hold_cleared: 'Legal hold cleared',
  soft_deleted: 'Archived',
  note: 'Note',
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return ts }
}

export function LetterDetail({ projectId, letter, notice, letterUrl, attachments, events, recipients, actorNames }: Props) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'issue' | 'serve' | null>(null)

  const [issuedDate, setIssuedDate]       = useState(letter.issued_date ?? new Date().toISOString().slice(0, 10))
  const [serviceMethod, setServiceMethod] = useState<ServiceMethod | ''>(letter.service_method ?? '')
  const [serviceRef, setServiceRef]       = useState(letter.service_reference ?? '')
  const [servedDate, setServedDate]       = useState(letter.served_date ?? new Date().toISOString().slice(0, 10))

  const status = letter.status
  const actor = (id: string | null) => (id ? (actorNames[id] ?? id.slice(0, 8)) : '—')

  const run = (payload: LetterLifecycleInput) => {
    setError(null)
    startTransition(async () => {
      const r = await letterLifecycleAction(projectId, letter.id, payload)
      if (!r.ok) { setError(r.error); return }
      setMode(null)
      router.refresh()
    })
  }

  const onUpload = (file: File) => {
    setError(null)
    const fd = new FormData(); fd.append('file', file)
    startTransition(async () => {
      const r = await addAttachmentAction(projectId, letter.id, fd)
      if (!r.ok) setError(r.error)
      router.refresh()
    })
  }
  const onDelete = (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return
    setError(null)
    startTransition(async () => {
      const r = await deleteAttachmentAction(projectId, letter.id, attachmentId)
      if (!r.ok) setError(r.error)
      router.refresh()
    })
  }

  return (
    <div className="jbcc-page-fade" style={{ maxWidth: 900, margin: '0 auto', padding: '48px clamp(16px,4vw,40px) 96px' }}>
      <Link href={`/projects/${projectId}/jbcc/tracking`} className="jbcc-back-link" style={backLink}>← Tracking</Link>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={eyebrow}>
          {letter.letter_reference ?? notice?.code ?? '—'}
          {letter.revision > 1 && <span style={{ color: 'var(--c-text-muted)' }}>· Rev {letter.revision}</span>}
          <span style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)', maxWidth: 80 }} />
        </div>
        <h1 style={h1Style}>{letter.subject ?? notice?.title ?? 'Letter'}</h1>
        <div style={metaRow}>
          <span>{notice?.code} · {notice?.title}</span>
          {letter.trigger_date && <span>Trigger: {letter.trigger_date}</span>}
          {letter.deadline_date && <span>Deadline: {letter.deadline_date}</span>}
          <span className={`jbcc-chip jbcc-status-${status}`} style={{ marginLeft: 'auto' }}>{status.replace(/_/g, ' ')}</span>
          {letter.legal_hold && <span className="jbcc-chip" style={{ background: 'var(--c-red-dim-rgb, rgba(255,107,107,.14))', color: 'var(--c-red-bright)' }}>legal hold</span>}
        </div>
      </div>

      {error && <div role="alert" style={errBox}>{error}</div>}

      {/* Controlled-document register */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Controlled Document · ISO 9001</div>
        <dl style={dl}>
          <Row k="Document reference" v={letter.letter_reference ?? '— (legacy)'} mono />
          <Row k="Revision" v={String(letter.revision)} />
          <Row k="Created by" v={`${actor(letter.created_by)} · ${fmt(letter.created_at)}`} />
          <Row k="Reviewed by" v={letter.reviewed_by ? `${actor(letter.reviewed_by)} · ${fmt(letter.reviewed_at)}` : '—'} />
          <Row k="Approved by" v={letter.approved_by ? `${actor(letter.approved_by)} · ${fmt(letter.approved_at)}` : '—'} />
          <Row k="Issued by" v={letter.issued_by ? `${actor(letter.issued_by)} · ${fmt(letter.issued_at)}` : '—'} />
          <Row k="Served by" v={letter.served_by ? `${actor(letter.served_by)} · ${fmt(letter.served_at)}` : '—'} />
          {letter.service_method && <Row k="Service method" v={letter.service_method.replace(/_/g, ' ')} />}
          {letter.service_reference && <Row k="Proof / tracking ref" v={letter.service_reference} mono />}
          {letter.deemed_service_date && <Row k="Deemed service date" v={letter.deemed_service_date} />}
        </dl>
      </section>

      {/* Document */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Letter Document</div>
        {letterUrl ? (
          <a href={letterUrl} download className="jbcc-btn-cta" style={{ display: 'inline-block', textDecoration: 'none', background: 'transparent', color: 'var(--c-amber)', borderColor: 'var(--c-amber)', fontSize: 10, padding: '8px 14px' }}>
            Download branded .docx ↓
          </a>
        ) : <p style={muted}>Signed URL unavailable</p>}
        {status !== 'draft' && (
          <p style={{ ...muted, marginTop: 10 }}>This document is issued and frozen — its content can no longer be edited (ISO 7.5.3).</p>
        )}
      </section>

      {/* Lifecycle actions */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Lifecycle</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {status === 'draft' && <>
            <Btn onClick={() => run({ action: 'submit_for_review' })} disabled={busy}>Submit for review</Btn>
            <Btn onClick={() => run({ action: 'approve' })} disabled={busy}>Approve</Btn>
            <Btn onClick={() => setMode(mode === 'issue' ? null : 'issue')} disabled={busy} primary>Issue…</Btn>
            <Btn onClick={() => run({ action: 'withdraw' })} disabled={busy} subtle>Withdraw</Btn>
            <Btn onClick={() => run({ action: 'soft_delete' })} disabled={busy} danger>Archive</Btn>
          </>}
          {status === 'in_review' && <>
            <Btn onClick={() => run({ action: 'approve' })} disabled={busy} primary>Approve</Btn>
            <Btn onClick={() => run({ action: 'revert_to_draft' })} disabled={busy} subtle>Revert to draft</Btn>
            <Btn onClick={() => run({ action: 'withdraw' })} disabled={busy} subtle>Withdraw</Btn>
          </>}
          {status === 'approved' && <>
            <Btn onClick={() => setMode(mode === 'issue' ? null : 'issue')} disabled={busy} primary>Issue…</Btn>
            <Btn onClick={() => run({ action: 'revert_to_draft' })} disabled={busy} subtle>Revert to draft</Btn>
            <Btn onClick={() => run({ action: 'withdraw' })} disabled={busy} subtle>Withdraw</Btn>
          </>}
          {status === 'issued' && (
            <Btn onClick={() => setMode(mode === 'serve' ? null : 'serve')} disabled={busy} primary>Mark served…</Btn>
          )}
          {status === 'served' && <p style={{ ...muted, color: 'var(--c-green)' }}>Served — lifecycle complete.</p>}
          {(status === 'withdrawn' || status === 'superseded') && <p style={muted}>Terminal status — no further transitions.</p>}

          {/* Legal hold toggle always available */}
          <span style={{ marginLeft: 'auto' }}>
            {letter.legal_hold
              ? <Btn onClick={() => run({ action: 'clear_legal_hold' })} disabled={busy} subtle>Clear legal hold</Btn>
              : <Btn onClick={() => run({ action: 'set_legal_hold' })} disabled={busy} subtle>Place legal hold</Btn>}
          </span>
        </div>

        {mode === 'issue' && (
          <div style={inlineForm}>
            <div>
              <label className="jbcc-label" htmlFor="issued-date">Issue date</label>
              <input id="issued-date" type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)} className="jbcc-input" style={{ width: 170 }} />
            </div>
            <Btn onClick={() => run({ action: 'issue', issued_date: issuedDate })} disabled={busy} primary>Confirm issue</Btn>
            <p style={{ ...muted, flexBasis: '100%' }}>Issuing freezes the letter’s content permanently and records you as the issuer.</p>
          </div>
        )}
        {mode === 'serve' && (
          <div style={inlineForm}>
            <div>
              <label className="jbcc-label" htmlFor="svc-method">Service method</label>
              <select id="svc-method" value={serviceMethod} onChange={e => setServiceMethod(e.target.value as ServiceMethod)} className="jbcc-input" style={{ appearance: 'none', width: 180 }}>
                <option value="">Select…</option>
                <option value="hand">Hand delivery</option>
                <option value="email">Email</option>
                <option value="registered_post">Registered post</option>
              </select>
            </div>
            <div>
              <label className="jbcc-label" htmlFor="svc-date">Served date</label>
              <input id="svc-date" type="date" value={servedDate} onChange={e => setServedDate(e.target.value)} className="jbcc-input" style={{ width: 170 }} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="jbcc-label" htmlFor="svc-ref">Proof / tracking reference</label>
              <input id="svc-ref" type="text" value={serviceRef} onChange={e => setServiceRef(e.target.value)} className="jbcc-input" placeholder="e.g. registered slip RD1234" />
            </div>
            <Btn onClick={() => run({ action: 'mark_served', service_method: serviceMethod || null, served_date: servedDate, service_reference: serviceRef || null })} disabled={busy || !serviceMethod} primary>Confirm served</Btn>
          </div>
        )}
      </section>

      {/* Distribution */}
      {recipients.length > 0 && (
        <section className="jbcc-panel">
          <div className="jbcc-panel-title">Distribution</div>
          <ul style={listReset}>
            {recipients.map(r => (
              <li key={r.id} style={rowLine}>
                <span style={{ fontFamily: 'var(--f-mono-display)', fontSize: 11 }}>{r.party_name_snapshot}</span>
                <span className="jbcc-chip" style={{ textTransform: 'uppercase' }}>{r.disposition}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Attachments */}
      <section className="jbcc-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="jbcc-panel-title" style={{ marginBottom: 0 }}>Attachments · Proof of Service</div>
          <button onClick={() => fileInput.current?.click()} disabled={busy} className="jbcc-btn-cta" style={{ fontSize: 10, padding: '6px 12px' }}>+ Add File</button>
        </div>
        <input ref={fileInput} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { onUpload(f); e.target.value = '' } }} />
        {attachments.length === 0 ? <p style={muted}>No attachments yet</p> : (
          <ul style={{ ...listReset, gap: 1, background: 'var(--c-border)' }}>
            {attachments.map(a => (
              <li key={a.id} style={{ background: 'var(--c-panel)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                {a.signedUrl
                  ? <a href={a.signedUrl} download={a.file_name} style={{ fontFamily: 'var(--f-mono-display)', fontSize: 11, color: 'var(--c-amber)', textDecoration: 'none' }}>{a.file_name}</a>
                  : <span style={{ fontFamily: 'var(--f-mono-display)', fontSize: 11, color: 'var(--c-text-muted)' }}>{a.file_name}</span>}
                <button disabled={busy} onClick={() => onDelete(a.id)} className="jbcc-btn-cta jbcc-btn-cta--danger" style={{ fontSize: 10, padding: '4px 10px' }}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Audit trail */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Audit Trail</div>
        {events.length === 0 ? <p style={muted}>No recorded events</p> : (
          <ol style={{ ...listReset, gap: 0 }}>
            {events.map(ev => (
              <li key={ev.id} style={timelineRow}>
                <span style={dot} />
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--c-text)' }}>
                    {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                    {ev.from_status && ev.to_status && ev.from_status !== ev.to_status &&
                      <span style={{ color: 'var(--c-text-muted)' }}> · {ev.from_status} → {ev.to_status}</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--f-mono-display)', fontSize: 10.5, color: 'var(--c-text-muted)', marginTop: 2 }}>
                    {actor(ev.actor_id)} · {fmt(ev.occurred_at)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

// ── small components ──
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'contents' }}>
      <dt style={{ fontFamily: 'var(--f-mono-display)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', padding: '6px 0' }}>{k}</dt>
      <dd style={{ margin: 0, fontSize: 12.5, color: 'var(--c-text)', padding: '6px 0', fontFamily: mono ? 'var(--f-mono-display)' : undefined }}>{v}</dd>
    </div>
  )
}
function Btn({ children, onClick, disabled, primary, subtle, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; subtle?: boolean; danger?: boolean }) {
  const base: React.CSSProperties = { fontSize: 10, padding: '8px 14px' }
  let s: React.CSSProperties = { background: 'transparent', color: 'var(--c-text)', borderColor: 'var(--c-border)' }
  if (primary) s = { background: disabled ? 'transparent' : 'var(--c-amber)', color: disabled ? 'var(--c-text-muted)' : 'var(--c-base)', borderColor: disabled ? 'var(--c-border)' : 'var(--c-amber)' }
  if (subtle) s = { background: 'transparent', color: 'var(--c-text-muted)', borderColor: 'var(--c-border)' }
  if (danger) s = { background: 'transparent', color: 'var(--c-red-bright)', borderColor: 'var(--c-red)' }
  return <button onClick={onClick} disabled={disabled} className="jbcc-btn-cta" style={{ ...base, ...s }}>{children}</button>
}

// ── styles ──
const backLink: React.CSSProperties = { display: 'inline-block', fontFamily: 'var(--f-mono-display)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-text-muted)', textDecoration: 'none', marginBottom: 28 }
const eyebrow: React.CSSProperties = { fontFamily: 'var(--f-mono-display)', fontSize: 11, fontWeight: 500, letterSpacing: '0.2em', color: 'var(--c-amber)', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }
const h1Style: React.CSSProperties = { fontFamily: 'var(--f-display)', fontStyle: 'italic', fontWeight: 350, fontSize: 'clamp(22px, 3.2vw, 40px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--c-text)', fontVariationSettings: "'opsz' 72, 'SOFT' 30", margin: '0 0 14px' }
const metaRow: React.CSSProperties = { display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontFamily: 'var(--f-mono-display)', fontSize: 11, color: 'var(--c-text-muted)', letterSpacing: '0.04em', borderTop: '1px solid var(--c-border)', paddingTop: 14 }
const dl: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', columnGap: 24, rowGap: 0, margin: 0 }
const errBox: React.CSSProperties = { marginBottom: 24, padding: '12px 16px', background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))', border: '1px solid var(--c-red)', fontFamily: 'var(--f-mono-display)', fontSize: 12, color: 'var(--c-red-bright)' }
const muted: React.CSSProperties = { fontFamily: 'var(--f-mono-display)', fontSize: 11, color: 'var(--c-text-muted)', letterSpacing: '0.04em' }
const inlineForm: React.CSSProperties = { display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--c-border)' }
const listReset: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }
const rowLine: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const timelineRow: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderLeft: '1px solid var(--c-border)', paddingLeft: 16, marginLeft: 4 }
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', background: 'var(--c-amber)', marginTop: 5, marginLeft: -20, flexShrink: 0 }
