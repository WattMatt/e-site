import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { z, type ZodRawShape } from 'zod'
import type { Database } from '@esite/db'
import type { JwtClaims } from '@/lib/supabase/jwt'
import { emitProductEvent } from '@/lib/analytics/product-events'
import type { McpAuthResult } from './auth'
import { argsDigest, rateStatus, recordToolCall, type AuditRow } from './audit'

export type ToolKind = 'read' | 'preview' | 'write'

export type ToolContext = {
  client: SupabaseClient<Database>
  user: User
  claims: JwtClaims
  memberships: Extract<McpAuthResult, { ok: true }>['memberships']
}

/** A refusal the caller may read: its message goes to the model verbatim. */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRefusal'
  }
}

export const RATE_LIMIT_SENTENCE = 'Slow down; try again in a minute.'
export const SIGN_IN_SENTENCE = 'Sign in required.'
export const UNEXPECTED_SENTENCE = 'Something went wrong on the server; the error was logged.'

const MAX_CALLS_PER_MINUTE = 120
const MAX_WRITES_PER_MINUTE = 20

type ToolDef<I extends ZodRawShape> = {
  name: string
  title: string
  description: string
  kind: ToolKind
  inputSchema: I
  projectIdOf?: (args: z.infer<z.ZodObject<I>>) => string | null
  organisationIdOf?: (args: z.infer<z.ZodObject<I>>) => string | null
  handler: (args: z.infer<z.ZodObject<I>>, ctx: ToolContext) => Promise<unknown>
}

export type RegisteredTool = {
  name: string
  title: string
  description: string
  kind: ToolKind
  inputSchema: ZodRawShape
  projectIdOf?: (args: never) => string | null
  organisationIdOf?: (args: never) => string | null
  handler: (args: never, ctx: ToolContext) => Promise<unknown>
}

export function defineTool<I extends ZodRawShape>(def: ToolDef<I>): RegisteredTool {
  return def as unknown as RegisteredTool
}

// Narrower than CallToolResult (text content only) so callers can read content[0].text without a type guard.
export type ToolResult = CallToolResult & { content: { type: 'text'; text: string }[] }

const refuse = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] })

export async function runTool(tool: RegisteredTool, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now()
  let outcome: AuditRow['outcome'] = 'ok'
  let refusal: string | null = null
  let resultIds: unknown | null = null
  let result: ToolResult

  try {
    const rate = await rateStatus(ctx.user.id)
    const writing = tool.kind === 'preview' || tool.kind === 'write'
    if (rate.calls >= MAX_CALLS_PER_MINUTE || (writing && rate.writes >= MAX_WRITES_PER_MINUTE)) {
      throw new ToolRefusal(RATE_LIMIT_SENTENCE)
    }
    const out = await tool.handler(args as never, ctx)
    if (out && typeof out === 'object' && 'ids' in out) resultIds = (out as { ids: unknown }).ids
    result = { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out as Record<string, unknown> }
  } catch (err) {
    if (err instanceof ToolRefusal) {
      outcome = 'refused'
      refusal = err.message
      result = refuse(err.message)
    } else if (isRedirectError(err)) {
      outcome = 'refused'
      refusal = SIGN_IN_SENTENCE
      result = refuse(SIGN_IN_SENTENCE)
    } else {
      outcome = 'error'
      refusal = UNEXPECTED_SENTENCE
      console.error(`[mcp] ${tool.name} failed`, { err: err instanceof Error ? err.name : 'unknown' })
      result = refuse(UNEXPECTED_SENTENCE)
    }
  }

  const projectId = safeId(() => tool.projectIdOf?.(args as never))
  const organisationId = safeId(() => tool.organisationIdOf?.(args as never))
  await recordToolCall({
    userId: ctx.user.id,
    clientId: ctx.claims.client_id ?? null,
    organisationId,
    projectId,
    tool: tool.name,
    kind: tool.kind,
    argsDigest: argsDigest(args),
    outcome,
    refusal,
    resultIds,
    durationMs: Date.now() - started,
  })
  await emitProductEvent({
    actorId: ctx.user.id,
    projectId,
    event: 'mcp_tool_called',
    properties: { tool: tool.name, kind: tool.kind, outcome },
    organisationId,
  })
  return result
}

// An id selector runs on unvalidated input; a throw there must not lose the audit row.
function safeId(fn: () => string | null | undefined): string | null {
  try { return fn() ?? null } catch { return null }
}

export function registerTools(server: McpServer, tools: RegisteredTool[], ctx: ToolContext): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (args: unknown) => runTool(tool, args, ctx),
    )
  }
}
