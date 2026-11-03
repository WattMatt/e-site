import { z } from 'zod'
import { defineTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { assertIdent } from './identifiers'
import { refuseOnDbError, type DbError } from './db-error'
import { maskRpcResult } from './mask'
import { idsOf } from './project-id'

// The generic tools address arbitrary function names, which the generated Database type cannot express.
type Loose = { schema(s: string): { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }> } }

const isRow = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export const esiteDbRpc = defineTool({
  name: 'esite_db_rpc',
  title: 'Call a database function',
  description:
    'Calls any exposed database function as the signed-in person (a POST, so the function may write), under row-level security. '
    + 'schema defaults to public; args is an object of parameter name to value. '
    + 'readOnly: true only changes how the call is audited and rate-limited; it is your statement of intent, not a guarantee, and the database does not stop a function from writing. '
    + 'Results are not masked per row: any key named like a masked cost column is null unless the person holds owner, admin or project manager in every organisation AND on every project they are a member of, and maskedColumns names them. '
    + 'ids lists the id of each returned row, so a function that writes rows reaches the audit.',
  kind: 'write',
  kindOf: a => (a.readOnly ? 'read' : 'write'),
  inputSchema: {
    schema: z.string().default('public'),
    fn: z.string(),
    args: z.record(z.unknown()).optional(),
    readOnly: z.boolean().default(false),
  },
  handler: async ({ schema, fn, args }, ctx) => {
    assertExposedSchema(schema)
    assertIdent(fn)
    const { data, error } = await (ctx.client as unknown as Loose).schema(schema).rpc(fn, args ?? {})
    refuseOnDbError(error)
    const { result, maskedColumns } = await maskRpcResult(data, ctx)
    const ids = Array.isArray(result) ? idsOf(result.filter(isRow)) : []
    return { result, maskedColumns, ids }
  },
})
