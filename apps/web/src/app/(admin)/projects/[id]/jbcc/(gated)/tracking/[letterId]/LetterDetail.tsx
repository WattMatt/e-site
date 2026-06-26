'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type {
  JbccLetter, JbccNotice, JbccLetterAttachment, ServiceMethod, LetterStatus,
} from '@esite/shared'
import {
  updateLetterStatusAction,
  addAttachmentAction,
  deleteAttachmentAction,
} from '@/actions/jbcc.actions'

interface Props {
  projectId: string
  letter: JbccLetter
  notice: JbccNotice | null
  letterUrl: string | null
  attachments: Array<JbccLetterAttachment & { signedUrl: string | null }>
}

export function LetterDetail({ projectId, letter, notice, letterUrl, attachments }: Props) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus]               = useState<LetterStatus>(letter.status)
  const [serviceMethod, setServiceMethod] = useState<ServiceMethod | ''>(letter.service_method ?? '')
  const [issuedDate, setIssuedDate]       = useState(letter.issued_date ?? '')

  const saveStatus = (next: LetterStatus) => {
    setError(null)
    startTransition(async () => {
      const result = await updateLetterStatusAction(projectId, letter.id, {
        status:         next,
        issued_date:    next === 'issued' || next === 'served'
          ? (issuedDate || new Date().toISOString().slice(0, 10))
          : null,
        service_method: next === 'issued' || next === 'served'
          ? (serviceMethod || null)
          : null,
      })
      if (!result.ok) { setError(result.error); return }
      setStatus(next)
      router.refresh()
    })
  }

  const onUpload = (file: File) => {
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const result = await addAttachmentAction(projectId, letter.id, fd)
      if (!result.ok) setError(result.error)
      router.refresh()
    })
  }

  const onDelete = (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return
    setError(null)
    startTransition(async () => {
      const result = await deleteAttachmentAction(projectId, letter.id, attachmentId)
      if (!result.ok) setError(result.error)
      router.refresh()
    })
  }

  return (
    <div
      className="jbcc-page-fade"
      style={{ maxWidth: 860, margin: '0 auto', padding: '48px 40px 96px', display: 'grid', gap: 0 }}
    >
      {/* Back breadcrumb */}
      <Link
        href={`/projects/${projectId}/jbcc/tracking`}
        className="jbcc-back-link"
        style={{
          display: 'inline-block',
          fontFamily: 'var(--f-mono-display)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--c-text-muted)',
          textDecoration: 'none',
          marginBottom: 32,
        }}
      >
        ← Tracking
      </Link>

      {/* Page header */}
      <div style={{ marginBottom: 40 }}>
        <div
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.24em',
            color: 'var(--c-amber)',
            textTransform: 'uppercase',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {notice?.code ?? '—'}
          <span
            style={{
              height: 1,
              flex: 1,
              background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)',
              maxWidth: 80,
            }}
          />
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontWeight: 350,
            fontSize: 'clamp(24px, 3.5vw, 44px)',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'var(--c-text)',
            fontVariationSettings: "'opsz' 72, 'SOFT' 30",
            margin: '0 0 14px',
          }}
        >
          {notice?.title ?? 'Letter'}
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 24,
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            color: 'var(--c-text-muted)',
            letterSpacing: '0.04em',
            borderTop: '1px solid var(--c-border)',
            paddingTop: 14,
          }}
        >
          {letter.trigger_date && <span>Trigger: {letter.trigger_date}</span>}
          {letter.deadline_date && <span>Deadline: {letter.deadline_date}</span>}
          <span
            className={`jbcc-chip jbcc-status-${status}`}
            style={{ marginLeft: 'auto' }}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginBottom: 24,
            padding: '12px 16px',
            background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))',
            border: '1px solid var(--c-red)',
            fontFamily: 'var(--f-mono-display)',
            fontSize: 12,
            color: 'var(--c-red-bright)',
          }}
        >
          {error}
        </div>
      )}

      {/* Letter document panel */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Letter Document</div>
        {letterUrl ? (
          <a
            href={letterUrl}
            download
            className="jbcc-btn-cta"
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              background: 'transparent',
              color: 'var(--c-amber)',
              borderColor: 'var(--c-amber)',
              fontSize: 10,
              padding: '8px 14px',
            }}
          >
            Download .docx ↓
          </a>
        ) : (
          <p
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 11,
              color: 'var(--c-text-muted)',
            }}
          >
            Signed URL unavailable
          </p>
        )}
      </section>

      {/* Status flow panel */}
      <section className="jbcc-panel">
        <div className="jbcc-panel-title">Status Flow</div>

        {status === 'draft' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label className="jbcc-label" htmlFor="service-method">Service method</label>
              <select
                id="service-method"
                value={serviceMethod}
                onChange={e => setServiceMethod(e.target.value as ServiceMethod)}
                className="jbcc-input"
                style={{ appearance: 'none', width: 200 }}
              >
                <option value="">Select…</option>
                <option value="hand">Hand delivery</option>
                <option value="email">Email</option>
                <option value="registered_post">Registered post</option>
              </select>
            </div>
            <div>
              <label className="jbcc-label" htmlFor="issued-date">Issued date</label>
              <input
                id="issued-date"
                type="date"
                value={issuedDate}
                onChange={e => setIssuedDate(e.target.value)}
                className="jbcc-input"
                style={{ width: 160 }}
              />
            </div>
            <button
              disabled={busy || !serviceMethod}
              onClick={() => saveStatus('issued')}
              className="jbcc-btn-cta"
              style={{
                background: busy || !serviceMethod ? 'transparent' : 'var(--c-amber)',
                color: busy || !serviceMethod ? 'var(--c-text-muted)' : 'var(--c-base)',
                borderColor: busy || !serviceMethod ? 'var(--c-border)' : 'var(--c-amber)',
              }}
            >
              Mark Issued
            </button>
          </div>
        )}

        {status === 'issued' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              disabled={busy}
              onClick={() => saveStatus('served')}
              className="jbcc-btn-cta"
              style={{
                background: busy ? 'transparent' : 'var(--c-green)',
                color: busy ? 'var(--c-text-muted)' : 'var(--c-base)',
                borderColor: busy ? 'var(--c-border)' : 'var(--c-green)',
              }}
            >
              Mark Served (delivery confirmed)
            </button>
          </div>
        )}

        {status === 'served' && (
          <p
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 11,
              color: 'var(--c-green)',
              letterSpacing: '0.06em',
            }}
          >
            Served — no further transitions
          </p>
        )}
      </section>

      {/* Attachments panel */}
      <section className="jbcc-panel">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div className="jbcc-panel-title" style={{ marginBottom: 0 }}>
            Attachments · Proof of Service
          </div>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="jbcc-btn-cta"
            style={{ fontSize: 10, padding: '6px 12px' }}
          >
            + Add File
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              onUpload(file)
              e.target.value = ''
            }
          }}
        />

        {attachments.length === 0 ? (
          <p
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 11,
              color: 'var(--c-text-muted)',
              letterSpacing: '0.04em',
            }}
          >
            No attachments yet
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 1,
              background: 'var(--c-border)',
            }}
          >
            {attachments.map(a => (
              <li
                key={a.id}
                style={{
                  background: 'var(--c-panel)',
                  padding: '10px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {a.signedUrl ? (
                  <a
                    href={a.signedUrl}
                    download={a.file_name}
                    style={{
                      fontFamily: 'var(--f-mono-display)',
                      fontSize: 11,
                      color: 'var(--c-amber)',
                      textDecoration: 'none',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {a.file_name}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--f-mono-display)',
                      fontSize: 11,
                      color: 'var(--c-text-muted)',
                    }}
                  >
                    {a.file_name}
                  </span>
                )}
                <button
                  disabled={busy}
                  onClick={() => onDelete(a.id)}
                  className="jbcc-btn-cta jbcc-btn-cta--danger"
                  style={{ fontSize: 10, padding: '4px 10px' }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
