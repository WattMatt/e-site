// The cost mask: commercial figures are null for anyone the browser would also hide them from.
// COST_VIEW_ROLES is the only definition of who sees money; the column list is generated (masked-columns.ts).
import { COST_VIEW_ROLES } from '@esite/shared'
import { ToolRefusal, type ToolContext } from '../../define-tool'
import { MASKED, MASKED_COLUMN_NAMES } from './masked-columns'
import { MASKED_COLUMN } from './sentences'

const COST_ROLES: readonly string[] = COST_VIEW_ROLES
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MASKED_NAMES = new Set(MASKED_COLUMN_NAMES)

/** True when the person holds a cost role in any of their organisations (owner, admin, project manager). */
export function hasOrgCostRole(ctx: ToolContext): boolean {
  return ctx.memberships.some(m => COST_ROLES.includes(m.role))
}

export function maskedColumnsOf(schema: string, table: string): string[] {
  return MASKED[`${schema}.${table}`]?.columns ?? []
}

/** Filters and orders on a masked column leak the figure by bisection, so only org-level cost roles may use them. */
export function assertFilterableColumns(schema: string, table: string, columns: string[], ctx: ToolContext): void {
  const masked = maskedColumnsOf(schema, table)
  if (masked.length > 0 && columns.some(c => masked.includes(c)) && !hasOrgCostRole(ctx)) throw new ToolRefusal(MASKED_COLUMN)
}

/** Nulls the masked columns of rows the person may not see money on; a row's project decides when the table has one. */
export async function maskRows(
  schema: string, table: string, rows: Record<string, unknown>[], ctx: ToolContext,
): Promise<{ rows: Record<string, unknown>[]; maskedColumns: string[] }> {
  const info = MASKED[`${schema}.${table}`]
  if (!info || hasOrgCostRole(ctx)) return { rows, maskedColumns: [] }

  const canSeeProject = new Map<string, boolean>()
  const lookup = async (projectId: string): Promise<boolean> => {
    const cached = canSeeProject.get(projectId)
    if (cached !== undefined) return cached
    const { data, error } = await ctx.client.rpc('user_effective_project_role' as never, { p_project_id: projectId, p_user_id: ctx.user.id } as never)
    if (error) throw new Error('user_effective_project_role failed')
    const role = data as string | null
    const can = role !== null && COST_ROLES.includes(role)
    canSeeProject.set(projectId, can)
    return can
  }

  const present = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const projectId = info.hasProjectId ? row.project_id : undefined
    const canSee = typeof projectId === 'string' && UUID.test(projectId) ? await lookup(projectId) : false
    if (canSee) { out.push(row); continue }
    const copy = { ...row }
    for (const col of info.columns) if (col in copy) { copy[col] = null; present.add(col) }
    out.push(copy)
  }
  return { rows: out, maskedColumns: [...present].sort() }
}

/** An rpc result has no table, so any key named like a masked column is nulled for people without an org cost role. */
export function maskRpcResult(result: unknown, ctx: ToolContext): { result: unknown; maskedColumns: string[] } {
  if (hasOrgCostRole(ctx)) return { result, maskedColumns: [] }
  const hit = new Set<string>()
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (MASKED_NAMES.has(k)) { o[k] = null; hit.add(k) } else o[k] = walk(x)
      }
      return o
    }
    return v
  }
  const masked = walk(result)
  return { result: masked, maskedColumns: [...hit].sort() }
}
