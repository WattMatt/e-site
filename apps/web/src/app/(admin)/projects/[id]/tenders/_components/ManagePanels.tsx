'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  addRequirementAction,
  answerClarificationAction,
  publishAddendumAction,
  removeRequirementAction,
  type ClarificationRow,
  type RequirementRow,
  type SubmissionRow,
} from '@/actions/tender-manage.actions'

type Msg = { ok: boolean; text: string } | null

function useRunner() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  async function run(fn: () => Promise<{ data: unknown } | { error: string }>, ok?: string) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      if (ok) setMsg({ ok: true, text: ok })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, run }
}

const Feedback = ({ msg }: { msg: Msg }) =>
  msg ? <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p> : null

export function RequirementsPanel({ tenderId, requirements, editable }: { tenderId: string; requirements: RequirementRow[]; editable: boolean }) {
  const { busy, msg, run } = useRunner()
  const [draft, setDraft] = useState({ kind: 'document' as 'document' | 'declaration', label: '', detail: '', mandatory: true })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Documents and declarations required ({requirements.length})</span></CardHeader>
      <CardBody>
        <ul style={{ margin: 0, fontSize: 14 }}>
          {requirements.map((r) => (
            <li key={r.id}>
              {r.kind === 'declaration' ? 'Declaration: ' : 'Document: '}{r.label}{r.mandatory ? ' (required)' : ' (optional)'}{r.detail ? ` — ${r.detail}` : ''}{' '}
              {editable && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => removeRequirementAction(tenderId, r.id))}>Remove</button>}
            </li>
          ))}
        </ul>
        {editable ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 10 }}>
            <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'document' | 'declaration' })}>
              <option value="document">Document to upload</option>
              <option value="declaration">Declaration to accept</option>
            </select>
            <input aria-label="Label" placeholder="e.g. CIDB certificate" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <input aria-label="Detail" placeholder="Detail (optional)" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={draft.mandatory} onChange={(e) => setDraft({ ...draft, mandatory: e.target.checked })} /> required</label>
            <Button disabled={busy || !draft.label.trim()} onClick={() => run(() => addRequirementAction(tenderId, draft)).then(() => setDraft({ ...draft, label: '', detail: '' }))}>Add</Button>
          </div>
        ) : (
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>Frozen since the tender was issued. Use an addendum for changes.</p>
        )}
        <Feedback msg={msg} />
      </CardBody>
    </Card>
  )
}

export function ClarificationsPanel({ tenderId, clarifications, canPublishAddendum }: { tenderId: string; clarifications: ClarificationRow[]; canPublishAddendum: boolean }) {
  const { busy, msg, run } = useRunner()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [addendum, setAddendum] = useState({ title: '', body: '' })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Clarifications and addenda ({clarifications.length})</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
          {clarifications.map((c) => (
            <li key={c.id} style={{ borderLeft: `3px solid ${c.kind === 'addendum' ? 'var(--c-amber)' : 'var(--c-border)'}`, paddingLeft: 8 }}>
              <strong>{c.kind === 'addendum' ? 'Addendum' : `Question from ${c.company ?? 'a bidder'}`}: {c.title}</strong>{' '}
              {c.published_at ? <Badge variant="success">published to all bidders</Badge> : <Badge variant="ghost">private</Badge>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              {c.kind === 'question' && c.published_at && (
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}><strong>Answer (final):</strong> {c.answer}</div>
              )}
              {c.kind === 'question' && !c.published_at && (
                <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                  <textarea aria-label="Answer" rows={2} value={answers[c.id] ?? c.answer ?? ''} onChange={(e) => setAnswers({ ...answers, [c.id]: e.target.value })} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => answerClarificationAction(tenderId, c.id, answers[c.id] ?? c.answer ?? '', false), 'Answered privately.')}>Answer privately</Button>
                    <Button size="sm" disabled={busy} onClick={() => run(() => answerClarificationAction(tenderId, c.id, answers[c.id] ?? c.answer ?? '', true), 'Published to every bidder (without the asker’s name).')}>Answer and publish to all</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canPublishAddendum && (
          <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            <strong style={{ fontSize: 14 }}>Publish an addendum</strong>
            <input aria-label="Addendum title" placeholder="Addendum 1: …" value={addendum.title} onChange={(e) => setAddendum({ ...addendum, title: e.target.value })} />
            <textarea aria-label="Addendum text" rows={3} value={addendum.body} onChange={(e) => setAddendum({ ...addendum, body: e.target.value })} />
            <p style={{ fontSize: 12, margin: 0 }}>Every bidder must acknowledge it before they can submit; a submitted bid returns to draft until they do. Once published it cannot be edited or withdrawn, and none can be published after the closing time.</p>
            <div><Button size="sm" disabled={busy || !addendum.title.trim() || !addendum.body.trim()} onClick={() => run(() => publishAddendumAction(tenderId, addendum.title, addendum.body), 'Addendum published.').then(() => setAddendum({ title: '', body: '' }))}>Publish addendum</Button></div>
          </div>
        )}
        <Feedback msg={msg} />
      </CardBody>
    </Card>
  )
}

export function SubmissionsPanel({ submissions, publishedAddenda, sealed }: { submissions: SubmissionRow[]; publishedAddenda: number; sealed: boolean }) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Bids ({submissions.filter((s) => s.status === 'submitted').length} submitted of {submissions.length} accepted)</span></CardHeader>
      <CardBody>
        {sealed && (
          <p style={{ marginTop: 0, fontSize: 13 }}>
            Prices and documents are sealed until the closing time. The database will not return them to anyone at WM before then.
          </p>
        )}
        {submissions.length === 0 ? (
          <p style={{ margin: 0 }}>No company has accepted an invitation yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Company</th><th>Profile</th><th>Status</th><th>Submitted</th><th>Addenda acknowledged</th></tr></thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.participantId}>
                    <td>{s.company}</td>
                    <td>{s.profileComplete ? 'complete' : 'incomplete'}</td>
                    <td><Badge variant={s.status === 'submitted' ? 'success' : s.status === 'draft' ? 'warning' : 'ghost'}>{s.status}</Badge></td>
                    <td>{s.submittedAt ? new Date(s.submittedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '—'}{s.submissionCount > 1 ? ` (${s.submissionCount}×)` : ''}</td>
                    <td>{s.acknowledgedAddenda} / {publishedAddenda}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
