import { z } from 'zod'
import { defineTool, ToolRefusal, type RegisteredTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { assertIdent, assertIdents } from './identifiers'
import { assertWritable } from './denylist'
import { applyFilters, filterColumns, filterSchema, type Filter, type FilterableQuery } from './filters'
import { refuseOnDbError, type DbError } from './db-error'
import { assertFilterableColumns, maskRows } from './mask'
import { idsOf, projectIdFromFilters } from './project-id'
import { createPreview, consumePreview, type PreviewArgs } from './previews'
import { EMPTY_PATCH, NEED_FILTER, PREVIEW_MISMATCH, PREVIEW_TOO_WIDE } from './sentences'

const MAX_ROWS = 1000
const SAMPLE_ROWS = 50
const NO_SUCH_COLUMN = '42703'

// The generic tools address arbitrary schema.table names, which the generated Database type cannot express.
interface MutateQuery extends FilterableQuery {
  limit(n: number): this
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): this
  then: PromiseLike<{ data: unknown; error: DbError; count: number | null }>['then']
}
type Loose = {
  schema(s: string): {
    from(t: string): {
      select(columns: string, options: { count: 'exact'; head?: boolean }): MutateQuery
      update(patch: Record<string, unknown>): MutateQuery
      delete(): MutateQuery
    }
  }
}

type Args = { schema: string; table: string; filters: Filter[]; patch?: Record<string, unknown>; previewId?: string }

const baseShape = {
  schema: z.string(),
  table: z.string(),
  filters: z.array(filterSchema),
  previewId: z.string().uuid().optional(),
}
// Key order is the order the model sees; the patch sits before previewId.
const updateShape = {
  schema: baseShape.schema,
  table: baseShape.table,
  filters: baseShape.filters,
  patch: z.record(z.unknown()),
  previewId: baseShape.previewId,
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** The set a preview stored, as it stands now: sorted ids and a count, or the count alone for a table without id. */
async function currentMatch(base: () => ReturnType<ReturnType<Loose['schema']>['from']>, filters: Filter[]): Promise<{ ids: string[] | null; count: number | null }> {
  const first = await applyFilters(base().select('id', { count: 'exact' }), filters).limit(MAX_ROWS)
  if (first.error?.code === NO_SUCH_COLUMN) {
    const head = await applyFilters(base().select('*', { count: 'exact', head: true }), filters)
    refuseOnDbError(head.error)
    return { ids: null, count: head.count }
  }
  refuseOnDbError(first.error)
  const rows = (first.data ?? []) as Record<string, unknown>[]
  return { ids: rows.map(r => String(r.id)).sort(), count: first.count ?? rows.length }
}

function makeMutateTool(verb: 'update' | 'delete'): RegisteredTool {
  const name = `esite_db_${verb}`
  const done = verb === 'update' ? 'updated' : 'deleted'
  return defineTool({
    name,
    title: verb === 'update' ? 'Update rows in a table' : 'Delete rows from a table',
    description:
      `${verb === 'update' ? 'Updates' : 'Deletes'} rows of any exposed schema.table as the signed-in person, so row-level security applies. Use esite_db_schemas first to see tables and columns. `
      + 'Needs at least one filter (same filter format as esite_db_select). '
      + `The first call, without previewId, changes nothing and returns a preview: previewId, wouldAffect (at most 1000), sample (at most 50 rows) and expiresAt. `
      + `The commit happens only when you call again with that previewId and the same schema, table, filters${verb === 'update' ? ', patch' : ''}, within 24 hours, by the same person; a preview works once. `
      + 'The commit is refused if the matching rows changed since the preview; run the preview again. '
      + `Returns ${done} (a count), ids and the affected rows. `
      + 'A few tables are managed in the app and refused: who is who, billing, sealed tenders, templates and the audit. '
      + 'Cost figures in returned rows and in the sample are null for roles that may not see them.',
    kind: 'write',
    kindOf: (a: Args) => (a.previewId ? 'write' : 'preview'),
    inputSchema: (verb === 'update' ? updateShape : baseShape) as typeof updateShape,
    projectIdOf: a => projectIdFromFilters(a.filters),
    handler: async (a, ctx) => {
      const { schema, table, filters, previewId } = a as Args
      const patch = verb === 'update' ? (a as Args).patch ?? {} : undefined

      assertExposedSchema(schema)
      assertIdent(table)
      if (filters.length === 0) throw new ToolRefusal(NEED_FILTER)
      if (patch) {
        if (Object.keys(patch).length === 0) throw new ToolRefusal(EMPTY_PATCH)
        assertIdents(Object.keys(patch))
      }
      assertWritable(schema, table)
      assertFilterableColumns(schema, table, filterColumns(filters), ctx)

      // What the preview digest covers: exactly these keys, nothing else.
      const args: PreviewArgs = patch ? { schema, table, filters, patch } : { schema, table, filters }
      const table$ = () => (ctx.client as unknown as Loose).schema(schema).from(table)

      if (!previewId) {
        const { data, error, count } = await applyFilters(table$().select('*', { count: 'exact' }), filters).limit(MAX_ROWS)
        refuseOnDbError(error)
        const rows = (data ?? []) as Record<string, unknown>[]
        const wouldAffect = count ?? rows.length
        if (wouldAffect > MAX_ROWS) throw new ToolRefusal(PREVIEW_TOO_WIDE)
        const matchedIds = rows.length > 0 && 'id' in rows[0] ? rows.map(r => String(r.id)).sort() : null
        const { rows: sample } = await maskRows(schema, table, rows.slice(0, SAMPLE_ROWS), ctx)
        const { previewId: id, expiresAt } = await createPreview(ctx, { tool: name, args, matchedIds, wouldAffect })
        return { previewId: id, wouldAffect, sample, expiresAt }
      }

      const stored = await consumePreview(ctx, { previewId, tool: name, args })
      const now = await currentMatch(table$, filters)
      const unchanged = stored.matchedIds === null || now.ids === null
        // Count-only on either side: the counts must agree. A stored id set against a table that lost its id column is a change.
        ? stored.matchedIds === null && now.count !== null && now.count === stored.wouldAffect
        : sameIds(stored.matchedIds, now.ids) && now.count === stored.wouldAffect
      if (!unchanged) throw new ToolRefusal(PREVIEW_MISMATCH)

      const q = verb === 'update' ? table$().update(patch ?? {}) : table$().delete()
      const written = await applyFilters(q, filters).select('*')
      refuseOnDbError(written.error)
      const masked = await maskRows(schema, table, (written.data ?? []) as Record<string, unknown>[], ctx)
      const ids = idsOf(masked.rows)
      return { [done]: masked.rows.length, ids, rows: masked.rows }
    },
  })
}

export const esiteDbUpdate = makeMutateTool('update')
export const esiteDbDelete = makeMutateTool('delete')
