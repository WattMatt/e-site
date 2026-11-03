import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
// Internal Next path, pinned to Next 15.5; re-check on upgrade.
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
// The audit row keeps at most this many result ids; a bulk write can touch up to 500 rows.
const MAX_RESULT_IDS = 200

type ToolDef<I extends ZodRawShape> = {
  name: string
  title: string
  description: string
  kind: ToolKind
  /** Decides the kind per call (e.g. preview vs write on one tool); a throw falls back to `kind`. */
  kindOf?: (args: z.infer<z.ZodObject<I>>) => ToolKind
  inputSchema: I
  projectIdOf?: (args: z.infer<z.ZodObject<I>>) => string | null
  handler: (args: z.infer<z.ZodObject<I>>, ctx: ToolContext) => Promise<unknown>
}

export type RegisteredTool = {
  name: string
  title: string
  description: string
  kind: ToolKind
  kindOf?: (args: never) => ToolKind
  inputSchema: ZodRawShape
  projectIdOf?: (args: never) => string | null
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
  const kind = resolveKind(tool, args)

  try {
    // Read-before-write: concurrent calls can each pass this check and overshoot the limit slightly.
    const rate = await rateStatus(ctx.user.id)
    const writing = kind === 'preview' || kind === 'write'
    if (rate.calls >= MAX_CALLS_PER_MINUTE || (writing && rate.writes >= MAX_WRITES_PER_MINUTE)) {
      throw new ToolRefusal(RATE_LIMIT_SENTENCE)
    }
    const out = await tool.handler(args as never, ctx)
    if (out && typeof out === 'object' && 'ids' in out) {
      const ids = (out as { ids: unknown }).ids
      resultIds = Array.isArray(ids) ? ids.slice(0, MAX_RESULT_IDS) : ids
    }
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
      console.error(`[mcp] ${tool.name} failed`, { err: err instanceof Error ? err.name : 'unknown' })
      result = refuse(UNEXPECTED_SENTENCE)
    }
  }

  const projectId = safeId(() => tool.projectIdOf?.(args as never))
  const organisationId = await auditOrganisation(ctx, projectId)
  await recordToolCall({
    userId: ctx.user.id,
    clientId: ctx.claims.client_id ?? null,
    organisationId,
    projectId,
    tool: tool.name,
    kind,
    argsDigest: argsDigest(args),
    outcome,
    refusal,
    resultIds,
    durationMs: Date.now() - started,
  })
  // emit_product_event raises when project and organisation are both null.
  if (projectId || organisationId) {
    await emitProductEvent({
      actorId: ctx.user.id,
      projectId,
      event: 'mcp_tool_called',
      properties: { tool: tool.name, kind, outcome },
      organisationId,
    })
  }
  return result
}

// kindOf runs on unvalidated input; a throw there must not lose the call or its audit row.
function resolveKind(tool: RegisteredTool, args: unknown): ToolKind {
  try {
    return tool.kindOf?.(args as never) ?? tool.kind
  } catch {
    return tool.kind
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// An id selector runs on unvalidated input; a throw there must not lose the audit row,
// and anything that is not a uuid must never reach the audit RPC.
function safeId(fn: () => string | null | undefined): string | null {
  try {
    const id = fn()
    return typeof id === 'string' && UUID.test(id) ? id : null
  } catch {
    return null
  }
}

/**
 * The organisation an audit row and product event are stamped with. Never read from
 * arguments: with a project, it is that project's organisation as the caller's own
 * client sees it (an invisible or missing project gives null); without one, the
 * caller's organisation only when they belong to exactly one. A lookup failure is null.
 */
async function auditOrganisation(ctx: ToolContext, projectId: string | null): Promise<string | null> {
  try {
    if (projectId) {
      type Lookup = { schema: (s: string) => { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } } } }
      const { data, error } = await (ctx.client as unknown as Lookup)
        .schema('projects')
        .from('projects')
        .select('organisation_id')
        .eq('id', projectId)
        .maybeSingle()
      if (error) return null
      return safeId(() => (data as { organisation_id?: string } | null)?.organisation_id)
    }
    return ctx.memberships.length === 1 ? safeId(() => ctx.memberships[0].organisationId) : null
  } catch {
    return null
  }
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
