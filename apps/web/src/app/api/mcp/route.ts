import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { authenticateMcpRequest } from '@/mcp/auth'
import { unauthorizedResponse } from '@/mcp/metadata'
import { createEsiteServer } from '@/mcp/server'
import { runWithBearer } from '@/lib/supabase/request-auth'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const notFound = () => new Response(null, { status: 404 })
const methodNotAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })

export async function POST(request: Request): Promise<Response> {
  // Kill switch: before authentication and before any audit.
  if (process.env.MCP_ENABLED !== 'true') return notFound()

  const auth = await authenticateMcpRequest(request)
  if (!auth.ok) return unauthorizedResponse(auth.status, auth.sentence)

  return runWithBearer(auth.ctx, async () => {
    const client = await createClient()
    const server = createEsiteServer({
      client,
      user: auth.ctx.user,
      claims: auth.ctx.claims,
      memberships: auth.memberships,
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(request)
  })
}

export async function GET(): Promise<Response> {
  return methodNotAllowed()
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed()
}
