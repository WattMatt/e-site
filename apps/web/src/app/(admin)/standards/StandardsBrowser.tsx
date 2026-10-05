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

export interface Citation {
  clause: string
  page_pdf: number
  page_printed: number
  printed?: Record<string, string>
  spanned_columns?: string[]
}

export interface Condition {
  key: string
  label: string
  unit: string | null
  value: string
  page_pdf: number
  page_printed: number
}

export type Topic = 'cable_ratings' | 'volt_drop' | 'derating' | 'earthing_protection' | 'building_energy'

export interface BrowserColumn {
  key: string
  label: string
  unit: string | null
  type?: 'number' | 'string'
  decimals?: number
  group?: string
}

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
  topic: Topic | null
  conditions: Condition[] | null
  columns: BrowserColumn[]
  notes: string | null
  source_ref: string | null
  category: string | null
  description?: string | null
  cable_construction?: string | null
  rows: Array<{ data: Record<string, unknown>; citation: Citation | null }>
  usedBy: UsedBy[]
}

export const TOPICS: Array<{ key: Topic; label: string; blurb: string }> = [
  { key: 'cable_ratings', label: 'Cable current ratings', blurb: 'Current-carrying capacity by conductor size and installation method' },
  { key: 'volt_drop', label: 'Volt drop and impedance', blurb: 'mV/A/m and conductor resistance and reactance' },
  { key: 'derating', label: 'Derating factors', blurb: 'Temperature, soil, depth, grouping, solar, neutral and harmonic corrections' },
  { key: 'earthing_protection', label: 'Earthing and protection', blurb: 'Protective conductors, earth-continuity lengths and resistances, protection ratings' },
  { key: 'building_energy', label: 'Building energy (SANS 10400-XA)', blurb: 'Demand intensity and lighting power density by occupancy' },
]

/** "6.3.10" after "6.3.2"; "6.4(a)" before "6.4(b)". */
export function naturalClauseKey(clause: string | null): string {
  return (clause ?? '').replace(/^Table\s+/, '').replace(/\d+/g, (d) => d.padStart(4, '0'))
}

/** A cell as the reader should see it: as printed (decimal point), else the stored number at the column's precision. */
export function cellText(value: unknown, printed: string | undefined, decimals?: number): string {
  if (printed !== undefined && printed !== '') return printed.replace(/(\d),(\d)/g, '$1.$2').replace(/^-$/, '–')
  if (value === null) return '–'
  if (value === undefined) return ''
  if (typeof value === 'number' && decimals !== undefined) return value.toFixed(decimals)
  return String(value)
}

function sourceLabel(s: BrowserStandard | undefined, fallback: string): string {
  if (!s) return fallback
  return s.kind === 'manufacturer' ? 'Aberdare Facts & Figures (manufacturer data)' : `${s.code}:${s.year ?? ''} · Edition ${s.edition}`
}

export function StandardsBrowser({ standards, tables, initialCode = null }: { standards: BrowserStandard[]; tables: BrowserTable[]; initialCode?: string | null }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(initialCode && tables.some((t) => t.code === initialCode) ? initialCode : null)
  const byStd = useMemo(() => new Map(standards.map((s) => [s.id, s])), [standards])

  useEffect(() => {
    const fromUrl = (): string | null => {
      try {
        const t = new URLSearchParams(window.location.search).get('t')
        return t && tables.some((x) => x.code === t) ? t : null
      } catch { return null }
    }
    // On mount, adopt a table the URL names (the server already did for deep links); never clear one.
    const initial = fromUrl()
    if (initial) setSelected(initial)
    // Back / forward: the URL is the source of truth.
    const onPop = (): void => setSelected(fromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [tables])

  const open = (code: string | null): void => {
    setSelected(code)
    try {
      const u = new URL(window.location.href)
      if (code) u.searchParams.set('t', code); else u.searchParams.delete('t')
      window.history.pushState(null, '', u.toString())
      window.scrollTo({ top: 0 })
    } catch { /* no history API — state alone is enough */ }
  }

  const current = tables.find((t) => t.code === selected) ?? null
  if (current) {
    return <TableView table={current} standards={standards} tables={tables} byStd={byStd} onOpen={open} />
  }

  const q = query.trim().toLowerCase()
  const matches = (t: BrowserTable): boolean => {
    if (!q) return true
    const s = t.standard_id ? byStd.get(t.standard_id) : undefined
    const hay = [t.title, t.clause, t.code, s?.code, s?.title, s?.year, s ? `ed ${s.edition}` : '',
      TOPICS.find((x) => x.key === t.topic)?.label, ...(t.conditions ?? []).map((c) => c.label)]
    return hay.some((v) => v != null && String(v).toLowerCase().includes(q))
  }

  const rank = (t: BrowserTable): number => {
    const s = t.standard_id ? byStd.get(t.standard_id) : undefined
    if (!s || s.kind === 'manufacturer') return 2
    return s.status === 'current' ? 0 : 1
  }
  const sorted = [...tables].filter(matches).sort((a, b) =>
    rank(a) - rank(b) || naturalClauseKey(a.clause).localeCompare(naturalClauseKey(b.clause)))

  const loadedPerStd = new Map<string, number>()
  for (const t of tables) if (t.standard_id) loadedPerStd.set(t.standard_id, (loadedPerStd.get(t.standard_id) ?? 0) + 1)

  return (
    <div className="std-landing">
      <input
        className="form-input std-search"
        type="search"
        placeholder="Search tables — e.g. grouping, volt drop, 6.13, lighting"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search standards and tables"
      />
      {sorted.length === 0 && <div className="data-panel-empty">Nothing matches “{query}”.</div>}
      {[...TOPICS, { key: null, label: 'Other tables', blurb: 'Tables not yet filed under a topic' }].map((topic) => {
        const ts = sorted.filter((t) => (topic.key === null ? !TOPICS.some((x) => x.key === t.topic) : t.topic === topic.key))
        if (ts.length === 0) return null
        const groups: Array<[string, BrowserTable[]]> = [
          ['SANS — current edition', ts.filter((t) => rank(t) === 0)],
          ['SANS — earlier editions', ts.filter((t) => rank(t) === 1)],
          ['Manufacturer data (Aberdare) used by the cable schedule', ts.filter((t) => rank(t) === 2)],
        ]
        return (
          <section key={topic.key ?? 'other'} className="std-topic" aria-labelledby={`topic-${topic.key ?? 'other'}`}>
            <h2 id={`topic-${topic.key ?? 'other'}`} className="std-topic-title">{topic.label}</h2>
            <p className="std-topic-blurb">{topic.blurb}</p>
            {groups.map(([label, list]) => list.length === 0 ? null : (
              <details key={label} className="std-subgroup" open={label.startsWith('SANS — current') || !!q}>
                <summary>{label} <span className="std-count">{list.length}</span></summary>
                <ul className="std-list">
                  {list.map((t) => {
                    const s = t.standard_id ? byStd.get(t.standard_id) : undefined
                    return (
                      <li key={t.id}>
                        <button type="button" className="std-item" onClick={() => open(t.code)}>
                          <span className="std-item-clause">{t.clause ?? t.section_number}</span>
                          <span className="std-item-title">{t.title}</span>
                          <span className="std-item-src">{s?.kind === 'manufacturer' ? 'Aberdare' : s ? `${s.code}:${s.year}` : ''}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </details>
            ))}
          </section>
        )
      })}

      <section className="std-topic" aria-labelledby="topic-sources">
        <h2 id="topic-sources" className="std-topic-title">Source documents</h2>
        <ul className="std-sources">
          {[...standards].sort((a, b) => (loadedPerStd.get(b.id) ?? 0) - (loadedPerStd.get(a.id) ?? 0) || a.code.localeCompare(b.code)).map((s) => (
            <li key={s.id}>
              <span className="std-source-name">{s.kind === 'manufacturer' ? s.code : `${s.code}:${s.year ?? ''}`}</span>
              {s.kind === 'standard' && <span className="badge badge-muted">Ed {s.edition}</span>}
              <span className={`badge ${s.status === 'current' ? 'badge-green' : 'badge-amber'}`}>{s.status}</span>
              <span className="std-muted">
                {loadedPerStd.get(s.id) ? `${loadedPerStd.get(s.id)} table${loadedPerStd.get(s.id) === 1 ? '' : 's'}` : s.in_library ? 'In the library — no tables loaded yet' : 'Not in the library'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function TableView({
  table, standards, tables, byStd, onOpen,
}: {
  table: BrowserTable
  standards: BrowserStandard[]
  tables: BrowserTable[]
  byStd: Map<string, BrowserStandard>
  onOpen: (code: string | null) => void
}) {
  const std = table.standard_id ? byStd.get(table.standard_id) : undefined
  const pages = table.rows.map((r) => r.citation?.page_printed).filter((p): p is number => typeof p === 'number')
  const pageText = pages.length === 0 ? null : Math.min(...pages) === Math.max(...pages) ? `p.${pages[0]}` : `pp.${Math.min(...pages)}–${Math.max(...pages)}`

  // Other editions of the same clause, and whether their values match.
  const editions = std && table.clause
    ? tables.filter((t) => t.id !== table.id && t.clause === table.clause && t.standard_id && byStd.get(t.standard_id)?.code === std.code
        && t.code.replace(/_\d{4}_/, '_') === table.code.replace(/_\d{4}_/, '_'))
    : []
  const sameValues = (o: BrowserTable): boolean => JSON.stringify(o.rows.map((r) => r.data)) === JSON.stringify(table.rows.map((r) => r.data))
  const newer = std?.superseded_by ? standards.find((s) => s.id === std.superseded_by) : undefined
  const newerTable = newer ? editions.find((t) => t.standard_id === newer.id) : undefined

  const cols = table.columns
  const hasGroups = cols.some((c) => c.group)
  const groupRuns: Array<{ label: string; span: number }> = []
  for (const c of cols.slice(1)) {
    const g = c.group ?? ''
    const last = groupRuns[groupRuns.length - 1]
    if (g && last && last.label === g) last.span++; else groupRuns.push({ label: g, span: 1 })
  }
  const spanned = table.rows.some((r) => r.citation?.spanned_columns?.length)
  // An extracted cell with nothing printed (e.g. r/x below 25 mm², where one total is printed per group).
  const hasBlank = table.provenance === 'extracted' && table.rows.some((r) => cols.slice(1).some((c) => !(c.key in r.data)))

  const v = table.verification
  const compared = v?.coverage ? Object.keys(v.coverage) : []
  const colLabel = (k: string): string => cols.find((c) => c.key === k)?.label ?? k
  const notCompared = table.provenance === 'transcribed' && v && (v.status === 'verified' || v.status === 'partially_verified')
    ? cols.slice(1).map((c) => c.key).filter((k) => !compared.includes(k)) : []

  return (
    <article className="std-view">
      <button type="button" className="std-back" onClick={() => onOpen(null)}>← All tables</button>
      <h2 className="std-view-title">{table.title}</h2>
      <p className="std-view-cite">
        {sourceLabel(std, table.standard)}{table.clause ? ` · ${table.clause}` : ''}{pageText ? ` · ${pageText}` : ''}
      </p>
      <div className="std-badges">
        {std?.kind === 'standard' && (
          <span className={`badge ${std.status === 'current' ? 'badge-green' : 'badge-amber'}`}>
            {std.status === 'current' ? 'Current edition' : 'Superseded edition'}
          </span>
        )}
        {table.provenance === 'extracted' && <span className="badge badge-blue">Every value cited to its page</span>}
        {std?.kind === 'manufacturer' && <span className="badge badge-muted">Manufacturer data</span>}
        {v?.status === 'verified' && <span className="badge badge-green">Equal to SANS</span>}
        {v?.status === 'partially_verified' && <span className="badge badge-blue">Equal to SANS where SANS has it</span>}
        {v?.status === 'mismatch' && <span className="badge badge-red">Differs from SANS</span>}
      </div>

      {newer && (
        <p className="std-banner">
          A newer edition is current: {newer.code}:{newer.year} Edition {newer.edition}.{' '}
          {newerTable && <button type="button" className="std-link" onClick={() => onOpen(newerTable.code)}>Open {newerTable.clause} there</button>}
        </p>
      )}

      {(table.conditions?.length ?? 0) > 0 && (
        <div className="std-conditions" role="note" aria-label="Conditions this table is valid for">
          <span className="std-conditions-label">Valid for</span>
          <ul>
            {table.conditions!.map((c) => (
              <li key={c.key}>{c.label}: <strong>{c.value}{c.unit ? ` ${c.unit}` : ''}</strong> <span className="std-muted">p.{c.page_printed}</span></li>
            ))}
          </ul>
        </div>
      )}
      {table.notes && <p className="std-note">{table.notes}</p>}
      {table.cable_construction && <p className="std-note">Construction: {table.cable_construction}</p>}

      <div className="std-table-wrap" role="region" tabIndex={0} aria-label={`${table.title} values`}>
        <table className="std-table">
          <thead>
            {hasGroups && (
              <tr>
                <th rowSpan={2} scope="col" className="std-sticky">{cols[0].label}{cols[0].unit ? <span className="std-unit"> {cols[0].unit}</span> : null}</th>
                {(() => {
                  let at = 1
                  return groupRuns.map((g, i) => {
                    const first = cols[at]; at += g.span
                    // A column outside any group spans both header rows rather than sitting under an empty cell.
                    return g.label
                      ? <th key={i} colSpan={g.span} scope="colgroup" className="std-group">{g.label}</th>
                      : <th key={i} rowSpan={2} scope="col" className={first.type === 'string' ? 'std-text' : undefined}>{first.label}{first.unit ? <span className="std-unit"> {first.unit}</span> : null}</th>
                  })
                })()}
              </tr>
            )}
            <tr>
              {!hasGroups && <th scope="col" className="std-sticky">{cols[0].label}{cols[0].unit ? <span className="std-unit"> {cols[0].unit}</span> : null}</th>}
              {cols.slice(1).filter((c) => !hasGroups || !!c.group).map((c) => (
                <th key={c.key} scope="col" className={c.type === 'string' ? 'std-text' : undefined}>{c.label}{c.unit ? <span className="std-unit"> {c.unit}</span> : null}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                <th scope="row" className="std-sticky">{cellText(r.data[cols[0].key], r.citation?.printed?.[cols[0].key] || undefined, cols[0].decimals)}</th>
                {cols.slice(1).map((c) => (
                  <td key={c.key} className={c.type === 'string' ? 'std-text' : undefined}>
                    {cellText(r.data[c.key], r.citation?.printed?.[c.key], c.decimals)}
                    {r.citation?.spanned_columns?.includes(c.key) ? <sup title="Printed once for a band of rows">†<span className="sr-only"> printed once for a band of rows</span></sup> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spanned && <p className="std-note">† Printed once in the standard for the whole band of rows.</p>}
      {hasBlank && <p className="std-note">A blank cell is blank in the standard too; – means the standard prints a dash (not applicable).</p>}

      <section className="std-usedby" aria-label="Used by">
        <h3>How the app uses this table</h3>
        {table.usedBy.length === 0 ? (
          <p className="std-muted">Reference only. No calculator reads this table yet.</p>
        ) : (
          <ul>{table.usedBy.map((u, i) => <li key={i}><a href={u.href}>{u.calculator}</a>: {u.use}</li>)}</ul>
        )}
      </section>

      <details className="std-provenance">
        <summary>Source and verification</summary>
        <dl>
          <dt>Source</dt>
          <dd>{sourceLabel(std, table.standard)}{table.clause ? `, ${table.clause}` : ''}{pageText ? `, printed ${pageText}` : ''}{std && !std.in_library ? ' (not held in the WM standards library)' : ''}</dd>
          {table.provenance === 'extracted' && <><dt>How it was captured</dt><dd>Read from the licensed PDF by the extraction script; each row carries its printed and PDF page, and values are shown exactly as printed.</dd></>}
          {editions.length > 0 && (
            <>
              <dt>Other editions</dt>
              <dd>
                {editions.map((o) => {
                  const os = o.standard_id ? byStd.get(o.standard_id) : undefined
                  return (
                    <span key={o.id} className="std-edition">
                      <button type="button" className="std-link" onClick={() => onOpen(o.code)}>{os ? `${os.code}:${os.year} Ed ${os.edition}` : o.code}</button>
                      {' — '}{sameValues(o) ? 'same values' : 'values differ'}
                    </span>
                  )
                })}
              </dd>
            </>
          )}
          {v && (
            <>
              <dt>Checked against SANS</dt>
              <dd>
                {v.status === 'not_checkable' ? (v.note ?? 'No counterpart in the standards library.') : (
                  <>
                    {(v.against ?? []).map((a) => a.citation ?? `${a.standard ?? ''} Ed ${a.edition ?? ''} ${a.clause ?? ''}${a.page_printed ? `, p.${a.page_printed}` : ''}`).join('; ')}
                    {v.checked_on ? ` on ${v.checked_on}` : ''}.
                    {compared.length > 0 && <> Columns compared cell by cell: {compared.map(colLabel).join(', ')}.</>}
                    {notCompared.length > 0 && <> Not tabulated by SANS (manufacturer data only): {notCompared.map(colLabel).join(', ')}.</>}
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
      </details>
    </article>
  )
}
