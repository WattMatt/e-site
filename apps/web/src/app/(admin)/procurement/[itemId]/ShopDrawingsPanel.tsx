'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  uploadShopDrawingAction,
  decideShopDrawingAction,
  deleteShopDrawingAction,
} from '@/actions/shop-drawing.actions'

export interface ShopDrawingRow {
  id: string
  title: string
  revision: number
  file_path: string
  file_size_bytes: number | null
  file_mime: string | null
  status: 'pending_review' | 'approved' | 'revise_and_resubmit' | 'rejected'
  notes: string | null
  submitted_at: string
}

interface Props {
  procurementItemId: string
  organisationId: string
  drawings: ShopDrawingRow[]
}

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const MAX_BYTES = 50 * 1024 * 1024

const STATUS_LABEL: Record<ShopDrawingRow['status'], string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  revise_and_resubmit: 'Revise & resubmit',
  rejected: 'Rejected',
}

const STATUS_TONE: Record<ShopDrawingRow['status'], string> = {
  pending_review: 'badge-warning',
  approved: 'badge-success',
  revise_and_resubmit: 'badge-info',
  rejected: 'badge-error',
}

function extFromMime(m: string | null): string {
  if (!m) return 'bin'
  switch (m) {
    case 'application/pdf': return 'pdf'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/tiff': return 'tif'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx'
    default: return 'bin'
  }
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function ShopDrawingsPanel({ procurementItemId, organisationId, drawings }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setFile(null); setTitle(''); setNotes(''); setError(null)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setFile(null); return }
    if (f.size > MAX_BYTES) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`)
      e.target.value = ''
      return
    }
    if (!ALLOWED_MIMES.has(f.type)) {
      setError(`Unsupported file type: ${f.type || 'unknown'}.`)
      e.target.value = ''
      return
    }
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) { setError('Pick a drawing file'); return }
    if (title.trim().length < 2) { setError('Title required'); return }

    startTransition(async () => {
      const supabase = createClient()
      const path = `${organisationId}/${procurementItemId}/${crypto.randomUUID()}.${extFromMime(file.type)}`
      const { error: upErr } = await supabase.storage
        .from('shop-drawings')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) { setError(`Upload failed: ${upErr.message}`); return }

      const res = await uploadShopDrawingAction({
        procurementItemId,
        title: title.trim(),
        filePath: path,
        fileSizeBytes: file.size,
        fileMime: file.type,
        notes: notes.trim() || null,
      })
      if (res.error) {
        await supabase.storage.from('shop-drawings').remove([path]).catch(() => {})
        setError(res.error)
        return
      }
      reset(); setOpen(false); router.refresh()
    })
  }

  async function onDownload(d: ShopDrawingRow) {
    const supabase = createClient()
    const { data, error } = await supabase.storage
      .from('shop-drawings')
      .createSignedUrl(d.file_path, 3600, {
        download: `${d.title}-rev${d.revision}.${extFromMime(d.file_mime)}`,
      })
    if (error || !data?.signedUrl) {
      alert(`Cannot download: ${error?.message ?? 'no URL'}`)
      return
    }
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
  }

  function onDecide(id: string, decision: 'approved' | 'revise_and_resubmit' | 'rejected') {
    const comments = decision === 'approved'
      ? null
      : window.prompt(decision === 'rejected'
          ? 'Reason for rejection (optional):'
          : 'What needs to change? (optional):',
        ) || null
    startTransition(async () => {
      const res = await decideShopDrawingAction({ shopDrawingId: id, decision, comments })
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function onDelete(id: string) {
    if (!confirm('Delete this shop drawing revision?')) return
    startTransition(async () => {
      const res = await deleteShopDrawingAction(id)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div>
      {!open ? (
        <button
          type="button"
          className="btn-primary-amber"
          onClick={() => setOpen(true)}
        >
          + Upload shop drawing
        </button>
      ) : (
        <form
          onSubmit={onUpload}
          style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: 14, background: 'var(--c-base)', borderRadius: 8,
            border: '1px solid var(--c-border)',
          }}
        >
          <div>
            <label className="ob-label" htmlFor="sd-file">Drawing file *</label>
            <input
              id="sd-file" type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.docx"
              onChange={onFileChange}
              className="ob-input"
              required
            />
            {file && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            )}
          </div>
          <div>
            <label className="ob-label" htmlFor="sd-title">Title *</label>
            <input
              id="sd-title" className="ob-input"
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. DB-01 Panel layout"
              maxLength={200}
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="sd-notes">Notes</label>
            <textarea
              id="sd-notes" className="ob-input" rows={2}
              value={notes} onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>
          {error && (
            <div role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { reset(); setOpen(false) }}
              className="btn-primary-amber"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
            >Cancel</button>
            <button type="submit" className="btn-primary-amber" disabled={pending || !file}>
              {pending ? 'Uploading…' : 'Submit revision'}
            </button>
          </div>
        </form>
      )}

      {drawings.length === 0 ? (
        <div style={{ padding: 18, color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic', marginTop: 12 }}>
          No shop drawings yet. Upload the first revision when ready for review.
        </div>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {drawings.map((d) => (
            <div
              key={d.id}
              style={{
                padding: 12,
                border: '1px solid var(--c-border)',
                borderRadius: 6,
                background: 'var(--c-base)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {d.title} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>rev {d.revision}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    Submitted {fmtDate(d.submitted_at)}
                  </div>
                  {d.notes && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-mid)', marginTop: 4, fontStyle: 'italic' }}>
                      {d.notes}
                    </div>
                  )}
                </div>
                <span className={`badge ${STATUS_TONE[d.status]}`}>{STATUS_LABEL[d.status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => onDownload(d)}
                  style={actionBtn}
                  title="Download"
                >↓ Download</button>
                {d.status === 'pending_review' && (
                  <>
                    <button
                      type="button"
                      onClick={() => onDecide(d.id, 'approved')}
                      disabled={pending}
                      style={{ ...actionBtn, color: '#16a34a' }}
                    >✓ Approve</button>
                    <button
                      type="button"
                      onClick={() => onDecide(d.id, 'revise_and_resubmit')}
                      disabled={pending}
                      style={actionBtn}
                    >↺ Revise</button>
                    <button
                      type="button"
                      onClick={() => onDecide(d.id, 'rejected')}
                      disabled={pending}
                      style={{ ...actionBtn, color: '#dc2626' }}
                    >✕ Reject</button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(d.id)}
                  disabled={pending}
                  style={{ ...actionBtn, color: '#dc2626', marginLeft: 'auto' }}
                  title="Delete"
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  color: 'var(--c-text-mid)',
  padding: '4px 10px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
}
