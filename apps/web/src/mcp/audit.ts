import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'

export type AuditRow = {
  userId: string
  clientId: string | null
  organisationId: string | null
  projectId: string | null
  tool: string
  kind: 'read' | 'preview' | 'write'
  argsDigest: string
  outcome: 'ok' | 'refused' | 'error'
  refusal: string | null
  resultIds: unknown | null
  durationMs: number
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** sha256 hex over JSON with keys sorted recursively, so key order never changes the digest. */
export function argsDigest(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(args)) ?? 'null').digest('hex')
}

// The service key is used here and nowhere else under src/mcp. Both functions are
// definers granted to service_role alone; the caller has already verified the bearer user.
// The RPCs are not in the generated types, hence the loose call.
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { name?: string } | null }>
const rpc = (): Rpc => {
  const client = createServiceClient() as unknown as { rpc: Rpc }
  return (name, args) => client.rpc(name, args)
}

/**
 * Calls and writes (preview + write) by this user in the last 60 seconds.
 * Throws on failure: failing open would switch the rate limit off.
 */
export async function rateStatus(userId: string): Promise<{ calls: number; writes: number }> {
  const { data, error } = await rpc()('mcp_rate_status', { p_user: userId })
  if (error) throw new Error('mcp_rate_status failed')
  const row = (Array.isArray(data) ? data[0] : data) as { calls?: number; writes?: number } | null | undefined
  return { calls: Number(row?.calls ?? 0), writes: Number(row?.writes ?? 0) }
}

/** Never throws: an audit failure must not turn a finished tool call into an error. */
export async function recordToolCall(row: AuditRow): Promise<void> {
  try {
    const { error } = await rpc()('record_mcp_call', {
      p_user: row.userId,
      p_client: row.clientId,
      p_org: row.organisationId,
      p_project: row.projectId,
      p_tool: row.tool,
      p_kind: row.kind,
      p_args_digest: row.argsDigest,
      p_outcome: row.outcome,
      p_refusal: row.refusal,
      p_result_ids: row.resultIds ?? null,
      p_duration_ms: Math.round(row.durationMs),
    })
    if (error) console.error('[mcp] audit write failed', { err: error.name ?? 'rpc_error' })
  } catch (err) {
    console.error('[mcp] audit write failed', { err: err instanceof Error ? err.name : 'unknown' })
  }
}
