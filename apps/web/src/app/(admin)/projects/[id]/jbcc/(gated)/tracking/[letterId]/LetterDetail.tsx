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
    <div className="px-6 py-8 max-w-3xl space-y-6">
      {/* Back link */}
      <Link
        href={`/projects/${projectId}/jbcc/tracking`}
        className="text-xs opacity-60 hover:opacity-100"
      >
        ← Back to tracking
      </Link>

      {/* Header */}
      <div>
        <p className="font-mono text-xs opacity-60">{notice?.code ?? '—'}</p>
        <h1 className="text-xl font-semibold mt-0.5">{notice?.title ?? 'Letter'}</h1>
        <div className="mt-2 flex gap-4 text-xs opacity-60">
          {letter.trigger_date && <span>Trigger: {letter.trigger_date}</span>}
          {letter.deadline_date && <span>Deadline: {letter.deadline_date}</span>}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Letter document */}
      <section className="border rounded-lg p-4">
        <h2 className="text-xs uppercase tracking-wide opacity-60 mb-3">Letter document</h2>
        {letterUrl ? (
          <a
            href={letterUrl}
            download
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            Download .docx
          </a>
        ) : (
          <p className="text-xs opacity-50">Signed URL unavailable.</p>
        )}
      </section>

      {/* Status flow */}
      <section className="border rounded-lg p-4">
        <h2 className="text-xs uppercase tracking-wide opacity-60 mb-3">Status</h2>
        <div className="space-y-3 text-sm">
          <p>Current: <strong>{status}</strong></p>

          {status === 'draft' && (
            <div className="flex gap-2 items-end flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-xs opacity-60">Service method</span>
                <select
                  value={serviceMethod}
                  onChange={e => setServiceMethod(e.target.value as ServiceMethod)}
                  className="border rounded px-2 py-1 text-xs"
                >
                  <option value="">Select…</option>
                  <option value="hand">Hand delivery</option>
                  <option value="email">Email</option>
                  <option value="registered_post">Registered post</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs opacity-60">Issued date</span>
                <input
                  type="date"
                  value={issuedDate}
                  onChange={e => setIssuedDate(e.target.value)}
                  className="border rounded px-2 py-1 text-xs"
                />
              </label>
              <button
                disabled={busy || !serviceMethod}
                onClick={() => saveStatus('issued')}
                className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                Mark issued
              </button>
            </div>
          )}

          {status === 'issued' && (
            <button
              disabled={busy}
              onClick={() => saveStatus('served')}
              className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Mark served (delivery confirmed)
            </button>
          )}

          {status === 'served' && (
            <p className="text-xs text-green-700">Served — no further transitions.</p>
          )}
        </div>
      </section>

      {/* Attachments */}
      <section className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Attachments — proof of service / supporting docs
          </h2>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="px-3 py-1 rounded-md border text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            + Add file
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              onUpload(file)
              e.target.value = ''
            }
          }}
        />

        {attachments.length === 0 ? (
          <p className="text-xs opacity-50">No attachments yet.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map(a => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                {a.signedUrl ? (
                  <a
                    href={a.signedUrl}
                    download={a.file_name}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    {a.file_name}
                  </a>
                ) : (
                  <span className="text-xs opacity-60">{a.file_name}</span>
                )}
                <button
                  disabled={busy}
                  onClick={() => onDelete(a.id)}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 ml-4"
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
