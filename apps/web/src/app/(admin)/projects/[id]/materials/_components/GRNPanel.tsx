'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordGRNAction, deleteGRNAction } from '@/actions/grn.actions'

export interface GRNRow {
  id: string
  delivered_at: string
  quantity_received: number
  condition: 'complete' | 'partial' | 'damaged'
  notes: string | null
  photo_paths: string[] | null
  signed_pod_path: string | null
  created_at: string
}

interface Props {
  procurementItemId: string
  organisationId: string
  procurementUnit: string | null
  procurementQuantity: number | null
  grns: GRNRow[]
}

const ALLOWED_PHOTO_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
])
const MAX_BYTES = 20 * 1024 * 1024

const CONDITION_LABEL: Record<GRNRow['condition'], string> = {
  complete: 'Complete',
  partial: 'Partial',
  damaged: 'Damaged',
}

const CONDITION_TONE: Record<GRNRow['condition'], string> = {
  complete: 'badge-success',
  partial: 'badge-warning',
  damaged: 'badge-error',
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function extFromMime(m: string): string {
  switch (m) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/heic': return 'heic'
    case 'application/pdf': return 'pdf'
    default: return 'bin'
  }
}

export function GRNPanel({
  procurementItemId, organisationId, procurementUnit, procurementQuantity, grns,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const [deliveredAt, setDeliveredAt] = useState(today)
  const [quantityReceived, setQuantityReceived] = useState('')
  const [condition, setCondition] = useState<GRNRow['condition']>('complete')
  const [notes, setNotes] = useState('')
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [signedPodFile, setSignedPodFile] = useState<File | null>(null)

  const totalReceived = grns.reduce((s, g) => s + Number(g.quantity_received ?? 0), 0)
  const outstanding =
    procurementQuantity != null ? Number(procurementQuantity) - totalReceived : null

  function reset() {
    setDeliveredAt(today)
    setQuantityReceived('')
    setCondition('complete')
    setNotes('')
    setPhotoFiles([])
    setSignedPodFile(null)
    setError(null)
  }

  function onPhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setError(null)
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        setError(`${f.name} too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB each.`)
        e.target.value = ''
        return
      }
      if (!ALLOWED_PHOTO_MIMES.has(f.type)) {
        setError(`${f.name}: unsupported (${f.type}).`)
        e.target.value = ''
        return
      }
    }
    setPhotoFiles(files)
  }

  function onPodChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setSignedPodFile(null); return }
    if (f.size > MAX_BYTES) {
      setError(`Signed POD too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`)
      e.target.value = ''
      return
    }
    if (!ALLOWED_PHOTO_MIMES.has(f.type)) {
      setError(`Signed POD unsupported (${f.type}).`)
      e.target.value = ''
      return
    }
    setSignedPodFile(f)
  }

  async function uploadOne(file: File): Promise<string | null> {
    const supabase = createClient()
    const path = `${organisationId}/${procurementItemId}/${crypto.randomUUID()}.${extFromMime(file.type)}`
    const { error } = await supabase.storage
      .from('grn-photos')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (error) {
      setError(`Upload failed: ${error.message}`)
      return null
    }
    return path
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const qty = Number(quantityReceived)
    if (!Number.isFinite(qty) || qty < 0) {
      setError('Quantity must be ≥ 0'); return
    }

    setUploading(true)
    const photoPaths: string[] = []
    for (const f of photoFiles) {
      const p = await uploadOne(f)
      if (!p) { setUploading(false); return }
      photoPaths.push(p)
    }
    let signedPodPath: string | null = null
    if (signedPodFile) {
      signedPodPath = await uploadOne(signedPodFile)
      if (!signedPodPath) { setUploading(false); return }
    }
    setUploading(false)

    startTransition(async () => {
      const res = await recordGRNAction({
        procurementItemId,
        deliveredAt,
        quantityReceived: qty,
        condition,
        notes: notes.trim() || null,
        photoPaths,
        signedPodPath,
      })
      if (res.error) {
        // Best-effort cleanup of uploaded files on failure.
        const supabase = createClient()
        const toRemove = [...photoPaths, ...(signedPodPath ? [signedPodPath] : [])]
        if (toRemove.length > 0) {
          await supabase.storage.from('grn-photos').remove(toRemove).catch(() => {})
        }
        setError(res.error)
        return
      }
      reset(); setOpen(false); router.refresh()
    })
  }

  async function onDownload(path: string) {
    const supabase = createClient()
    const { data, error } = await supabase.storage
      .from('grn-photos')
      .createSignedUrl(path, 3600, { download: true })
    if (error || !data?.signedUrl) {
      alert(`Cannot download: ${error?.message ?? 'no URL'}`); return
    }
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
  }

  function onDelete(id: string) {
    if (!confirm('Delete this GRN? Photos + signed POD are removed too.')) return
    startTransition(async () => {
      const res = await deleteGRNAction(id)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  const busy = pending || uploading

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {procurementQuantity != null && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
            Received {totalReceived} / {Number(procurementQuantity)}{procurementUnit ? ` ${procurementUnit}` : ''}
            {outstanding != null && outstanding > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--c-amber)' }}>
                · {outstanding} outstanding
              </span>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {!open && (
          <button
            type="button"
            className="btn-primary-amber"
            onClick={() => setOpen(true)}
          >
            + Record delivery
          </button>
        )}
      </div>

      {open && (
        <form
          onSubmit={onSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10,
            padding: 14,
            background: 'var(--c-base)',
            borderRadius: 8,
            border: '1px solid var(--c-border)',
            marginBottom: 14,
          }}
        >
          <div>
            <label className="ob-label" htmlFor="grn-date">Delivered on *</label>
            <input
              id="grn-date" type="date" className="ob-input"
              value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="grn-qty">
              Quantity received{procurementUnit ? ` (${procurementUnit})` : ''} *
            </label>
            <input
              id="grn-qty" type="number" step="any" min="0" className="ob-input"
              value={quantityReceived} onChange={(e) => setQuantityReceived(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="grn-cond">Condition *</label>
            <select
              id="grn-cond" className="ob-input"
              value={condition} onChange={(e) => setCondition(e.target.value as GRNRow['condition'])}
            >
              <option value="complete">Complete</option>
              <option value="partial">Partial</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="ob-label" htmlFor="grn-photos">Photos (multiple)</label>
            <input
              id="grn-photos" type="file" multiple
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={onPhotosChange}
              className="ob-input"
            />
            {photoFiles.length > 0 && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                {photoFiles.length} file{photoFiles.length !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="ob-label" htmlFor="grn-pod">Signed POD (optional)</label>
            <input
              id="grn-pod" type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={onPodChange}
              className="ob-input"
            />
            {signedPodFile && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                {signedPodFile.name}
              </div>
            )}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="ob-label" htmlFor="grn-notes">Notes</label>
            <textarea
              id="grn-notes" className="ob-input" rows={2}
              value={notes} onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
            />
          </div>
          {error && (
            <div role="alert" style={{ color: '#dc2626', fontSize: 12, gridColumn: '1 / -1' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', gridColumn: '1 / -1' }}>
            <button
              type="button"
              onClick={() => { reset(); setOpen(false) }}
              className="btn-primary-amber"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
            >Cancel</button>
            <button type="submit" className="btn-primary-amber" disabled={busy}>
              {busy ? (uploading ? 'Uploading…' : 'Saving…') : 'Save GRN'}
            </button>
          </div>
        </form>
      )}

      {grns.length === 0 ? (
        <div style={{ padding: 18, color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          No deliveries recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grns.map((g) => (
            <div
              key={g.id}
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
                    {fmtDate(g.delivered_at)} —{' '}
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {Number(g.quantity_received)}{procurementUnit ? ` ${procurementUnit}` : ''}
                    </span>
                  </div>
                  {g.notes && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-mid)', marginTop: 4, fontStyle: 'italic' }}>
                      {g.notes}
                    </div>
                  )}
                </div>
                <span className={`badge ${CONDITION_TONE[g.condition]}`}>
                  {CONDITION_LABEL[g.condition]}
                </span>
              </div>
              {(g.photo_paths?.length || g.signed_pod_path) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {(g.photo_paths ?? []).map((p, i) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onDownload(p)}
                      style={actionBtn}
                    >📷 Photo {i + 1}</button>
                  ))}
                  {g.signed_pod_path && (
                    <button
                      type="button"
                      onClick={() => onDownload(g.signed_pod_path!)}
                      style={actionBtn}
                    >📄 Signed POD</button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(g.id)}
                    disabled={pending}
                    style={{ ...actionBtn, color: '#dc2626', marginLeft: 'auto' }}
                  >Delete</button>
                </div>
              )}
              {!(g.photo_paths?.length || g.signed_pod_path) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => onDelete(g.id)}
                    disabled={pending}
                    style={{ ...actionBtn, color: '#dc2626' }}
                  >Delete</button>
                </div>
              )}
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
