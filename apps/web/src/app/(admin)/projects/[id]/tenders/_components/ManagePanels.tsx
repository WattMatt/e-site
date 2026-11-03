'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import {
  addRequirementAction,
  answerClarificationAction,
  createAddendumAction,
  discardAddendumDraftAction,
  getTenderManagementAction,
  publishAddendumDraftAction,
  removeRequirementAction,
  type ClarificationRow,
  type RequirementRow,
  type SubmissionRow,
} from '@/actions/tender-manage.actions'
import {
  getTenderDocumentUploadUrlAction,
  listTenderDocumentsAction,
  registerTenderDocumentAction,
  removeTenderDocumentAction,
  type TenderDocumentWithReceipts,
} from '@/actions/tender-documents.actions'
import { formatFileSize } from '@/lib/tender/documents'

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
  const [draft, setDraft] = useState({ kind: 'document' as 'document' | 'declaration', label: '', detail: '', mandatory: true, cidbCertificate: false })
  const mentionsCidb = (label: string) => /\bcidb\b/i.test(label)
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Documents and declarations required ({requirements.length})</span></CardHeader>
      <CardBody>
        <ul style={{ margin: 0, fontSize: 14 }}>
          {requirements.map((r) => (
            <li key={r.id}>
              {r.kind === 'declaration' ? 'Declaration: ' : 'Document: '}{r.label}{r.mandatory ? ' (required)' : ' (optional)'}{r.detail ? ` — ${r.detail}` : ''}
              {r.cidb_certificate && <span style={{ fontSize: 12 }}> · CIDB certificate: not needed from bidders with no CIDB grading</span>}{' '}
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
            <input
              aria-label="Label"
              placeholder="e.g. CIDB certificate"
              value={draft.label}
              onChange={(e) => {
                const label = e.target.value
                // Naming the CIDB certificate ticks the waiver box; WM can untick it.
                setDraft({ ...draft, label, cidbCertificate: mentionsCidb(label) && !mentionsCidb(draft.label) ? true : draft.cidbCertificate })
              }}
            />
            <input aria-label="Detail" placeholder="Detail (optional)" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={draft.mandatory} onChange={(e) => setDraft({ ...draft, mandatory: e.target.checked })} /> required</label>
            {draft.kind === 'document' && (
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={draft.cidbCertificate} onChange={(e) => setDraft({ ...draft, cidbCertificate: e.target.checked })} /> this is the CIDB certificate (not needed from bidders with no CIDB grading)
              </label>
            )}
            <Button disabled={busy || !draft.label.trim()} onClick={() => run(() => addRequirementAction(tenderId, draft)).then(() => setDraft({ ...draft, label: '', detail: '', cidbCertificate: false }))}>Add</Button>
          </div>
        ) : (
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>Frozen since the tender was issued. Use an addendum for changes.</p>
        )}
        <Feedback msg={msg} />
      </CardBody>
    </Card>
  )
}

export function ClarificationsPanel({
  tenderId,
  clarifications,
  documents,
  canPublishAddendum,
}: {
  tenderId: string
  clarifications: ClarificationRow[]
  documents: TenderDocumentWithReceipts[]
  canPublishAddendum: boolean
}) {
  // Self-read, like InvitationsPanel: router.refresh() can stay suspended on
  // this page, and a draft addendum must appear the moment it is created.
  const [rows, setRows] = useState(clarifications)
  const [docs, setDocs] = useState(documents)
  useEffect(() => setRows(clarifications), [clarifications])
  useEffect(() => setDocs(documents), [documents])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [addendum, setAddendum] = useState({ title: '', body: '' })
  const [armed, setArmed] = useState<string | null>(null)

  async function reload() {
    const [m, d] = await Promise.all([getTenderManagementAction(tenderId), listTenderDocumentsAction(tenderId)])
    if ('data' in m) setRows(m.data.clarifications)
    if ('data' in d) setDocs(d.data.documents)
  }

  async function run(fn: () => Promise<{ data: unknown } | { error: string }>, ok?: string | ((r: never) => string)) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      if (ok) setMsg({ ok: true, text: typeof ok === 'function' ? ok(r as never) : ok })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const twoPress = (key: string, go: () => void) => {
    if (armed !== key) {
      setArmed(key)
      setTimeout(() => setArmed((a) => (a === key ? null : a)), 5000)
      return
    }
    setArmed(null)
    go()
  }

  const attach = (clarificationId: string, file: File) =>
    run(async () => {
      const signed = await getTenderDocumentUploadUrlAction(tenderId, file.name, file.size)
      if ('error' in signed) return signed
      const { error } = await createClient().storage.from('tender-files').uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (error) return { error: 'Upload failed. Try again.' }
      return registerTenderDocumentAction(tenderId, {
        clarificationId,
        category: 'addendum',
        label: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        path: signed.data.path,
        contentType: file.type || null,
      })
    })

  const emailedText = (verb: string) => (r: { data: { emailed: number } }) =>
    `${verb}.${r.data.emailed ? ` Emailed ${r.data.emailed} tenderer(s).` : ''}`

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Clarifications and addenda ({rows.length})</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
          {rows.map((c) => {
            const attachments = docs.filter((d) => d.clarification_id === c.id)
            const isDraftAddendum = c.kind === 'addendum' && !c.published_at
            return (
              <li key={c.id} style={{ borderLeft: `3px solid ${c.kind === 'addendum' ? 'var(--c-amber)' : 'var(--c-border)'}`, paddingLeft: 8 }}>
                <strong>{c.kind === 'addendum' ? 'Addendum' : `Question from ${c.company ?? 'a bidder'}`}: {c.title}</strong>{' '}
                {c.published_at ? <Badge variant="success">published to all bidders</Badge> : c.kind === 'addendum' ? <Badge variant="warning">draft — bidders cannot see it</Badge> : <Badge variant="ghost">private</Badge>}
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                {attachments.length > 0 && (
                  <ul style={{ margin: '4px 0' }}>
                    {attachments.map((d) => (
                      <li key={d.id}>
                        📎 {d.label} — {d.file_name} ({formatFileSize(d.file_size)}){' '}
                        {isDraftAddendum && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => removeTenderDocumentAction(tenderId, d.id))}>Remove</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {isDraftAddendum && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                    <label style={{ fontSize: 13 }}>
                      Attach a file <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xlsm,.doc,.docx,.dwg,.dxf,.zip" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(c.id, f); e.target.value = '' }} />
                    </label>
                    <Button size="sm" disabled={busy || !canPublishAddendum} onClick={() => twoPress(`pub-${c.id}`, () => run(() => publishAddendumDraftAction(tenderId, c.id), emailedText('Addendum published')))}>
                      {armed === `pub-${c.id}` ? 'Tap again to publish to every bidder' : 'Publish addendum'}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => twoPress(`del-${c.id}`, () => run(() => discardAddendumDraftAction(tenderId, c.id), 'Draft discarded.'))}>
                      {armed === `del-${c.id}` ? 'Tap again to discard' : 'Discard draft'}
                    </Button>
                  </div>
                )}
                {c.kind === 'question' && c.published_at && (
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}><strong>Answer (final):</strong> {c.answer}</div>
                )}
                {c.kind === 'question' && !c.published_at && (
                  <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                    <textarea aria-label="Answer" rows={2} value={answers[c.id] ?? c.answer ?? ''} onChange={(e) => setAnswers({ ...answers, [c.id]: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => answerClarificationAction(tenderId, c.id, answers[c.id] ?? c.answer ?? '', false), 'Answered privately.')}>Answer privately</Button>
                      <Button size="sm" disabled={busy} onClick={() => run(() => answerClarificationAction(tenderId, c.id, answers[c.id] ?? c.answer ?? '', true), emailedText('Published to every bidder (without the asker’s name)'))}>Answer and publish to all</Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {canPublishAddendum && (
          <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            <strong style={{ fontSize: 14 }}>New addendum</strong>
            <input aria-label="Addendum title" placeholder="Addendum 1: …" value={addendum.title} onChange={(e) => setAddendum({ ...addendum, title: e.target.value })} />
            <textarea aria-label="Addendum text" rows={3} value={addendum.body} onChange={(e) => setAddendum({ ...addendum, body: e.target.value })} />
            <p style={{ fontSize: 12, margin: 0 }}>
              It starts as a draft, so you can attach revised drawings or specifications before anything goes out. Publishing emails
              every tenderer; each must acknowledge it before they can submit, and a submitted bid returns to draft until they do.
              Once published it is final.
            </p>
            <div><Button size="sm" disabled={busy || !addendum.title.trim() || !addendum.body.trim()} onClick={() => run(() => createAddendumAction(tenderId, addendum.title, addendum.body), 'Draft saved. Attach files, then publish.').then(() => setAddendum({ title: '', body: '' }))}>Save draft addendum</Button></div>
          </div>
        )}
        <Feedback msg={msg} />
      </CardBody>
    </Card>
  )
}

export function SubmissionsPanel({
  submissions,
  publishedAddenda,
  documentsVisible,
  sealed,
}: {
  submissions: SubmissionRow[]
  publishedAddenda: number
  documentsVisible: number
  sealed: boolean
}) {
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
              <thead><tr><th style={{ textAlign: 'left' }}>Company</th><th>Profile</th><th>Status</th><th>Submitted</th><th>Addenda acknowledged</th><th>Documents downloaded</th></tr></thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.participantId}>
                    <td>{s.company}</td>
                    <td>{s.profileComplete ? 'complete' : 'incomplete'}</td>
                    <td><Badge variant={s.status === 'submitted' ? 'success' : s.status === 'draft' ? 'warning' : 'ghost'}>{s.status}</Badge></td>
                    <td>{s.submittedAt ? new Date(s.submittedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '—'}{s.submissionCount > 1 ? ` (${s.submissionCount}×)` : ''}</td>
                    <td>{s.acknowledgedAddenda} / {publishedAddenda}</td>
                    <td>{documentsVisible ? `${s.documentsDownloaded} / ${documentsVisible}` : '—'}</td>
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
