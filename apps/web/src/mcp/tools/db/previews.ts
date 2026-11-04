import { ToolRefusal, type ToolContext } from '../../define-tool'
import { argsDigest } from '../../audit'
import { refuseOnDbError, type DbError } from './db-error'
import type { Filter } from './filters'
import { PREVIEW_MISMATCH } from './sentences'

export type PreviewArgs = { schema: string; table: string; filters: Filter[]; patch?: Record<string, unknown> }

const DAY_MS = 24 * 3_600_000
const KEEP_MS = 7 * DAY_MS

// public.mcp_previews is not in the generated Database type. It is written through the person's own client: RLS
// limits every statement to their rows, and the column grant lets them update consumed_at and nothing else.
type Result = { data: unknown; error: DbError }
interface PreviewQuery extends PromiseLike<Result> {
  lt(column: string, value: string): PreviewQuery
  eq(column: string, value: string): PreviewQuery
  is(column: string, value: null): PreviewQuery
  select(columns: string): PreviewQuery
  single(): PreviewQuery
  maybeSingle(): PreviewQuery
}
type Loose = {
  schema(s: 'public'): {
    from(t: 'mcp_previews'): {
      select(columns: string): PreviewQuery
      insert(row: Record<string, unknown>): PreviewQuery
      update(row: { consumed_at: string }): PreviewQuery
      delete(): PreviewQuery
    }
  }
}
const previews = (ctx: ToolContext) => (ctx.client as unknown as Loose).schema('public').from('mcp_previews')

export async function createPreview(
  ctx: ToolContext,
  input: { tool: string; args: PreviewArgs; matchedIds: string[] | null; wouldAffect: number },
): Promise<{ previewId: string; expiresAt: string }> {
  // Housekeeping: the person's own rows older than 7 days. A failure here must not block the preview.
  try {
    await previews(ctx).delete().lt('created_at', new Date(Date.now() - KEEP_MS).toISOString())
  } catch {
    // ignored by design
  }

  const { data, error } = await previews(ctx)
    .insert({ tool: input.tool, args_digest: argsDigest(input.args), matched_ids: input.matchedIds, would_affect: input.wouldAffect })
    .select('id, created_at')
    .single()
  refuseOnDbError(error)
  const row = data as { id: string; created_at: string }
  return { previewId: row.id, expiresAt: new Date(Date.parse(row.created_at) + DAY_MS).toISOString() }
}

type StoredPreview = { tool: string; args_digest: string; matched_ids: string[] | null; would_affect: number; created_at: string; consumed_at: string | null }

/** Single use: the row is marked consumed here, so a second confirm (or a concurrent one) is refused. */
export async function consumePreview(
  ctx: ToolContext,
  input: { previewId: string; tool: string; args: PreviewArgs },
): Promise<{ matchedIds: string[] | null; wouldAffect: number }> {
  const mismatch = () => new ToolRefusal(PREVIEW_MISMATCH)

  const read = await previews(ctx).select('*').eq('id', input.previewId).maybeSingle()
  refuseOnDbError(read.error)
  const row = read.data as StoredPreview | null
  if (!row || row.tool !== input.tool || row.args_digest !== argsDigest(input.args) || row.consumed_at != null) throw mismatch()
  // Written so an unreadable created_at (NaN) fails the comparison and is refused.
  if (!(Date.now() - Date.parse(row.created_at) <= DAY_MS)) throw mismatch()

  const used = await previews(ctx).update({ consumed_at: new Date().toISOString() }).eq('id', input.previewId).is('consumed_at', null).select('id')
  refuseOnDbError(used.error)
  if (!Array.isArray(used.data) || used.data.length === 0) throw mismatch()

  return { matchedIds: row.matched_ids ?? null, wouldAffect: row.would_affect }
}
