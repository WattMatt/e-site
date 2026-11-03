import { z } from 'zod'
import { defineTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { assertIdent, assertIdents } from './identifiers'
import { assertWritable } from './denylist'
import { refuseOnDbError, type DbError } from './db-error'
import { MASKED } from './masked-columns'
import { maskRows } from './mask'
import { projectIdFromRows } from './project-id'

// The generic tools address arbitrary schema.table names, which the generated Database type cannot express.
interface InsertQuery {
  select(columns: string): PromiseLike<{ data: unknown; error: DbError }>
}
type Loose = { schema(s: string): { from(t: string): { insert(rows: Record<string, unknown>[]): InsertQuery } } }

export const esiteDbInsert = defineTool({
  name: 'esite_db_insert',
  title: 'Insert rows into a table',
  description:
    'Inserts 1..500 rows into any exposed schema.table as the signed-in person, so row-level security applies. Use esite_db_schemas first to see tables and columns. '
    + 'Each row is an object of column to value; column names must be plain identifiers. '
    + 'A few tables are managed in the app and refused: who is who, billing, sealed tenders, templates and the audit. '
    + 'Returns inserted, ids and the stored rows (all columns unless returning lists some). '
    + 'Cost figures in returned rows are null for roles that may not see them. '
    + 'Updates and deletes are separate: esite_db_update and esite_db_delete preview first.',
  kind: 'write',
  inputSchema: {
    schema: z.string(),
    table: z.string(),
    rows: z.array(z.record(z.unknown())).min(1).max(500),
    returning: z.array(z.string()).optional(),
  },
  projectIdOf: a => projectIdFromRows(a.rows),
  handler: async ({ schema, table, rows, returning }, ctx) => {
    assertExposedSchema(schema)
    assertIdent(table)
    for (const row of rows) assertIdents(Object.keys(row))
    assertIdents(returning ?? [])
    assertWritable(schema, table)

    // A masked row is judged by its owner; when the caller narrowed the list, the key is fetched, then stripped.
    const key = MASKED[`${schema}.${table}`]?.projectKey ?? null
    const needKey = key !== null && returning !== undefined && !returning.includes(key)
    const list = returning ? [...returning, ...(needKey ? [key] : [])].join(',') : '*'

    const { data, error } = await (ctx.client as unknown as Loose).schema(schema).from(table).insert(rows).select(list)
    refuseOnDbError(error)

    const masked = await maskRows(schema, table, (data ?? []) as Record<string, unknown>[], ctx)
    const out = needKey ? masked.rows.map(({ [key]: _k, ...rest }) => rest) : masked.rows
    const ids = out.map(r => r.id).filter((v): v is string => typeof v === 'string')
    return { inserted: rows.length, ids, rows: out }
  },
})
