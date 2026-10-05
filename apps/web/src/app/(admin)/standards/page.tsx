import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { referenceUsedBy } from '@esite/shared'
import { StandardsBrowser, type BrowserStandard, type BrowserTable } from './StandardsBrowser'

export const metadata: Metadata = { title: 'Standards' }

/**
 * The standards reference: registry of source documents, every reference
 * table the signed-in user may read (row security hides SANS-extracted tables
 * outside the WM org — owner decision D2), each value with its citation.
 */
export default async function StandardsPage() {
  const supabase = await createClient()
  const db = (supabase as any).schema('cable_schedule')
  const [stdRes, tblRes] = await Promise.all([
    db.from('ref_standards')
      .select('id, code, edition, year, title, publisher, kind, status, superseded_by, in_library, notes')
      .order('code').order('year', { ascending: false }),
    db.from('sans_tables')
      .select('id, code, title, standard, section_number, clause, provenance, verification, standard_id, columns, notes, source_ref, category, description, cable_construction'),
  ])

  // PostgREST caps a response at 1 000 rows; page through so no table is ever
  // silently truncated. Ordered by table then key so each page is coherent.
  const PAGE = 1000
  const allRows: Array<{ table_id: string; row_data: Record<string, unknown>; citation: BrowserTable['rows'][number]['citation'] }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('sans_rows')
      .select('table_id, sort_key, row_data, citation')
      .order('table_id', { ascending: true })
      .order('sort_key', { ascending: true })
      .order('id', { ascending: true }) // (table_id, sort_key) is not unique; id makes pages stable
      .range(from, from + PAGE - 1)
    // A partial library would look complete; fail the page instead.
    if (error) throw new Error(`Could not load reference rows: ${error.message}`)
    if (!data) break
    allRows.push(...data)
    if (data.length < PAGE) break
  }

  const rowsByTable = new Map<string, BrowserTable['rows']>()
  for (const r of allRows) {
    const list = rowsByTable.get(r.table_id) ?? []
    list.push({ data: r.row_data, citation: r.citation ?? null })
    rowsByTable.set(r.table_id, list)
  }

  const standards = (stdRes?.data ?? []) as BrowserStandard[]
  const tables: BrowserTable[] = ((tblRes?.data ?? []) as Array<Omit<BrowserTable, 'rows' | 'usedBy'> & { id: string }>).map((t) => ({
    ...t,
    rows: rowsByTable.get(t.id) ?? [],
    usedBy: referenceUsedBy(t.code),
  }))

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Standards</h1>
          <p className="page-subtitle">
            {tables.length} reference table{tables.length === 1 ? '' : 's'} · {standards.length} source documents ·
            values for internal engineering use; clause text and PDFs are not reproduced
          </p>
        </div>
      </div>
      <StandardsBrowser standards={standards} tables={tables} />
    </div>
  )
}
