'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import {
  getTenderDocumentUploadUrlAction,
  getWmTenderDocumentUrlAction,
  listTenderDocumentsAction,
  registerTenderDocumentAction,
  removeTenderDocumentAction,
  updateTenderDocumentAction,
  type TenderDocumentWithReceipts,
} from '@/actions/tender-documents.actions'
import { formatFileSize, TENDER_DOCUMENT_CATEGORIES, tenderDocumentCategoryLabel } from '@/lib/tender/documents'

/**
 * The documents issued WITH the tender (specifications, drawings, P&G,
 * conditions of tender). Free while the tender is a draft; frozen at issue —
 * a later document rides an addendum (ClarificationsPanel). The panel keeps
 * its own copy and re-reads after every action (router.refresh() can stay
 * suspended on this page).
 */
export function DocumentsPanel({
  tenderId,
  initial,
  participants,
  isDraft,
}: {
  tenderId: string
  initial: TenderDocumentWithReceipts[]
  participants: number
  isDraft: boolean
}) {
  const [docs, setDocs] = useState(initial)
  useEffect(() => setDocs(initial), [initial])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [draft, setDraft] = useState<{ category: string; label: string; file: File | null }>({ category: 'specification', label: '', file: null })
  const fileInput = useRef<HTMLInputElement>(null)

  async function reload() {
    const r = await listTenderDocumentsAction(tenderId)
    if ('data' in r) setDocs(r.data.documents)
  }

  async function run(fn: () => Promise<{ error: string } | { data: unknown }>, ok?: string) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      if (ok) setMsg({ ok: true, text: ok })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const file = draft.file
      if (!file) return { error: 'Choose a file' }
      const label = draft.label.trim() || file.name.replace(/\.[^.]+$/, '')
      const signed = await getTenderDocumentUploadUrlAction(tenderId, file.name, file.size)
      if ('error' in signed) return signed
      const { error } = await createClient().storage.from('tender-files').uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (error) return { error: 'Upload failed. Try again.' }
      const r = await registerTenderDocumentAction(tenderId, {
        clarificationId: null,
        category: draft.category,
        label,
        fileName: file.name,
        path: signed.data.path,
        contentType: file.type || null,
      })
      if ('error' in r) return r
      setDraft({ category: draft.category, label: '', file: null })
      if (fileInput.current) fileInput.current.value = ''
      return { data: true }
    }, 'Document added.')

  const pack = docs.filter((d) => d.clarification_id == null)

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Tender documents ({pack.length})</span></CardHeader>
      <CardBody>
        <p style={{ marginTop: 0, fontSize: 13 }}>
          Issued with the tender: specifications, drawings, P&amp;G and the conditions of tender. Bidders download them
          from the portal, and every download is receipted per company.
          {isDraft ? '' : ' The issued pack is frozen; a new or revised document goes out as an addendum below.'}
        </p>
        {pack.length === 0 ? (
          <p style={{ margin: '0 0 8px', color: 'var(--c-text-muted)' }}>No documents yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Document</th><th>Category</th><th>File</th><th>Downloaded by</th><th /></tr></thead>
              <tbody>
                {pack.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {isDraft ? (
                        <input
                          aria-label={`Label for ${d.file_name}`}
                          defaultValue={d.label}
                          onBlur={(e) => {
                            const label = e.target.value.trim()
                            if (label && label !== d.label) run(() => updateTenderDocumentAction(tenderId, d.id, { label }))
                          }}
                          style={{ width: '100%', minWidth: 160 }}
                        />
                      ) : (
                        d.label
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <select
                          aria-label={`Category for ${d.label}`}
                          value={d.category}
                          disabled={busy}
                          onChange={(e) => run(() => updateTenderDocumentAction(tenderId, d.id, { category: e.target.value }))}
                        >
                          {TENDER_DOCUMENT_CATEGORIES.filter((c) => c.value !== 'addendum').map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      ) : (
                        tenderDocumentCategoryLabel(d.category)
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => run(async () => {
                          const r = await getWmTenderDocumentUrlAction(tenderId, d.id)
                          if ('error' in r) return r
                          window.location.href = r.data.url
                          return { data: true }
                        })}
                      >
                        {d.file_name}
                      </button>{' '}
                      <span style={{ color: 'var(--c-text-muted)' }}>{formatFileSize(d.file_size)}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{isDraft ? '—' : `${d.downloadedBy} / ${participants}`}</td>
                    <td>
                      {isDraft && (
                        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => removeTenderDocumentAction(tenderId, d.id), 'Removed.')}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isDraft && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <select aria-label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {TENDER_DOCUMENT_CATEGORIES.filter((c) => c.value !== 'addendum').map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input aria-label="Document label" placeholder="Label (file name if blank)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <input ref={fileInput} aria-label="Document file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xlsm,.doc,.docx,.dwg,.dxf,.zip" onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} />
            <Button size="sm" isLoading={busy} disabled={!draft.file} onClick={add}>Add document</Button>
          </div>
        )}
        {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: '8px 0 0', fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
      </CardBody>
    </Card>
  )
}
