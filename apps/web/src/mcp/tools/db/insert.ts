import { z } from 'zod'
import { defineTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { assertIdent, assertIdents } from './identifiers'
import { assertWritable } from './denylist'
import { refuseOnDbError, type DbError } from './db-error'
import { maskWrittenRows, ownerKeyOf } from './mask'
import { idsOf, projectIdFromRows } from './project-id'

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
    returning: z.array(z.string()).min(1).optional(),
  },
  projectIdOf: a => projectIdFromRows(a.rows),
  handler: async ({ schema, table, rows, returning }, ctx) => {
    assertExposedSchema(schema)
    assertIdent(table)
    for (const row of rows) assertIdents(Object.keys(row))
    assertIdents(returning ?? [])
    assertWritable(schema, table)

    // A masked row is judged by its owner (project, else organisation); when the caller narrowed the list, the key
    // is fetched, then stripped.
    const key = ownerKeyOf(schema, table)
    const needKey = key !== null && returning !== undefined && !returning.includes(key)
    const list = returning ? [...returning, ...(needKey ? [key] : [])].join(',') : '*'

    const { data, error } = await (ctx.client as unknown as Loose).schema(schema).from(table).insert(rows).select(list)
    refuseOnDbError(error)

    // The write is committed: ids come from the raw rows, and a failed role lookup nulls every cost column
    // rather than throwing, so the ids always reach the audit.
    const raw = (data ?? []) as Record<string, unknown>[]
    const ids = idsOf(raw)
    const masked = await maskWrittenRows(schema, table, raw, ctx)
    const out = needKey ? masked.rows.map(({ [key]: _k, ...rest }) => rest) : masked.rows
    return { inserted: rows.length, ids, rows: out }
  },
})
