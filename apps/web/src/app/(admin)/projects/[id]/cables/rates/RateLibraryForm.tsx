'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TableScrollX } from '@/components/ui/TableScrollX'
import {
  upsertRateLibraryEntriesAction,
  deleteRateLibraryEntryAction,
} from '@/actions/rate-library.actions'

interface Entry {
  id: string   // empty string for new rows (not yet persisted)
  size_mm2: number | ''
  conductor: 'CU' | 'AL'
  supply_rate_per_m: number | ''
  install_rate_per_m: number | ''
  termination_rate_each: number | ''
  notes: string
}

interface Props {
  projectId: string
  canEdit: boolean
  initialEntries: Array<{
    id: string
    size_mm2: number
    conductor: 'CU' | 'AL'
    supply_rate_per_m: number
    install_rate_per_m: number
    termination_rate_each: number
    notes: string | null
    updated_at: string
  }>
}

export function RateLibraryForm({ projectId, canEdit, initialEntries }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [rows, setRows] = useState<Entry[]>(() =>
    initialEntries.map((e) => ({
      id: e.id,
      size_mm2: e.size_mm2,
      conductor: e.conductor,
      supply_rate_per_m: e.supply_rate_per_m,
      install_rate_per_m: e.install_rate_per_m,
      termination_rate_each: e.termination_rate_each,
      notes: e.notes ?? '',
    })),
  )

  const updateRow = (i: number, patch: Partial<Entry>) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const onAddRow = () => {
    setRows([
      ...rows,
      { id: '', size_mm2: '', conductor: 'CU', supply_rate_per_m: '', install_rate_per_m: '', termination_rate_each: '', notes: '' },
    ])
  }

  const onDeleteRow = (i: number) => {
    const row = rows[i]
    if (!row || !canEdit) return
    if (!row.id) {
      // Unsaved new row — just drop locally
      setRows(rows.filter((_, idx) => idx !== i))
      return
    }
    if (!confirm(`Delete the ${row.size_mm2}mm² ${row.conductor} entry? Existing revisions' cost lines are not affected.`)) return
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const r = await deleteRateLibraryEntryAction(row.id)
      if (!r.ok) { setError(r.error); return }
      setRows(rows.filter((_, idx) => idx !== i))
      setSuccess('Row deleted.')
      router.refresh()
    })
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    setError(null)
    setSuccess(null)

    // Validate locally before submit
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r) continue
      if (r.size_mm2 === '' || Number(r.size_mm2) <= 0) {
        setError(`Row ${i + 1}: size must be > 0`)
        return
      }
      if (r.supply_rate_per_m === '' || Number(r.supply_rate_per_m) < 0) {
        setError(`Row ${i + 1}: supply rate must be >= 0`)
        return
      }
      if (r.install_rate_per_m === '' || Number(r.install_rate_per_m) < 0) {
        setError(`Row ${i + 1}: install rate must be >= 0`)
        return
      }
      if (r.termination_rate_each === '' || Number(r.termination_rate_each) < 0) {
        setError(`Row ${i + 1}: termination rate must be >= 0`)
        return
      }
    }

    startTransition(async () => {
      const entries = rows.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        size_mm2: Number(r.size_mm2),
        conductor: r.conductor,
        supply_rate_per_m: Number(r.supply_rate_per_m),
        install_rate_per_m: Number(r.install_rate_per_m),
        termination_rate_each: Number(r.termination_rate_each),
        notes: r.notes.trim() || null,
      }))
      const result = await upsertRateLibraryEntriesAction(projectId, entries)
      if (!result.ok) { setError(result.error); return }
      setSuccess(`Saved ${result.upserted} row${result.upserted !== 1 ? 's' : ''}.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <TableScrollX className="data-panel">
        {rows.length === 0 ? (
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            {canEdit ? 'No rates yet. Click "+ Add row" to enter your first.' : 'No rates yet.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ background: 'var(--c-base)' }}>
                <th style={thStyle}>Size mm²</th>
                <th style={thStyle}>Cond</th>
                <th style={thStyle}>Supply R/m</th>
                <th style={thStyle}>Install R/m</th>
                <th style={thStyle}>Term R/each</th>
                <th style={thStyle}>Notes</th>
                {canEdit && <th style={thStyle} aria-label="Actions"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || `new-${i}`} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={tdStyle}>
                    <input
                      type="number" step="0.1" min={0}
                      value={r.size_mm2}
                      onChange={(e) => updateRow(i, { size_mm2: e.target.value === '' ? '' : Number(e.target.value) })}
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 80, fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={r.conductor}
                      onChange={(e) => updateRow(i, { conductor: e.target.value as 'CU' | 'AL' })}
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 70 }}
                    >
                      <option value="CU">Cu</option>
                      <option value="AL">Al</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number" step="0.01" min={0}
                      value={r.supply_rate_per_m}
                      onChange={(e) => updateRow(i, { supply_rate_per_m: e.target.value === '' ? '' : Number(e.target.value) })}
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 110, fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number" step="0.01" min={0}
                      value={r.install_rate_per_m}
                      onChange={(e) => updateRow(i, { install_rate_per_m: e.target.value === '' ? '' : Number(e.target.value) })}
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 110, fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number" step="0.01" min={0}
                      value={r.termination_rate_each}
                      onChange={(e) => updateRow(i, { termination_rate_each: e.target.value === '' ? '' : Number(e.target.value) })}
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 110, fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="text"
                      value={r.notes}
                      onChange={(e) => updateRow(i, { notes: e.target.value })}
                      placeholder="optional"
                      disabled={!canEdit || pending}
                      className="ob-input"
                      style={{ width: 180 }}
                    />
                  </td>
                  {canEdit && (
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => onDeleteRow(i)}
                        disabled={pending}
                        title="Delete this row"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--c-text-dim)',
                          cursor: 'pointer',
                          fontSize: 13,
                          padding: '4px 8px',
                        }}
                      >🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableScrollX>

      {canEdit && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={onAddRow}
            disabled={pending}
            className="btn-primary-amber"
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
          >
            + Add row
          </button>
          <button
            type="submit"
            disabled={pending}
            className="btn-primary-amber"
          >
            {pending ? 'Saving…' : '✓ Save changes'}
          </button>
          {error && (
            <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</div>
          )}
          {success && (
            <div role="status" style={{ color: 'var(--c-green)', fontSize: 12 }}>{success}</div>
          )}
        </div>
      )}
    </form>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'middle',
  color: 'var(--c-text)',
}
