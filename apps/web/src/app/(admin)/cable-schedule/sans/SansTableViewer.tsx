'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { TableScrollX } from '@/components/ui/TableScrollX'

export interface SansColumn {
  key: string
  label: string
  unit: string | null
  type: 'number' | 'string'
  decimals?: number
  align?: 'left' | 'right'
  width?: number
}

export interface ApplicableTo {
  voltage_class?: string
  conductor?: string
  insulation?: string
  armour?: string
  cores?: number[] | string
}

export interface SansTable {
  id: string
  code: string
  title: string
  standard: string
  section_number: string | null
  cable_construction: string | null
  description: string | null
  category: string | null
  applicable_to: ApplicableTo | null
  columns: SansColumn[]
  notes: string | null
  source_ref: string | null
  rows: Record<string, unknown>[]
}

function anchorId(code: string): string {
  return 'sans-' + code.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// Render applicable_to like the Excel header — "MV · Cu / Al · PAPER · STA ·
// 3-core" — skipping ANY/unset fields.
function formatApplicable(a: ApplicableTo | null): string | null {
  if (!a) return null
  const parts: string[] = []
  if (a.voltage_class && a.voltage_class !== 'ANY') parts.push(a.voltage_class)
  if (a.conductor && a.conductor !== 'ANY') {
    parts.push(a.conductor === 'BOTH' ? 'Cu / Al' : a.conductor)
  }
  if (a.insulation && a.insulation !== 'ANY') parts.push(a.insulation)
  if (a.armour && a.armour !== 'ANY') parts.push(a.armour)
  if (Array.isArray(a.cores) && a.cores.length > 0) parts.push(a.cores.join('/') + '-core')
  return parts.length > 0 ? parts.join(' · ') : null
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by section, standard, or construction…"
          className="ob-input"
          style={{ flex: 1, minWidth: 240, maxWidth: 420 }}
        />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
          {filtered.length} of {tables.length} tables
        </div>
      </div>

      <IndexPanel tables={filtered} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
        {filtered.map((t) => (
          <TableCard key={t.id} table={t} />
        ))}
      </div>
    </>
  )
}

// ─── index ──────────────────────────────────────────────────────────
// Mirrors the "Index" sheet in SANS_Reference_Library.xlsx — every table
// listed by number / standard / title, each row a jump link to its card.

function IndexPanel({ tables }: { tables: SansTable[] }) {
  if (tables.length === 0) return null
  return (
    <div className="data-panel" style={{ overflow: 'hidden' }}>
      <div className="data-panel-header">
        <span className="data-panel-title">Index</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
          {tables.length} table{tables.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <th style={indexTh}>Table</th>
              <th style={indexTh}>Standard</th>
              <th style={indexTh}>Category</th>
              <th style={indexTh}>Title</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                <td style={{ ...indexTd, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  <a href={'#' + anchorId(t.code)} style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>
                    {t.section_number ?? t.code}
                  </a>
                </td>
                <td style={{ ...indexTd, whiteSpace: 'nowrap', color: 'var(--c-text-mid)' }}>
                  {t.standard}
                </td>
                <td
                  style={{
                    ...indexTd,
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--c-text-dim)',
                  }}
                >
                  {t.category ?? '—'}
                </td>
                <td style={indexTd}>
                  <a href={'#' + anchorId(t.code)} style={{ color: 'var(--c-text)', textDecoration: 'none' }}>
                    {t.title}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const indexTh: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  fontWeight: 600,
}
const indexTd: CSSProperties = { padding: '7px 12px', color: 'var(--c-text)' }

// ─── table card ─────────────────────────────────────────────────────
// One card per table, laid out like an Excel sheet: "Table X.X — Title"
// header, a Standard / Construction metadata block, a two-row column
// header (labels then units), spreadsheet gridlines, and a Source footer.

function TableCard({ table }: { table: SansTable }) {
  const applicable = formatApplicable(table.applicable_to)
  return (
    <div
      id={anchorId(table.code)}
      className="data-panel"
      style={{ overflow: 'hidden', scrollMarginTop: 24 }}
    >
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--c-amber)',
              whiteSpace: 'nowrap',
            }}
          >
            Table {table.section_number ?? '—'}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
            {table.title}
          </span>
        </div>

        <div
          style={{
            marginTop: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span>
            Standard: <span style={{ color: 'var(--c-text-mid)' }}>{table.standard}</span>
          </span>
          {table.category && (
            <span>
              Category: <span style={{ color: 'var(--c-text-mid)' }}>{table.category}</span>
            </span>
          )}
          {table.cable_construction && (
            <span>
              Construction:{' '}
              <span style={{ color: 'var(--c-text-mid)' }}>{table.cable_construction}</span>
            </span>
          )}
          {applicable && (
            <span>
              Applicable to: <span style={{ color: 'var(--c-text-mid)' }}>{applicable}</span>
            </span>
          )}
        </div>

        {table.description && (
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--c-text-mid)' }}>
            {table.description}
          </div>
        )}
      </div>

      <TableScrollX>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            {/* row 1 — column labels */}
            <tr style={{ background: 'var(--c-base)' }}>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    ...gridCell,
                    textAlign: c.align ?? 'left',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text-dim)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
            {/* row 2 — units, mirrors the Excel "(mm²) (A) …" row */}
            <tr style={{ background: 'var(--c-base)' }}>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    ...gridCell,
                    textAlign: c.align ?? 'left',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--c-text-dim)',
                    fontWeight: 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.unit ? `(${c.unit})` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, idx) => (
              <tr key={idx}>
                {table.columns.map((c) => {
                  const v = row[c.key]
                  let display = '—'
                  if (v != null) {
                    if (c.type === 'number' && typeof v === 'number') {
                      display = c.decimals != null ? v.toFixed(c.decimals) : String(v)
                    } else {
                      display = String(v)
                    }
                  }
                  return (
                    <td
                      key={c.key}
                      style={{
                        ...gridCell,
                        textAlign: c.align ?? 'left',
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
            {table.rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.columns.length}
                  style={{
                    ...gridCell,
                    padding: '16px 12px',
                    textAlign: 'center',
                    color: 'var(--c-text-dim)',
                    fontStyle: 'italic',
                  }}
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScrollX>

      {/* Footnote block — renders like the NOTE lines printed under every
          SANS / Aberdare table (reference conditions, correction-factor
          cross-references, misprint flags). notes may carry several
          newline-separated entries (seeded by migration 00166); each gets
          its own NOTE line. Standard + source always close the block so an
          engineer can see the provenance without scrolling to the header. */}
      <div
        style={{
          padding: '10px 18px',
          background: 'var(--c-base)',
          fontSize: 11,
          color: 'var(--c-text-dim)',
          borderTop: '1px solid var(--c-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {(table.notes ?? '')
          .split(/\n+/)
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
          .map((note, i, all) => (
            <div key={i} style={{ display: 'flex', gap: 8, color: 'var(--c-text-mid)' }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  color: 'var(--c-text-dim)',
                  whiteSpace: 'nowrap',
                  paddingTop: 1,
                }}
              >
                NOTE{all.length > 1 ? ` ${i + 1}` : ''}
              </span>
              <span>{note}</span>
            </div>
          ))}
        <div style={{ fontFamily: 'var(--font-mono)' }}>
          Standard: {table.standard}
        </div>
        {table.source_ref && (
          <div style={{ fontFamily: 'var(--font-mono)' }}>Source: {table.source_ref}</div>
        )}
      </div>
    </div>
  )
}

// Spreadsheet-style gridlines on every header + body cell.
const gridCell: CSSProperties = {
  padding: '7px 12px',
  borderRight: '1px solid var(--c-border)',
  borderBottom: '1px solid var(--c-border)',
}
