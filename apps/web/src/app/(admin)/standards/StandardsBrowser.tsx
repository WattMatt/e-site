'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReferenceVerdict, UsedBy } from '@esite/shared'

export interface BrowserStandard {
  id: string
  code: string
  edition: string
  year: number | null
  title: string
  publisher: string
  kind: 'standard' | 'manufacturer'
  status: 'current' | 'superseded' | 'withdrawn'
  superseded_by: string | null
  in_library: boolean
  notes: string | null
}

export interface Citation { clause: string; page_pdf: number; page_printed: number; spanned_columns?: string[] }

export interface BrowserTable {
  id: string
  code: string
  title: string
  standard: string
  section_number: string | null
  clause: string | null
  provenance: 'transcribed' | 'extracted'
  verification: ReferenceVerdict | null
  standard_id: string | null
  columns: Array<{ key: string; label: string; unit: string | null }>
  notes: string | null
  source_ref: string | null
  category: string | null
  description?: string | null
  cable_construction?: string | null
  rows: Array<{ data: Record<string, unknown>; citation: Citation | null }>
  usedBy: UsedBy[]
}

const VERDICT: Record<ReferenceVerdict['status'], { label: string; tone: string }> = {
  verified: { label: 'Verified against SANS', tone: 'badge-green' },
  partially_verified: { label: 'Verified where SANS tabulates it', tone: 'badge-blue' },
  mismatch: { label: 'Differs from SANS', tone: 'badge-red' },
  not_checkable: { label: 'Not checkable against the library', tone: 'badge-muted' },
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '–'
  return typeof v === 'number' ? String(v) : String(v)
}

/** "p.118" or "pp.118–119", from the rows' own citations. */
function pageRange(rows: BrowserTable['rows']): string | null {
  const pages = rows.map((r) => r.citation?.page_printed).filter((p): p is number => typeof p === 'number')
  if (pages.length === 0) return null
  const lo = Math.min(...pages); const hi = Math.max(...pages)
  return lo === hi ? `p.${lo}` : `pp.${lo}–${hi}`
}

function editionLabel(s: BrowserStandard): string {
  return s.kind === 'manufacturer' ? 'Manufacturer data' : `${s.code}:${s.year ?? '—'} · Ed ${s.edition}`
}

export function StandardsBrowser({ standards, tables }: { standards: BrowserStandard[]; tables: BrowserTable[] }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('t')
      if (t && tables.some((x) => x.code === t)) setSelected(t)
    } catch { /* no URL access — start unselected */ }
  }, [tables])

  const select = (code: string) => {
    setSelected(code)
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('t', code)
      window.history.replaceState(null, '', u.toString())
    } catch { /* ignore */ }
  }

  const byStandard = useMemo(() => new Map(standards.map((s) => [s.id, s])), [standards])
  const q = query.trim().toLowerCase()
  const matches = (t: BrowserTable): boolean => {
    if (!q) return true
    const s = t.standard_id ? byStandard.get(t.standard_id) : undefined
    return [t.code, t.title, t.clause, t.standard, t.category, s?.code, s?.title, s ? `ed ${s.edition}` : '', s?.year]
      .some((v) => v != null && String(v).toLowerCase().includes(q))
  }

  const groups = standards
    .map((s) => ({ s, tables: tables.filter((t) => t.standard_id === s.id && matches(t)) }))
    .filter((g) => g.tables.length > 0 || (!q ? true : `${g.s.code} ${g.s.title}`.toLowerCase().includes(q)))
  const unlinked = tables.filter((t) => !t.standard_id && matches(t))
  const current = tables.find((t) => t.code === selected) ?? null

  return (
    <div className="std-layout">
      <aside className="std-index" aria-label="Standards and tables">
        <input
          className="form-input"
          type="search"
          placeholder="Search standards, tables, clauses…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search standards and tables"
          style={{ width: '100%', marginBottom: 12 }}
        />
        {groups.length === 0 && unlinked.length === 0 && (
          <div className="data-panel-empty">Nothing matches “{query}”.</div>
        )}
        {groups.map(({ s, tables: ts }) => (
          <section key={s.id} className="std-group">
            <div className="std-group-head">
              <span className="std-group-code">{s.kind === 'manufacturer' ? s.code : `${s.code}:${s.year ?? ''}`}</span>
              {s.kind === 'standard' && <span className="badge badge-muted">Ed {s.edition}</span>}
              <span className={`badge ${s.status === 'current' ? 'badge-green' : 'badge-amber'}`}>
                {s.status === 'current' ? 'Current' : s.status === 'superseded' ? 'Superseded' : 'Withdrawn'}
              </span>
              {!s.in_library && <span className="badge badge-muted">Not in library</span>}
            </div>
            <div className="std-group-title">{s.title}</div>
            {ts.length === 0 ? (
              <div className="std-group-empty">No tables loaded yet</div>
            ) : (
              <ul className="std-table-list">
                {ts.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`std-table-link${t.code === selected ? ' is-active' : ''}`}
                      onClick={() => select(t.code)}
                      aria-current={t.code === selected ? 'true' : undefined}
                    >
                      <span className="std-table-clause">{t.clause ?? t.section_number ?? t.code}</span>
                      <span>{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {unlinked.length > 0 && (
          <section className="std-group">
            <div className="std-group-head"><span className="std-group-code">Unlinked tables</span></div>
            <ul className="std-table-list">
              {unlinked.map((t) => (
                <li key={t.id}>
                  <button type="button" className="std-table-link" onClick={() => select(t.code)}>
                    <span>{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <section className="std-detail" aria-label="Table detail">
        {current ? (
          <TableDetail table={current} standards={standards} tables={tables} onSelect={select} />
        ) : (
          <div className="data-panel">
            <div className="data-panel-empty" style={{ padding: '40px 18px', textAlign: 'center' }}>
              Pick a table to see its values, the clause and page each comes from, and which calculator uses it.
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function TableDetail({
  table, standards, tables, onSelect,
}: { table: BrowserTable; standards: BrowserStandard[]; tables: BrowserTable[]; onSelect: (code: string) => void }) {
  const std = standards.find((s) => s.id === table.standard_id) ?? null
  const newer = std?.superseded_by ? standards.find((s) => s.id === std.superseded_by) ?? null : null
  const newerTable = newer && table.clause
    ? tables.find((t) => t.standard_id === newer.id && t.clause === table.clause) ?? null
    : null
  const pages = pageRange(table.rows)
  const verdict = table.verification ? VERDICT[table.verification.status] : null
  const cited = table.provenance === 'extracted'

  return (
    <div className="data-panel">
      <div className="std-detail-head">
        <h2 className="std-detail-title">{table.title}</h2>
        <div className="std-cite">
          {std ? editionLabel(std) : table.standard}
          {table.clause ? ` · ${table.clause}` : ''}
          {pages ? ` · ${pages}` : ''}
        </div>
        <div className="std-badges">
          {std && std.kind === 'standard' && (
            <span className={`badge ${std.status === 'current' ? 'badge-green' : 'badge-amber'}`}>
              Edition {std.edition} · {std.status}
            </span>
          )}
          {cited && <span className="badge badge-blue">Every value cited</span>}
          {verdict && <span className={`badge ${verdict.tone}`}>{verdict.label}</span>}
        </div>
        {newer && (
          <p className="std-note">
            Superseded by {newer.code}:{newer.year} Ed {newer.edition}.{' '}
            {newerTable ? (
              <button type="button" className="std-inline-link" onClick={() => onSelect(newerTable.code)}>
                Open {newerTable.clause} in the current edition
              </button>
            ) : 'That edition’s table is not loaded.'}
          </p>
        )}
        {table.verification?.against && table.verification.against.length > 0 && (
          <p className="std-note">
            Compared cell by cell with{' '}
            {table.verification.against
              .map((a) => a.citation ?? `${a.standard ?? ''} Ed ${a.edition ?? ''} ${a.clause ?? ''}${a.page_printed ? `, p.${a.page_printed}` : ''}`)
              .join('; ')}
            {table.verification.checked_on ? ` on ${table.verification.checked_on}` : ''}.
          </p>
        )}
        {table.cable_construction && <p className="std-note">Construction: {table.cable_construction}</p>}
        {table.description && <p className="std-note">{table.description}</p>}
        {table.verification?.note && <p className="std-note">{table.verification.note}</p>}
        {table.notes && <p className="std-note">{table.notes}</p>}
        <div className="std-usedby">
          <span className="std-usedby-label">Used by</span>
          {table.usedBy.length === 0 ? (
            <span className="std-muted">Reference only — no calculator reads this table.</span>
          ) : (
            <ul>
              {table.usedBy.map((u, i) => (
                <li key={i}>
                  <a href={u.href}>{u.calculator}</a> — {u.use}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {table.rows.length === 0 ? (
        <div className="data-panel-empty">No rows.</div>
      ) : (
        <>
          <div className="std-table-wrap">
            <table className="std-table">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col">{c.label}{c.unit ? <span className="std-unit"> ({c.unit})</span> : null}</th>
                  ))}
                  {cited && <th scope="col">Source</th>}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {table.columns.map((c, k) => (
                      k === 0
                        ? <th key={c.key} scope="row">{fmtCell(r.data[c.key])}</th>
                        : <td key={c.key}>{fmtCell(r.data[c.key])}{r.citation?.spanned_columns?.includes(c.key) ? <sup title="One value printed for this band of rows">†</sup> : null}</td>
                    ))}
                    {cited && <td className="std-muted">{r.citation ? `${r.citation.clause}, p.${r.citation.page_printed}` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="std-cards" aria-label={`${table.title} rows`}>
            {table.rows.map((r, i) => {
              const [keyCol, ...valueCols] = table.columns
              return (
                <li key={i} className="std-card">
                  <div className="std-card-key">
                    {keyCol?.label}: <strong>{fmtCell(r.data[keyCol?.key ?? ''])}</strong>{keyCol?.unit ? ` ${keyCol.unit}` : ''}
                  </div>
                  <dl>
                    {valueCols.map((c) => (
                      <div key={c.key} className="std-card-row">
                        <dt>{c.label}{c.unit ? ` (${c.unit})` : ''}</dt>
                        <dd>{fmtCell(r.data[c.key])}</dd>
                      </div>
                    ))}
                  </dl>
                  {r.citation && <div className="std-muted std-card-cite">{r.citation.clause}, printed p.{r.citation.page_printed} (PDF p.{r.citation.page_pdf})</div>}
                </li>
              )
            })}
          </ul>
          {table.rows.some((r) => r.citation?.spanned_columns?.length) && (
            <p className="std-note">† One value printed for this band of rows in the standard.</p>
          )}
        </>
      )}
      {table.source_ref && <p className="std-note std-muted">Source: {table.source_ref}</p>}
    </div>
  )
}
