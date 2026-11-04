// The cost mask: commercial figures are null for anyone the browser would also hide them from.
// COST_VIEW_ROLES is the only definition of who sees money; the column list is generated (masked-columns.ts).
// The role is decided against the row's owner: its project, else its organisation, else the "cost role
// everywhere" rule. Holding a cost role in some other organisation (your own company) never unmasks WM's rows.
//
// "Cost role everywhere" decides what has no row owner to judge by: esite_db_sql, esite_db_rpc results, and
// filters/orders on masked columns. It needs a cost role in EVERY active organisation membership (at least one)
// AND in EVERY active project membership: a person who owns their own company but is a contractor on one WM
// project (a project_members row admitted by user_has_project_access clause (a), 00238) does not pass.
import { COST_VIEW_ROLES } from '@esite/shared'
import { ToolRefusal, type ToolContext } from '../../define-tool'
import { MASKED, MASKED_COLUMN_NAMES } from './masked-columns'
import { MASKED_COLUMN } from './sentences'

const COST_ROLES: readonly string[] = COST_VIEW_ROLES
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MASKED_NAMES = new Set(MASKED_COLUMN_NAMES)
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

// projects.project_members is not in the generated Database type's public schema.
type Loose = {
  schema(s: string): {
    from(t: string): {
      select(columns: string): {
        eq(column: string, value: unknown): { eq(column: string, value: unknown): PromiseLike<{ data: unknown; error: unknown }> }
      }
    }
  }
}

// One project-membership read per tool call: assertFilterableColumns, maskRows, maskRpcResult and the SQL gate share it.
const everywhere = new WeakMap<ToolContext, Promise<boolean>>()

async function projectRolesAllCost(ctx: ToolContext): Promise<boolean> {
  const { data, error } = await (ctx.client as unknown as Loose)
    .schema('projects').from('project_members').select('role')
    .eq('user_id', ctx.user.id).eq('is_active', true)
  if (error || !Array.isArray(data)) return false // fail closed
  return data.every(r => r !== null && typeof r === 'object' && COST_ROLES.includes(String((r as { role?: unknown }).role)))
}

/**
 * True when the person holds a cost role (owner, admin, project manager) in every active organisation membership
 * (at least one) AND in every active project membership (none is fine). A failed project read is false.
 */
export function hasCostRoleEverywhere(ctx: ToolContext): Promise<boolean> {
  if (!(ctx.memberships.length > 0 && ctx.memberships.every(m => COST_ROLES.includes(m.role)))) return Promise.resolve(false)
  let p = everywhere.get(ctx)
  if (!p) {
    p = projectRolesAllCost(ctx).catch(() => false)
    everywhere.set(ctx, p)
  }
  return p
}

export function maskedColumnsOf(schema: string, table: string): string[] {
  return MASKED[`${schema}.${table}`]?.columns ?? []
}

/**
 * The column a masked row is judged by: its project key, else its organisation_id (when the table has one), else
 * null. select and insert fetch it even when the caller narrowed the column list, then strip it.
 */
export function ownerKeyOf(schema: string, table: string): string | null {
  const info = MASKED[`${schema}.${table}`]
  return info ? info.projectKey ?? info.orgKey : null
}

/** Filters and orders on a masked column leak the figure by bisection, so only people with a cost role everywhere may use them. */
export async function assertFilterableColumns(schema: string, table: string, columns: string[], ctx: ToolContext): Promise<void> {
  const masked = maskedColumnsOf(schema, table)
  if (masked.length > 0 && columns.some(c => masked.includes(c)) && !(await hasCostRoleEverywhere(ctx))) throw new ToolRefusal(MASKED_COLUMN)
}

/** Nulls the masked columns of rows the person may not see money on. */
export async function maskRows(
  schema: string, table: string, rows: Record<string, unknown>[], ctx: ToolContext,
): Promise<{ rows: Record<string, unknown>[]; maskedColumns: string[] }> {
  const info = MASKED[`${schema}.${table}`]
  if (!info) return { rows, maskedColumns: [] }

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
  const canSee = async (row: Record<string, unknown>): Promise<boolean> => {
    // A project-keyed table is judged by its project only: no key in the row (not selected, null) fails closed.
    if (info.projectKey) {
      const projectId = row[info.projectKey]
      return isUuid(projectId) ? lookup(projectId) : false
    }
    if (isUuid(row.organisation_id)) return ctx.memberships.some(m => m.organisationId === row.organisation_id && COST_ROLES.includes(m.role))
    return hasCostRoleEverywhere(ctx)
  }

  const present = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    if (await canSee(row)) { out.push(row); continue }
    const copy = { ...row }
    for (const col of info.columns) if (col in copy) { copy[col] = null; present.add(col) }
    out.push(copy)
  }
  return { rows: out, maskedColumns: [...present].sort() }
}

/** An rpc result has no table, so any key named like a masked column is nulled unless the person has a cost role everywhere. */
export async function maskRpcResult(result: unknown, ctx: ToolContext): Promise<{ result: unknown; maskedColumns: string[] }> {
  if (await hasCostRoleEverywhere(ctx)) return { result, maskedColumns: [] }
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

/**
 * maskRows for rows a write has already committed: if the role lookup fails, every masked column present is nulled
 * (fail closed) instead of throwing, so the write's ids still reach the result and the audit.
 */
export async function maskWrittenRows(
  schema: string, table: string, rows: Record<string, unknown>[], ctx: ToolContext,
): Promise<{ rows: Record<string, unknown>[]; maskedColumns: string[] }> {
  try {
    return await maskRows(schema, table, rows, ctx)
  } catch {
    const cols = maskedColumnsOf(schema, table)
    const present = new Set<string>()
    const out = rows.map(row => {
      const copy = { ...row }
      for (const col of cols) if (col in copy) { copy[col] = null; present.add(col) }
      return copy
    })
    return { rows: out, maskedColumns: [...present].sort() }
  }
}
