/**
 * Read the live reference tables (read-only) through the Management API, the
 * same credential path as scripts/verify-migration-applied.ts.
 */
import { execFileSync } from 'node:child_process'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'

function pat(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim()
    : raw
}

export async function readOnlyQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;` }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error(`Unexpected response: ${text.slice(0, 300)}`)
  return parsed as T[]
}

export interface LiveTable {
  code: string
  title: string
  standard: string
  section_number: string | null
  source_ref: string | null
  provenance?: string
  rows: Array<{ sort_key: number; row: Record<string, unknown> }>
}

export async function readLegacyTables(): Promise<LiveTable[]> {
  return readOnlyQuery<LiveTable>(`
    SELECT t.code, t.title, t.standard, t.section_number, t.source_ref,
           coalesce((SELECT json_agg(json_build_object('sort_key', r.sort_key, 'row', r.row_data) ORDER BY r.sort_key)
                       FROM cable_schedule.sans_rows r WHERE r.table_id = t.id), '[]') AS rows
      FROM cable_schedule.sans_tables t
     WHERE t.code LIKE 'TABLE\\_%'
     ORDER BY t.code`)
}
