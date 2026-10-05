'use client'

import { useMemo, useState, useTransition } from 'react'
import { setRateCellTypeAction, type TenderItem } from '@/actions/tender.actions'
import { RATE_CELL_TYPES, type RateCellType } from '@/lib/tender/types'
import { formatRand, RATE_CELL_TYPE_LABELS } from './format'

export function BoqGrid({
  tenderId,
  items,
  estimate,
  editable,
}: {
  tenderId: string
  items: TenderItem[]
  estimate: Record<string, { rate: number | null; amount: number | null }>
  editable: boolean
}) {
  const sheets = useMemo(() => Array.from(new Set(items.map((i) => i.sheet_name))), [items])
  const [sheet, setSheet] = useState(sheets[0])
  const [types, setTypes] = useState<Record<string, RateCellType>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const hasEstimate = Object.keys(estimate).length > 0
  const rows = items.filter((i) => i.sheet_name === sheet)

  function change(item: TenderItem, type: RateCellType) {
    const before = types[item.id] ?? item.rate_cell_type
    setTypes((t) => ({ ...t, [item.id]: type }))
    setError(null)
    start(async () => {
      const r = await setRateCellTypeAction(tenderId, item.id, type)
      if ('error' in r) {
        setTypes((t) => ({ ...t, [item.id]: before as RateCellType }))
        setError(r.error)
      }
    })
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Sheets">
        {sheets.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={s === sheet}
            onClick={() => setSheet(s)}
            className={s === sheet ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 13, margin: 0 }}>{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>Row</th><th>Item</th><th style={{ textAlign: 'left' }}>Description</th><th>Unit</th><th>Qty</th>
              <th>Rate cell</th>
              {hasEstimate && <><th>Est. rate</th><th>Est. amount</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const est = estimate[r.id]
              const type = types[r.id] ?? r.rate_cell_type
              const muted = r.kind === 'note' ? { color: 'var(--c-text-muted)', fontStyle: 'italic' as const } : undefined
              const bold = r.kind === 'heading' || r.kind === 'total' ? { fontWeight: 600 } : undefined
              return (
                <tr key={r.id}>
                  <td style={{ color: 'var(--c-text-muted)' }}>{r.row_number}</td>
                  <td style={bold}>{r.code ?? ''}</td>
                  <td style={{ ...muted, ...bold }}>{r.description}</td>
                  <td>{r.unit ?? ''}</td>
                  <td style={{ textAlign: 'right' }}>{r.quantity ?? ''}</td>
                  <td>
                    {r.kind === 'item' && editable && (
                      <select
                        aria-label={`Rate cell for ${r.code ?? r.description}`}
                        value={type ?? 'priced'}
                        disabled={pending}
                        onChange={(e) => change(r, e.target.value as RateCellType)}
                      >
                        {RATE_CELL_TYPES.map((t) => <option key={t} value={t}>{RATE_CELL_TYPE_LABELS[t]}</option>)}
                      </select>
                    )}
                    {r.kind === 'item' && !editable && RATE_CELL_TYPE_LABELS[type ?? 'priced']}
                    {r.kind === 'item' && type === 'fixed' && r.fixed_amount != null && <div>{formatRand(r.fixed_amount)}</div>}
                    {r.kind === 'total' && r.stated_amount != null && formatRand(r.stated_amount)}
                  </td>
                  {hasEstimate && (
                    <>
                      <td style={{ textAlign: 'right' }}>{est?.rate ?? ''}</td>
                      <td style={{ textAlign: 'right' }}>{est?.amount != null ? formatRand(est.amount) : ''}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
