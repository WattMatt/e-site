import { projectService, COST_VIEW_ROLES } from '@esite/shared'
import { getProjectSettingsCached, getProjectHistoryCached } from '@/lib/project-settings'
import { listProjectContacts } from '@/actions/project-contacts.actions'
import { listProjectMembers } from '@/actions/project-members.actions'
import { listMyOrganisations } from '@/actions/active-organisation.actions'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { requireProjectAccess } from '@/lib/auth/require-project-access'
import { loadCostVisibility } from '@/lib/projects/cost-visibility'
import { defineTool, ToolRefusal, type ToolContext } from '../define-tool'
import { projectId, limit, cursor, MAX_LIMIT } from '../schemas'

const NOT_FOUND = 'Project not found'

// The wrapper's client is typed to the generated Database; the shared services take the looser TypedSupabaseClient.
type ServiceClient = Parameters<typeof projectService.listAccessible>[0]
const svc = (ctx: ToolContext) => ctx.client as unknown as ServiceClient

async function canSeeContractFigures(ctx: ToolContext, id: string): Promise<boolean> {
  return (await requireEffectiveRole(ctx.client as never, id, COST_VIEW_ROLES)).ok
}

async function assertVisible(ctx: ToolContext, id: string): Promise<void> {
  const access = await requireProjectAccess(ctx.client as never, id)
  if (!access.ok) throw new ToolRefusal(access.error)
}

// Retention is a commercial figure: it travels with the contract block, never with the settings or history of a reader without cost access.
const COST_SETTING_KEYS = ['retentionPct'] as const
function withoutCostKeys<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj) return obj
  const copy = { ...obj } as Record<string, unknown>
  for (const k of COST_SETTING_KEYS) delete copy[k]
  return copy as T
}

const encodeCursor = (createdAt: string) => Buffer.from(createdAt, 'utf8').toString('base64url')
function decodeCursor(c: string): string {
  const decoded = Buffer.from(c, 'base64url').toString('utf8')
  if (!decoded || Number.isNaN(Date.parse(decoded))) throw new ToolRefusal('That cursor is not valid; start again without one.')
  return decoded
}

export const esiteWhoami = defineTool({
  name: 'esite_whoami',
  title: 'Who am I',
  description: 'Returns the signed-in E-Site user, their organisations and roles, and every project they can see with their effective role on each. Call this first.',
  kind: 'read',
  inputSchema: {},
  handler: async (_args, ctx) => {
    const [orgs, projects] = await Promise.all([listMyOrganisations(), projectService.listAccessible(svc(ctx))])
    if (!orgs.ok) throw new Error('listMyOrganisations failed')
    const rows = projects as Array<{ id: string; code: string; name: string; organisation_id: string }>
    const roles = await Promise.all(rows.map(async (p) => {
      const { data, error } = await ctx.client.rpc('user_effective_project_role' as never, { p_project_id: p.id, p_user_id: ctx.user.id } as never)
      if (error) throw new Error('user_effective_project_role failed')
      return (data as string | null) ?? null
    }))
    return {
      userId: ctx.user.id,
      email: ctx.user.email ?? null,
      clientId: ctx.claims.client_id ?? null,
      organisations: orgs.memberships.map((m) => ({ id: m.organisation_id, name: m.organisation_name, role: m.role })),
      projects: rows.map((p, i) => ({ id: p.id, code: p.code, name: p.name, organisationId: p.organisation_id, effectiveRole: roles[i] })),
    }
  },
})

export const esiteProjectsList = defineTool({
  name: 'esite_projects_list',
  title: 'List projects',
  description: 'Lists the projects you can see, newest first. Contract value appears only where your role may see cost. Pass nextCursor back as cursor for the next page.',
  kind: 'read',
  inputSchema: { limit, cursor },
  handler: async ({ limit: n, cursor: c }, ctx) => {
    const all = (await projectService.listAccessible(svc(ctx))) as Array<Record<string, any>>
    const sorted = [...all].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))
    const after = c ? decodeCursor(c) : null
    const rest = after ? sorted.filter((p) => p.created_at < after) : sorted
    const take = Math.min(MAX_LIMIT, Math.max(1, n))
    const page = rest.slice(0, take)
    const truncated = rest.length > take
    const canSeeCost = await loadCostVisibility(ctx.client, ctx.user.id, page as never)
    return {
      projects: page.map((p) => {
        const cost = canSeeCost({ id: p.id, organisation_id: p.organisation_id })
        return {
          id: p.id as string,
          code: p.code as string,
          name: p.name as string,
          status: p.status as string,
          clientName: (p.client_name ?? null) as string | null,
          startDate: (p.start_date ?? null) as string | null,
          endDate: (p.end_date ?? null) as string | null,
          openingDate: (p.opening_date ?? null) as string | null,
          dropboxMapped: p.cloud_storage_connection_id != null,
          canSeeCost: cost,
          ...(cost ? { contractValue: (p.contract_value ?? null) as number | null } : {}),
        }
      }),
      nextCursor: truncated ? encodeCursor(page[page.length - 1].created_at) : null,
      truncated,
    }
  },
})

export const esiteProjectGet = defineTool({
  name: 'esite_project_get',
  title: 'Get a project',
  description: 'Returns one project with its settings, contacts and members. The contract block (value, retention) is present only where your role may see cost.',
  kind: 'read',
  inputSchema: { projectId },
  projectIdOf: (a) => a.projectId,
  handler: async ({ projectId: id }, ctx) => {
    await assertVisible(ctx, id)
    const [project, settings, contacts, members, cost] = await Promise.all([
      projectService.getById(svc(ctx), id).catch(() => { throw new ToolRefusal(NOT_FOUND) }),
      getProjectSettingsCached(id),
      listProjectContacts(id),
      listProjectMembers(id),
      canSeeContractFigures(ctx, id),
    ])
    if ('error' in contacts) throw new Error('listProjectContacts failed')
    if ('error' in members) throw new Error('listProjectMembers failed')
    const p = project as Record<string, any>
    return {
      project: {
        id: p.id as string,
        code: p.code as string,
        name: p.name as string,
        organisationId: p.organisation_id as string,
        status: p.status as string,
        description: p.description ?? null,
        clientName: p.client_name ?? null,
        clientContact: p.client_contact ?? null,
        projectType: p.project_type ?? null,
        address: p.address ?? null,
        city: p.city ?? null,
        province: p.province ?? null,
        startDate: p.start_date ?? null,
        endDate: p.end_date ?? null,
        openingDate: p.opening_date ?? null,
        dropboxMapped: p.cloud_storage_connection_id != null,
      },
      settings: withoutCostKeys(settings as Record<string, unknown> | null),
      contract: cost
        ? {
            contractValue: (p.contract_value ?? null) as number | null,
            currency: (p.currency ?? null) as string | null,
            contractType: (settings as { contractType?: string } | null)?.contractType ?? null,
            retentionPct: (settings as { retentionPct?: number } | null)?.retentionPct ?? null,
            contractSignedDate: (settings as { contractSignedDate?: string | null } | null)?.contractSignedDate ?? null,
            practicalCompletionDate: (settings as { practicalCompletionDate?: string | null } | null)?.practicalCompletionDate ?? null,
          }
        : null,
      contacts: contacts.contacts,
      members: members.members.map((m) => ({
        userId: m.user_id, fullName: m.full_name, email: m.email, role: m.role, orgRole: m.org_role, isActive: m.is_active,
      })),
    }
  },
})

export const esiteProjectHistory = defineTool({
  name: 'esite_project_history',
  title: 'Project settings history',
  description: 'Returns the most recent changes to a project\'s settings, newest first, with who changed what and when.',
  kind: 'read',
  inputSchema: { projectId, limit },
  projectIdOf: (a) => a.projectId,
  handler: async ({ projectId: id, limit: n }, ctx) => {
    await assertVisible(ctx, id)
    const take = Math.min(MAX_LIMIT, Math.max(1, n))
    const [rows, cost] = await Promise.all([getProjectHistoryCached(id, take), canSeeContractFigures(ctx, id)])
    return {
      rows: cost
        ? rows
        : rows.map((r) => ({
            ...r,
            snapshot: withoutCostKeys(r.snapshot as unknown as Record<string, unknown>),
            diff: r.diff ? Object.fromEntries(Object.entries(r.diff).filter(([k]) => !(COST_SETTING_KEYS as readonly string[]).includes(k))) : r.diff,
          })),
    }
  },
})

export const discoveryTools = [esiteWhoami, esiteProjectsList, esiteProjectGet, esiteProjectHistory]
