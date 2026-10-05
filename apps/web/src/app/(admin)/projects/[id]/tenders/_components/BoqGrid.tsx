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
  const [fixed, setFixed] = useState<Record<string, number | null>>({})
  const [askAmount, setAskAmount] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const hasEstimate = Object.keys(estimate).length > 0
  const rows = items.filter((i) => i.sheet_name === sheet)

  const fixedOf = (i: TenderItem) => (i.id in fixed ? fixed[i.id] : i.fixed_amount)
  const typeOf = (i: TenderItem) => types[i.id] ?? i.rate_cell_type
  const missingFixed = items.filter((i) => i.kind === 'item' && typeOf(i) === 'fixed' && fixedOf(i) == null)

  function save(item: TenderItem, type: RateCellType, amount?: number) {
    const before = typeOf(item)
    setTypes((t) => ({ ...t, [item.id]: type }))
    setError(null)
    start(async () => {
      const r = await setRateCellTypeAction(tenderId, item.id, type, amount ?? null)
      if ('error' in r) {
        setTypes((t) => ({ ...t, [item.id]: before as RateCellType }))
        setError(r.error)
        return
      }
      setFixed((f) => ({ ...f, [item.id]: type === 'fixed' ? Math.round((amount as number) * 100) / 100 : null }))
      setAskAmount((a) => {
        const next = { ...a }
        delete next[item.id]
        return next
      })
    })
  }

  function change(item: TenderItem, type: RateCellType) {
    if (type === 'fixed') {
      // A fixed sum needs its amount; ask before saving.
      setAskAmount((a) => ({ ...a, [item.id]: fixedOf(item) != null ? String(fixedOf(item)) : '' }))
      return
    }
    save(item, type)
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
      {missingFixed.length > 0 && (
        <p role="status" style={{ color: 'var(--c-amber)', fontSize: 13, margin: 0 }}>
          {missingFixed.length} fixed item(s) have no amount yet ({missingFixed.slice(0, 5).map((i) => `${i.sheet_name} ${i.code ?? i.row_number}`).join(', ')}
          {missingFixed.length > 5 ? ', …' : ''}). Set each amount before the tender is issued.
        </p>
      )}
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
              const type = typeOf(r)
              const asking = r.id in askAmount
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
                    {r.kind === 'item' && asking && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <input
                          aria-label={`Fixed amount for ${r.code ?? r.description}`}
                          inputMode="decimal"
                          value={askAmount[r.id]}
                          onChange={(e) => setAskAmount((a) => ({ ...a, [r.id]: e.target.value }))}
                          placeholder="Amount (R)"
                          style={{ width: 110 }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={pending}
                          onClick={() => {
                            const n = Number(askAmount[r.id].replace(/[\s,]/g, ''))
                            if (!Number.isFinite(n) || n < 0 || askAmount[r.id].trim() === '') return setError('Enter the fixed amount in rand')
                            save(r, 'fixed', n)
                          }}
                        >
                          Save
                        </button>
                      </div>
                    )}
                    {r.kind === 'item' && type === 'fixed' && !asking && (
                      <div>{fixedOf(r) != null ? formatRand(fixedOf(r)) : <span style={{ color: 'var(--c-amber)' }}>amount needed</span>}</div>
                    )}
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
