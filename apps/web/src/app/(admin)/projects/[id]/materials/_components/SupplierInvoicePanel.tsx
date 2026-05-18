'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  recordSupplierInvoiceAction,
  updateSupplierInvoiceStatusAction,
  markSupplierInvoicePaidAction,
  deleteSupplierInvoiceAction,
} from '@/actions/supplier-invoice.actions'

export interface SupplierInvoiceRow {
  id: string
  invoice_number: string
  supplier_invoice_date: string
  amount: number
  vat_amount: number | null
  currency: string
  status: 'received' | 'approved' | 'paid' | 'disputed'
  paid_at: string | null
  payment_reference: string | null
  notes: string | null
  file_path: string | null
  file_mime: string | null
  created_at: string
}

interface Props {
  procurementItemId: string
  organisationId: string
  invoices: SupplierInvoiceRow[]
  /** Expected total from selected_quote × qty — used for variance hint. */
  expectedTotal: number | null
}

const ALLOWED_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])
const MAX_BYTES = 50 * 1024 * 1024

const STATUS_LABEL: Record<SupplierInvoiceRow['status'], string> = {
  received: 'Received', approved: 'Approved', paid: 'Paid', disputed: 'Disputed',
}
const STATUS_TONE: Record<SupplierInvoiceRow['status'], string> = {
  received: 'badge-warning',
  approved: 'badge-info',
  paid: 'badge-success',
  disputed: 'badge-error',
}

function extFromMime(m: string): string {
  switch (m) {
    case 'application/pdf': return 'pdf'
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return 'xlsx'
    case 'application/vnd.ms-excel': return 'xls'
    default: return 'bin'
  }
}
function fmtZAR(n: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(n)
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function SupplierInvoicePanel({
  procurementItemId, organisationId, invoices, expectedTotal,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const [file, setFile] = useState<File | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setFile(null); setInvoiceNumber(''); setInvoiceDate(today)
    setAmount(''); setVatAmount(''); setNotes(''); setError(null)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setFile(null); return }
    if (f.size > MAX_BYTES) {
      setError(`File too large. Max 50 MB.`); e.target.value = ''; return
    }
    if (!ALLOWED_MIMES.has(f.type)) {
      setError(`Unsupported type: ${f.type || 'unknown'}`); e.target.value = ''; return
    }
    setFile(f)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) { setError('Amount must be ≥ 0'); return }
    if (!invoiceNumber.trim()) { setError('Invoice number required'); return }

    startTransition(async () => {
      let filePath: string | null = null
      let fileSize: number | null = null
      let fileMime: string | null = null
      const supabase = createClient()

      if (file) {
        const path = `${organisationId}/${procurementItemId}/inv-${crypto.randomUUID()}.${extFromMime(file.type)}`
        const { error: upErr } = await supabase.storage
          .from('quotes')
          .upload(path, file, { contentType: file.type, upsert: false })
        if (upErr) { setError(`Upload failed: ${upErr.message}`); return }
        filePath = path; fileSize = file.size; fileMime = file.type
      }

      const res = await recordSupplierInvoiceAction({
        procurementItemId,
        invoiceNumber: invoiceNumber.trim(),
        supplierInvoiceDate: invoiceDate,
        amount: amt,
        vatAmount: vatAmount.trim() ? Number(vatAmount) : null,
        currency: 'ZAR',
        notes: notes.trim() || null,
        filePath, fileSizeBytes: fileSize, fileMime,
      })
      if (res.error) {
        if (filePath) {
          await supabase.storage.from('quotes').remove([filePath]).catch(() => {})
        }
        setError(res.error); return
      }
      reset(); setOpen(false); router.refresh()
    })
  }

  async function onDownload(inv: SupplierInvoiceRow) {
    if (!inv.file_path) return
    const supabase = createClient()
    const { data, error } = await supabase.storage
      .from('quotes')
      .createSignedUrl(inv.file_path, 3600, { download: `${inv.invoice_number}.${extFromMime(inv.file_mime ?? 'application/pdf')}` })
    if (error || !data?.signedUrl) { alert(`Cannot download: ${error?.message ?? 'no URL'}`); return }
    const a = document.createElement('a')
    a.href = data.signedUrl; a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
  }

  function onStatus(id: string, status: SupplierInvoiceRow['status']) {
    startTransition(async () => {
      const res = await updateSupplierInvoiceStatusAction({ id, status })
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function onMarkPaid(id: string) {
    const ref = window.prompt('Payment reference (optional):') || null
    startTransition(async () => {
      const res = await markSupplierInvoicePaidAction({ id, paymentReference: ref })
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function onDelete(id: string) {
    if (!confirm('Delete this supplier invoice? File is removed too.')) return
    startTransition(async () => {
      const res = await deleteSupplierInvoiceAction(id)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.amount), 0)
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0)
  const variance = expectedTotal && expectedTotal > 0
    ? Math.abs(totalInvoiced - expectedTotal) / expectedTotal
    : 0
  const flagVariance = variance > 0.05 && totalInvoiced > 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
          Invoiced: <span style={{ color: 'var(--c-text)' }}>{fmtZAR(totalInvoiced)}</span>
          {totalPaid > 0 && (
            <> · Paid: <span style={{ color: '#16a34a' }}>{fmtZAR(totalPaid)}</span></>
          )}
          {expectedTotal != null && expectedTotal > 0 && (
            <> · Expected: <span>{fmtZAR(expectedTotal)}</span></>
          )}
          {flagVariance && (
            <span style={{ marginLeft: 8, color: 'var(--c-amber)' }}>⚠ variance {(variance * 100).toFixed(1)}%</span>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {!open && (
          <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>
            + Record supplier invoice
          </button>
        )}
      </div>

      {open && (
        <form
          onSubmit={onSubmit}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10, padding: 14, marginBottom: 12,
            background: 'var(--c-base)', borderRadius: 8, border: '1px solid var(--c-border)',
          }}
        >
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="ob-label" htmlFor="inv-file">Invoice file (optional)</label>
            <input
              id="inv-file" type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,application/pdf,image/*,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={onFileChange} className="ob-input"
            />
            {file && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            )}
          </div>
          <div>
            <label className="ob-label" htmlFor="inv-num">Invoice # *</label>
            <input id="inv-num" className="ob-input" value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={100} required />
          </div>
          <div>
            <label className="ob-label" htmlFor="inv-date">Invoice date *</label>
            <input id="inv-date" type="date" className="ob-input" value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>
          <div>
            <label className="ob-label" htmlFor="inv-amt">Amount (ZAR) *</label>
            <input id="inv-amt" type="number" step="0.01" min="0" className="ob-input"
              value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="ob-label" htmlFor="inv-vat">VAT (optional)</label>
            <input id="inv-vat" type="number" step="0.01" min="0" className="ob-input"
              value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="ob-label" htmlFor="inv-notes">Notes</label>
            <textarea id="inv-notes" rows={2} className="ob-input" value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
          {error && (
            <div role="alert" style={{ color: '#dc2626', fontSize: 12, gridColumn: '1 / -1' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', gridColumn: '1 / -1' }}>
            <button type="button" onClick={() => { reset(); setOpen(false) }}
              className="btn-primary-amber"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
            >Cancel</button>
            <button type="submit" className="btn-primary-amber" disabled={pending}>
              {pending ? 'Saving…' : 'Record invoice'}
            </button>
          </div>
        </form>
      )}

      {invoices.length === 0 ? (
        <div style={{ padding: 18, color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          No supplier invoices recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.map((inv) => (
            <div key={inv.id} style={{
              padding: 12, border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-base)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {inv.invoice_number} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>{fmtDate(inv.supplier_invoice_date)}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 2 }}>
                    {fmtZAR(Number(inv.amount))}
                    {inv.vat_amount != null && (
                      <span style={{ color: 'var(--c-text-dim)' }}> · VAT {fmtZAR(Number(inv.vat_amount))}</span>
                    )}
                  </div>
                  {inv.payment_reference && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      Ref {inv.payment_reference}
                    </div>
                  )}
                  {inv.notes && (
                    <div style={{ fontSize: 11, color: 'var(--c-text-mid)', marginTop: 4, fontStyle: 'italic' }}>
                      {inv.notes}
                    </div>
                  )}
                </div>
                <span className={`badge ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {inv.file_path && (
                  <button type="button" onClick={() => onDownload(inv)} style={actionBtn}>↓ Invoice</button>
                )}
                {inv.status === 'received' && (
                  <button type="button" onClick={() => onStatus(inv.id, 'approved')} disabled={pending}
                    style={{ ...actionBtn, color: '#16a34a' }}>✓ Approve</button>
                )}
                {(inv.status === 'received' || inv.status === 'approved') && (
                  <button type="button" onClick={() => onMarkPaid(inv.id)} disabled={pending}
                    style={{ ...actionBtn, color: '#16a34a' }}>Mark paid</button>
                )}
                {inv.status !== 'disputed' && inv.status !== 'paid' && (
                  <button type="button" onClick={() => onStatus(inv.id, 'disputed')} disabled={pending}
                    style={{ ...actionBtn, color: '#dc2626' }}>⚠ Dispute</button>
                )}
                <button type="button" onClick={() => onDelete(inv.id)} disabled={pending}
                  style={{ ...actionBtn, color: '#dc2626', marginLeft: 'auto' }}>Delete</button>
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
