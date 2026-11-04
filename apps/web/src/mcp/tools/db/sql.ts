import { z } from 'zod'
import { defineTool, ToolRefusal } from '../../define-tool'
import { refuseOnDbError } from './db-error'
import { hasCostRoleEverywhere } from './mask'
import { SQL_ROLE } from './sentences'

const MAX_ROWS = 1000

export const esiteDbSql = defineTool({
  name: 'esite_db_sql',
  title: 'Run a read-only SQL query',
  description:
    'Runs one read-only SELECT (or WITH … SELECT) as the signed-in person, so row-level security applies. At most 1000 rows come back; truncated says when there were more. '
    + 'The time cap is the database statement timeout (8 s). References to the net schema are refused. '
    + 'Only people who hold owner, admin or project manager in every organisation they belong to AND on every project they are a member of may use it; '
    + 'an organisation-level project manager who is a contractor on one project is refused. Everyone else uses esite_db_select. '
    + 'Results are NOT cost-masked per row: the role rule above is what decides who may see cost figures here.',
  kind: 'read',
  inputSchema: { sql: z.string().min(1) },
  handler: async ({ sql }, ctx) => {
    if (!(await hasCostRoleEverywhere(ctx))) throw new ToolRefusal(SQL_ROLE)
    const { data, error } = await ctx.client.rpc('mcp_run_select' as never, { p_sql: sql } as never)
    refuseOnDbError(error)
    const rows = (data ?? []) as unknown[]
    return { rows: rows.slice(0, MAX_ROWS), rowCount: Math.min(rows.length, MAX_ROWS), truncated: rows.length > MAX_ROWS }
  },
})
