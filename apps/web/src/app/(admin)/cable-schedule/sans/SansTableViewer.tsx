'use client'

import { useMemo, useState } from 'react'

export interface SansColumn {
  key: string
  label: string
  unit: string | null
  type: 'number' | 'string'
  decimals?: number
  align?: 'left' | 'right'
  width?: number
}

export interface SansTable {
  id: string
  code: string
  title: string
  standard: string
  section_number: string | null
  cable_construction: string | null
  description: string | null
  columns: SansColumn[]
  notes: string | null
  source_ref: string | null
  rows: Record<string, unknown>[]
}

export function SansTableViewer({ tables }: { tables: SansTable[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tables
    return tables.filter(
      (t) =>
        t.code.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.standard.toLowerCase().includes(q) ||
        (t.section_number ?? '').toLowerCase().includes(q) ||
        (t.cable_construction ?? '').toLowerCase().includes(q),
    )
  }, [query, tables])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by section, standard, or construction…"
          className="ob-input"
          style={{ flex: 1, minWidth: 240, maxWidth: 420 }}
        />
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
          }}
        >
          {filtered.length} of {tables.length} tables
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {filtered.map((t) => (
          <TableCard key={t.id} table={t} />
        ))}
      </div>
    </>
  )
}

function TableCard({ table }: { table: SansTable }) {
  return (
    <div className="data-panel" style={{ overflow: 'hidden' }}>
      <div className="data-panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--c-text-dim)',
              marginRight: 8,
            }}
          >
            Table {table.section_number ?? '—'}
          </span>
          <span className="data-panel-title">{table.title}</span>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            color: 'var(--c-amber)',
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            padding: '3px 8px',
            borderRadius: 4,
          }}
        >
          {table.standard}
        </span>
      </div>

      {(table.cable_construction || table.description) && (
        <div
          style={{
            padding: '12px 18px',
            fontSize: 13,
            color: 'var(--c-text-mid)',
            borderBottom: '1px solid var(--c-border)',
          }}
        >
          {table.cable_construction && (
            <div style={{ color: 'var(--c-text)', fontWeight: 600, marginBottom: 4 }}>
              {table.cable_construction}
            </div>
          )}
          {table.description && <div>{table.description}</div>}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '10px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text-dim)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                  {c.unit && (
                    <span style={{ fontWeight: 400, color: 'var(--c-text-dim)' }}>
                      {' '}({c.unit})
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, idx) => (
              <tr key={idx} style={{ borderTop: '1px solid var(--c-border)' }}>
                {table.columns.map((c) => {
                  const v = row[c.key]
                  let display = '—'
                  if (v != null) {
                    if (c.type === 'number' && typeof v === 'number') {
                      display = c.decimals != null
                        ? v.toFixed(c.decimals)
                        : String(v)
                    } else {
                      display = String(v)
                    }
                  }
                  return (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.align ?? 'left',
                        padding: '8px 12px',
                        fontFamily: c.type === 'number' ? 'var(--font-mono)' : undefined,
                        fontSize: c.type === 'number' ? 12 : 13,
                        color: 'var(--c-text)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(table.notes || table.source_ref) && (
        <div
          style={{
            padding: '10px 18px',
            background: 'var(--c-base)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            borderTop: '1px solid var(--c-border)',
          }}
        >
          {table.notes && <div>Notes: {table.notes}</div>}
          {table.source_ref && (
            <div style={{ fontFamily: 'var(--font-mono)' }}>
              Source: {table.source_ref}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
