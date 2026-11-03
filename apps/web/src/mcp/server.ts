import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, type ToolContext } from './define-tool'
import { ALL_TOOLS } from './tools'

const INSTRUCTIONS =
  'Every tool acts as the signed-in E-Site user under the database\'s row security. Start with esite_whoami. esite_db_schemas lists tables and columns; esite_db_select reads any table; esite_db_sql runs one read-only SELECT (owners, admins and project managers). esite_db_update and esite_db_delete first return a preview with a previewId; call again with that previewId within 24 hours to commit. Cost figures are null for roles that may not see them. A few tables (memberships, billing, sealed bids, templates, the audit log) are not writable here.'

export function createEsiteServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'e-site', version: process.env.npm_package_version ?? '0.0.0' },
    { instructions: INSTRUCTIONS },
  )
  registerTools(server, ALL_TOOLS, ctx)
  return server
}
