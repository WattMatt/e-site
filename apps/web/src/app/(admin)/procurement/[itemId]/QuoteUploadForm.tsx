'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { recordQuoteAction } from '@/actions/quote.actions'

interface SupplierStub {
  id: string
  name: string
}

interface Props {
  procurementItemId: string
  organisationId: string
  suppliers: SupplierStub[]
}

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

const MAX_BYTES = 50 * 1024 * 1024  // 50 MB — matches bucket cap

function extFromMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return 'pdf'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx'
    case 'application/vnd.ms-excel': return 'xls'
    default: return 'bin'
  }
}

export function QuoteUploadForm({
  procurementItemId,
  organisationId,
  suppliers,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [supplierId, setSupplierId] = useState<string>('')
  const [supplierName, setSupplierName] = useState('')
  const [quoteReference, setQuoteReference] = useState('')
  const [quotedPrice, setQuotedPrice] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [leadTimeDays, setLeadTimeDays] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setFile(null)
    setSupplierId('')
    setSupplierName('')
    setQuoteReference('')
    setQuotedPrice('')
    setValidUntil('')
    setLeadTimeDays('')
    setNotes('')
    setError(null)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setFile(null); return }
    if (f.size > MAX_BYTES) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`)
      e.target.value = ''
      setFile(null)
      return
    }
    if (!ALLOWED_MIMES.has(f.type)) {
      setError(`Unsupported file type: ${f.type || 'unknown'}. Allowed: PDF, JPG, PNG, WebP, XLSX.`)
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) { setError('Pick a quote file to upload'); return }
    const price = Number(quotedPrice)
    if (!Number.isFinite(price) || price < 0) {
      setError('Quoted price must be a non-negative number'); return
    }
    if (!supplierId && !supplierName.trim()) {
      setError('Select a supplier OR enter a supplier name'); return
    }

    startTransition(async () => {
      const supabase = createClient()
      // Upload file FIRST (bucket RLS gates by org_id prefix). Then record
      // the metadata row referencing the path. If recordQuoteAction fails,
      // we have an orphan blob — best-effort cleanup below.
      const ext = extFromMime(file.type)
      const randomId = crypto.randomUUID()
      const path = `${organisationId}/${procurementItemId}/${randomId}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('quotes')
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        })
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`)
        return
      }

      const lead = leadTimeDays.trim() ? Number(leadTimeDays) : null
      const res = await recordQuoteAction({
        procurementItemId,
        supplierId: supplierId || null,
        supplierName: supplierId ? null : supplierName.trim() || null,
        quoteReference: quoteReference.trim() || null,
        quotedPrice: price,
        currency: 'ZAR',
        validUntil: validUntil || null,
        leadTimeDays: lead != null && Number.isFinite(lead) ? lead : null,
        notes: notes.trim() || null,
        filePath: path,
        fileSizeBytes: file.size,
        fileMime: file.type,
      })

      if (res.error) {
        // Best-effort cleanup of the orphaned bucket object.
        await supabase.storage.from('quotes').remove([path]).catch(() => {})
        setError(res.error)
        return
      }

      reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          className="btn-primary-amber"
          onClick={() => setOpen(true)}
        >
          + Upload quote
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
        padding: 14,
        background: 'var(--c-base)',
        borderRadius: 8,
        border: '1px solid var(--c-border)',
      }}
    >
      <div style={{ gridColumn: '1 / -1' }}>
        <label className="ob-label" htmlFor="quote-file">Quote file *</label>
        <input
          id="quote-file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={onFileChange}
          className="ob-input"
          required
        />
        {file && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--c-text-dim)',
              marginTop: 4,
            }}
          >
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-supplier">Supplier</label>
        <select
          id="quote-supplier"
          className="ob-input"
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value)
            if (e.target.value) setSupplierName('')
          }}
        >
          <option value="">(other — type name below)</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-supplier-name">
          {supplierId ? 'Supplier name (locked)' : 'Supplier name *'}
        </label>
        <input
          id="quote-supplier-name"
          className="ob-input"
          value={supplierName}
          onChange={(e) => setSupplierName(e.target.value)}
          placeholder="e.g. ACDC Dynamics"
          disabled={!!supplierId}
          maxLength={200}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-ref">Quote reference</label>
        <input
          id="quote-ref"
          className="ob-input"
          value={quoteReference}
          onChange={(e) => setQuoteReference(e.target.value)}
          placeholder="Q-2026-1234"
          maxLength={100}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-price">Quoted price (ZAR) *</label>
        <input
          id="quote-price"
          type="number"
          step="0.01"
          min="0"
          className="ob-input"
          value={quotedPrice}
          onChange={(e) => setQuotedPrice(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-valid">Valid until</label>
        <input
          id="quote-valid"
          type="date"
          className="ob-input"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor="quote-lead">Lead time (days)</label>
        <input
          id="quote-lead"
          type="number"
          step="1"
          min="0"
          className="ob-input"
          value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(e.target.value)}
          placeholder="14"
        />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label className="ob-label" htmlFor="quote-notes">Notes</label>
        <textarea
          id="quote-notes"
          rows={2}
          className="ob-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Delivery terms, exclusions, payment terms…"
          maxLength={2000}
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
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-mid)',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary-amber"
          disabled={pending || !file}
        >
          {pending ? 'Uploading…' : 'Save quote'}
        </button>
      </div>
    </form>
  )
}
