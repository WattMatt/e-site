import { z } from 'zod'
import { defineTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { assertIdent, assertIdents } from './identifiers'
import { applyFilters, filterColumns, filterSchema, type FilterableQuery } from './filters'
import { refuseOnDbError, type DbError } from './db-error'
import { MASKED } from './masked-columns'
import { assertFilterableColumns, maskRows } from './mask'
import { projectIdFromFilters } from './project-id'

// The generic tools address arbitrary schema.table names, which the generated Database type cannot express.
interface SelectQuery extends FilterableQuery {
  order(column: string, options: { ascending: boolean }): this
  range(from: number, to: number): this
  then: PromiseLike<{ data: unknown; error: DbError; count: number | null }>['then']
}
type Loose = { schema(s: string): { from(t: string): { select(columns: string, options: { count: 'exact' }): SelectQuery } } }

export const esiteDbSelect = defineTool({
  name: 'esite_db_select',
  title: 'Read rows from a table',
  description:
    'Reads rows from any exposed schema.table as the signed-in person, so row-level security applies. Use esite_db_schemas first to see tables and columns. '
    + 'Filters take column, op and value; ops: eq, neq, gt, gte, lt, lte, like, ilike, in, is, cs, cd, ov, fts, not.eq, not.in, not.is. '
    + 'fts uses to_tsquery syntax, so a multi-word value must be joined with & (for example "cable & tray"). '
    + 'Results are paged: limit 1..1000 (default 100); when truncated is true, pass nextOffset as offset. '
    + 'Cost figures come back null for roles that may not see them, and maskedColumns names the columns that were nulled.',
  kind: 'read',
  inputSchema: {
    schema: z.string(),
    table: z.string(),
    columns: z.array(z.string()).optional(),
    filters: z.array(filterSchema).optional(),
    order: z.array(z.object({ column: z.string(), ascending: z.boolean().optional() })).optional(),
    limit: z.number().int().min(1).max(1000).default(100),
    offset: z.number().int().min(0).default(0),
  },
  projectIdOf: a => projectIdFromFilters(a.filters),
  handler: async ({ schema, table, columns, filters, order, limit, offset }, ctx) => {
    assertExposedSchema(schema)
    assertIdent(table)
    assertIdents(columns ?? [])
    const orderColumns = assertIdents((order ?? []).map(o => o.column))
    assertFilterableColumns(schema, table, [...filterColumns(filters ?? []), ...orderColumns], ctx)

    // A masked row is judged by its owner; the key column is fetched even when the caller did not ask for it, then stripped.
    const key = MASKED[`${schema}.${table}`]?.projectKey ?? null
    const needKey = key !== null && columns !== undefined && !columns.includes(key)
    const list = columns ? [...columns, ...(needKey ? [key] : [])].join(',') : '*'

    let q = (ctx.client as unknown as Loose).schema(schema).from(table).select(list, { count: 'exact' })
    q = applyFilters(q, filters ?? [])
    for (const o of order ?? []) q = q.order(o.column, { ascending: o.ascending ?? true })
    q = q.range(offset, offset + limit - 1)
    const { data, error, count } = await q
    refuseOnDbError(error)

    const masked = await maskRows(schema, table, (data ?? []) as Record<string, unknown>[], ctx)
    const rows = needKey ? masked.rows.map(({ [key]: _k, ...rest }) => rest) : masked.rows
    const nextOffset = count != null && offset + rows.length < count ? offset + rows.length : null
    return { rows, count, nextOffset, truncated: nextOffset !== null, maskedColumns: masked.maskedColumns }
  },
})
