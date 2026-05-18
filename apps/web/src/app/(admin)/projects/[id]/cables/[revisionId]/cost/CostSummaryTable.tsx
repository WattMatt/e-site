'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ensureCostLinesAction,
  updateCostLineAction,
  updateRevisionVatAction,
} from '@/actions/cable-cost.actions'

export interface CostRow {
  id: string | null
  size_mm2: number
  total_length_m: number
  supply_rate_per_m: number
  install_rate_per_m: number
  termination_rate_each: number
  cable_total: number
  termination_qty: number
  termination_total: number
}

export interface CostHeader {
  id: string | null         // legacy cost_lines sentinel; null on new revisions
  revision_id: string       // VAT now lives on revisions; required for the new action
  contingency_pct: number
  vat_pct: number
  subtotalCables: number
  subtotalTerminations: number
  beforeAdj: number
  contingencyAmt: number
  vatAmt: number
  grandTotal: number
}

function fmtZAR(n: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency', currency: 'ZAR', maximumFractionDigits: 2,
  }).format(n)
}

interface Props {
  rows: CostRow[]
  header: CostHeader
  revisionId: string
  locked: boolean
}

export function CostSummaryTable({ rows, header, revisionId, locked }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [ensuring, setEnsuring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-ensure cost lines on mount when the user lands on the page for the
  // first time after creating cables.
  useEffect(() => {
    if (locked) return
    if (rows.every((r) => r.id != null) && header.id != null) return
    setEnsuring(true)
    ensureCostLinesAction(revisionId)
      .then((r) => { if (r.error) setError(r.error); router.refresh() })
      .finally(() => setEnsuring(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patch(id: string | null, fields: Record<string, number>) {
    if (!id) return
    setError(null)
    startTransition(async () => {
      const r = await updateCostLineAction({ id, ...fields } as any)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  // VAT % is now per-revision (migration 00060). Separate save path
  // because it doesn't go through cost_lines.
  function saveVat(pct: number) {
    setError(null)
    startTransition(async () => {
      const r = await updateRevisionVatAction({ revisionId: header.revision_id, vatPct: pct })
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  return (
    <div>
      {ensuring && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 8 }}>
          Preparing cost lines for new cable sizes…
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}

      <div className="data-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th align="right">Size (mm²)</Th>
              <Th align="right">Total length (m)</Th>
              <Th align="right">Supply (R/m)</Th>
              <Th align="right">Install (R/m)</Th>
              <Th align="right">Cable total</Th>
              <Th align="right">Term qty</Th>
              <Th align="right">Term rate</Th>
              <Th align="right">Term total</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.size_mm2}`} style={{ borderTop: '1px solid var(--c-border)' }}>
                <Td align="right" mono><strong>{r.size_mm2}</strong></Td>
                <Td align="right" mono>{r.total_length_m.toFixed(1)}</Td>
                <Td align="right">
                  <Editable
                    value={r.supply_rate_per_m}
                    disabled={locked || !r.id}
                    onSave={(v) => patch(r.id, { supplyRatePerM: v })}
                  />
                </Td>
                <Td align="right">
                  <Editable
                    value={r.install_rate_per_m}
                    disabled={locked || !r.id}
                    onSave={(v) => patch(r.id, { installRatePerM: v })}
                  />
                </Td>
                <Td align="right" mono><strong>{fmtZAR(r.cable_total)}</strong></Td>
                <Td align="right" mono>{r.termination_qty}</Td>
                <Td align="right">
                  <Editable
                    value={r.termination_rate_each}
                    disabled={locked || !r.id}
                    onSave={(v) => patch(r.id, { terminationRateEach: v })}
                  />
                </Td>
                <Td align="right" mono><strong>{fmtZAR(r.termination_total)}</strong></Td>
              </tr>
            ))}
            <SubtotalRow label="Subtotal cables" value={header.subtotalCables} />
            <SubtotalRow label="Subtotal terminations" value={header.subtotalTerminations} />
            {/* Contingency row removed 2026-05-17: these contracts are net,
                no contingency. DB column `contingency_pct` kept for archived
                revisions; new edits never set it. VAT remains. */}
            <tr style={{ borderTop: '2px solid var(--c-border)' }}>
              <Td align="right" mono colSpan={6} style={{ color: 'var(--c-text-dim)' }}>
                VAT
                {' '}
                <Editable
                  value={header.vat_pct}
                  disabled={locked}
                  width={50}
                  suffix="%"
                  onSave={(v) => saveVat(v)}
                />
              </Td>
              <Td align="right" mono>{fmtZAR(header.vatAmt)}</Td>
              <Td />
            </tr>
            <tr style={{ borderTop: '2px solid var(--c-amber)', background: 'var(--c-amber-dim)' }}>
              <Td align="right" mono colSpan={6}>
                <strong style={{ fontSize: 14 }}>Grand total</strong>
              </Td>
              <Td align="right" mono>
                <strong style={{ fontSize: 16, color: 'var(--c-amber)' }}>{fmtZAR(header.grandTotal)}</strong>
              </Td>
              <Td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SubtotalRow({ label, value }: { label: string; value: number }) {
  return (
    <tr style={{ background: 'var(--c-base)' }}>
      <Td align="right" mono colSpan={6} style={{ color: 'var(--c-text-dim)' }}>
        {label}
      </Td>
      <Td align="right" mono><strong>{fmtZAR(value)}</strong></Td>
      <Td />
    </tr>
  )
}

function Editable({
  value, disabled, onSave, width = 90, suffix,
}: {
  value: number
  disabled?: boolean
  onSave: (v: number) => void
  width?: number
  suffix?: string
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => { setV(String(value)) }, [value])

  function commit() {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n)
  }

  if (disabled) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)' }}>
        {Number(v).toFixed(2)}{suffix ? ' ' + suffix : ''}
      </span>
    )
  }
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      style={{
        background: 'var(--c-base)',
        border: '1px solid var(--c-border)',
        borderRadius: 4,
        color: 'var(--c-text)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        padding: '3px 6px',
        textAlign: 'right',
        width,
      }}
    />
  )
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({
  children, align, colSpan, mono, style,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  colSpan?: number
  mono?: boolean
  style?: React.CSSProperties
}) {
  return (
    <td colSpan={colSpan} style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: 12, color: 'var(--c-text)', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  )
}
