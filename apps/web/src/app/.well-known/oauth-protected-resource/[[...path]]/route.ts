import { protectedResourceMetadata } from '@/mcp/metadata'

export const runtime = 'nodejs'

// Served at /.well-known/oauth-protected-resource and, per RFC 9728 path
// insertion, at /.well-known/oauth-protected-resource/api/mcp.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  if (process.env.MCP_ENABLED !== 'true') return new Response(null, { status: 404 })
  const { path } = await params
  const ok = !path || path.length === 0 || (path.length === 2 && path[0] === 'api' && path[1] === 'mcp')
  if (!ok) return new Response(null, { status: 404 })
  return Response.json(protectedResourceMetadata())
}
