import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { SansTableViewer, type SansTable } from './SansTableViewer'

export const metadata: Metadata = { title: 'SANS reference' }

interface SansTableRow {
  id: string
  code: string
  title: string
  standard: string
  section_number: string | null
  cable_construction: string | null
  description: string | null
  columns: SansTable['columns']
  notes: string | null
  source_ref: string | null
}

interface SansRowDataRow {
  table_id: string
  sort_key: number
  row_data: Record<string, unknown>
}

export default async function SansReferencePage() {
  const supabase = await createClient()

  const [tablesRes, rowsRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('sans_tables')
      .select(
        'id, code, title, standard, section_number, cable_construction, description, columns, notes, source_ref',
      )
      .order('section_number', { ascending: true, nullsFirst: false }),
    (supabase as any)
      .schema('cable_schedule')
      .from('sans_rows')
      .select('table_id, sort_key, row_data')
      .order('sort_key', { ascending: true }),
  ])

  const tableRows = (tablesRes?.data ?? []) as unknown as SansTableRow[]
  const allRows = (rowsRes?.data ?? []) as unknown as SansRowDataRow[]

  // Group rows by table
  const rowsByTable = new Map<string, SansRowDataRow[]>()
  for (const r of allRows) {
    if (!rowsByTable.has(r.table_id)) rowsByTable.set(r.table_id, [])
    rowsByTable.get(r.table_id)!.push(r)
  }

  const tables: SansTable[] = tableRows.map((t) => ({
    id: t.id,
    code: t.code,
    title: t.title,
    standard: t.standard,
    section_number: t.section_number,
    cable_construction: t.cable_construction,
    description: t.description,
    columns: t.columns,
    notes: t.notes,
    source_ref: t.source_ref,
    rows: (rowsByTable.get(t.id) ?? []).map((r) => r.row_data),
  }))

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">SANS reference library</h1>
          <p className="page-subtitle">
            {tables.length} table{tables.length !== 1 ? 's' : ''} embedded ·
            {' '}cable schedule lookups read from these tables by default
          </p>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="data-panel">
          <div
            className="data-panel-empty"
            style={{ padding: '48px 18px', textAlign: 'center' }}
          >
            📚 No tables seeded yet.
          </div>
        </div>
      ) : (
        <SansTableViewer tables={tables} />
      )}
    </div>
  )
}
