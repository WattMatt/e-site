'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { selectQuoteAction, deleteQuoteAction } from '@/actions/quote.actions'

export interface QuoteRow {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  quote_reference: string | null
  quoted_price: number
  currency: string
  valid_until: string | null
  lead_time_days: number | null
  notes: string | null
  file_path: string | null
  file_size_bytes: number | null
  file_mime: string | null
  received_at: string
  is_selected: boolean
}

interface Props {
  procurementItemId: string
  quotes: QuoteRow[]
  selectedQuoteId: string | null
  suppliersById: Record<string, string>
}

function fmtZAR(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(Number(n))
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function QuoteCompareTable({
  procurementItemId,
  quotes,
  selectedQuoteId,
  suppliersById,
}: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (quotes.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--c-text-dim)',
          fontSize: 13,
          border: '1px dashed var(--c-border)',
          borderRadius: 6,
        }}
      >
        No quotes uploaded yet. Upload one from each supplier and compare here.
      </div>
    )
  }

  // Cheapest price highlight
  const cheapest = Math.min(...quotes.map((q) => Number(q.quoted_price)))

  function supplierLabel(q: QuoteRow): string {
    if (q.supplier_id && suppliersById[q.supplier_id]) {
      return suppliersById[q.supplier_id]!
    }
    return q.supplier_name ?? '(unknown supplier)'
  }

  function onSelect(quoteId: string) {
    setError(null)
    setPendingId(quoteId)
    startTransition(async () => {
      const res = await selectQuoteAction({ procurementItemId, quoteId })
      setPendingId(null)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function onDelete(quoteId: string) {
    if (!confirm('Delete this quote? The uploaded file is removed too.')) return
    setError(null)
    setPendingId(quoteId)
    startTransition(async () => {
      const res = await deleteQuoteAction(quoteId)
      setPendingId(null)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  async function onDownload(filePath: string | null, supplier: string) {
    if (!filePath) return
    const supabase = createClient()
    const { data, error } = await supabase.storage
      .from('quotes')
      .createSignedUrl(filePath, 3600, {
        download: `${supplier}-quote.${filePath.split('.').pop() ?? 'pdf'}`,
      })
    if (error || !data?.signedUrl) {
      alert(`Cannot download: ${error?.message ?? 'no URL'}`)
      return
    }
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div>
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th>Supplier</Th>
              <Th>Reference</Th>
              <Th align="right">Price</Th>
              <Th align="right">Lead</Th>
              <Th>Valid until</Th>
              <Th>Received</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const isCheapest = Number(q.quoted_price) === cheapest
              const isSelected = q.id === selectedQuoteId
              const isBusy = pendingId === q.id
              return (
                <tr
                  key={q.id}
                  style={{
                    borderTop: '1px solid var(--c-border)',
                    background: isSelected ? 'var(--c-amber-dim)' : undefined,
                  }}
                >
                  <Td>
                    <div style={{ fontWeight: 600 }}>{supplierLabel(q)}</div>
                    {isSelected && (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--c-amber)',
                          marginTop: 2,
                        }}
                      >
                        Selected winner
                      </div>
                    )}
                  </Td>
                  <Td mono>{q.quote_reference ?? '—'}</Td>
                  <Td align="right" mono>
                    <span style={isCheapest ? { color: '#16a34a', fontWeight: 700 } : undefined}>
                      {fmtZAR(q.quoted_price)}
                    </span>
                    {isCheapest && quotes.length > 1 && (
                      <div style={{ fontSize: 9, color: '#16a34a', fontFamily: 'var(--font-mono)' }}>
                        cheapest
                      </div>
                    )}
                  </Td>
                  <Td align="right" mono>{q.lead_time_days != null ? `${q.lead_time_days}d` : '—'}</Td>
                  <Td mono>{fmtDate(q.valid_until)}</Td>
                  <Td mono>{fmtDate(q.received_at)}</Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      {q.file_path && (
                        <button
                          type="button"
                          onClick={() => onDownload(q.file_path, supplierLabel(q))}
                          title="Download quote file"
                          aria-label={`Download quote from ${supplierLabel(q)}`}
                          style={actionBtn}
                        >
                          ↓
                        </button>
                      )}
                      {!isSelected && (
                        <button
                          type="button"
                          onClick={() => onSelect(q.id)}
                          disabled={isBusy}
                          title="Mark as the winning quote"
                          style={{ ...actionBtn, color: 'var(--c-amber)' }}
                        >
                          {isBusy ? '…' : 'Select'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(q.id)}
                        disabled={isBusy}
                        title="Delete quote"
                        aria-label={`Delete quote from ${supplierLabel(q)}`}
                        style={{ ...actionBtn, color: '#dc2626' }}
                      >
                        ✕
                      </button>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  color: 'var(--c-text-mid)',
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '8px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--c-text-dim)',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align,
  mono,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '8px 10px',
        verticalAlign: 'top',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontSize: mono ? 12 : 13,
        color: 'var(--c-text)',
      }}
    >
      {children}
    </td>
  )
}
