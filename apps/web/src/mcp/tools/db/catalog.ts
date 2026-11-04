import { z } from 'zod'
import { defineTool } from '../../define-tool'
import { assertExposedSchema } from './exposed-schemas'
import { refuseOnDbError } from './db-error'

export const esiteDbSchemas = defineTool({
  name: 'esite_db_schemas',
  title: 'List database schemas and tables',
  description: 'Without an argument, lists the exposed schemas. With a schema, lists its tables and columns as the signed-in person may see them. Call this before esite_db_select.',
  kind: 'read',
  inputSchema: { schema: z.string().optional() },
  handler: async ({ schema }, ctx) => {
    if (schema !== undefined) assertExposedSchema(schema)
    const { data, error } = await ctx.client.rpc('mcp_catalog' as never, { p_schema: schema ?? null } as never)
    refuseOnDbError(error)
    return schema === undefined ? { schemas: data } : { schema, tables: data }
  },
})
