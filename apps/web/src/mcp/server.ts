import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, type ToolContext } from './define-tool'
import { ALL_TOOLS } from './tools'

const INSTRUCTIONS =
  'Every tool acts as the signed-in E-Site user. Preview tools write nothing; commit tools need a previewId from the same person within 24 hours. Call esite_whoami first to learn your projects and roles.'

export function createEsiteServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: 'e-site', version: process.env.npm_package_version ?? '0.0.0' },
    { instructions: INSTRUCTIONS },
  )
  registerTools(server, ALL_TOOLS, ctx)
  return server
}
