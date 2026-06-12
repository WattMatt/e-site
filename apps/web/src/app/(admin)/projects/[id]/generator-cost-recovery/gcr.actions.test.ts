import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const requireRoleMock = vi.fn()
const requireEffectiveRoleMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: requireRoleMock,
  requireEffectiveRole: requireEffectiveRoleMock,
}))

// ─── IDs ──────────────────────────────────────────────────────────────────────

const PROJECT_ID        = '00000000-0000-0000-0000-000000000011'
const OTHER_PROJECT_ID  = '00000000-0000-0000-0000-000000000099'
const ORG_ID            = '00000000-0000-0000-0000-000000000001'
const NODE_ID           = '00000000-0000-0000-0000-000000000022'
const ZONE_ID           = '00000000-0000-0000-0000-000000000033'
const GENERATOR_ID      = '00000000-0000-0000-0000-000000000044'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal supabase mock that returns the project row from
 * projects.projects (used by resolveOrgId), then satisfies any further
 * query chains with a no-error resolved value.
 */
function makeProjectSchemaChain(orgId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: orgId ? { organisation_id: orgId } : null,
    error: null,
  })
  const eqId     = vi.fn().mockReturnValue({ maybeSingle })
  const select   = vi.fn().mockReturnValue({ eq: eqId })
  // schema('projects').from('projects') → { select }
  const fromProjects = vi.fn().mockReturnValue({ select })
  const schema = vi.fn().mockReturnValue({ from: fromProjects })
  return schema
}

/**
 * A schema mock that also handles the downstream write (upsert/update/delete)
 * returning no error by default.
 */
function makeWriteSchemaChain(
  projectOrgId: string,
  writeError: null | { message: string } = null,
) {
  // --- projects schema resolve chain ---
  const maybeSingle  = vi.fn().mockResolvedValue({ data: { organisation_id: projectOrgId }, error: null })
  const eqIdProject  = vi.fn().mockReturnValue({ maybeSingle })
  const selectProj   = vi.fn().mockReturnValue({ eq: eqIdProject })
  const fromProjects = vi.fn().mockReturnValue({ select: selectProj })

  // --- gcr / structure write chain ---
  // upsert / update / delete all resolve immediately
  const upsert = vi.fn().mockResolvedValue({ error: writeError })
  const update = vi.fn().mockResolvedValue({ error: writeError })
  // delete chain: .eq(...).eq(...)
  const deleteEq2 = vi.fn().mockResolvedValue({ error: writeError })
  const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 })
  const del = vi.fn().mockReturnValue({ eq: deleteEq1 })

  const fromWrite = vi.fn().mockReturnValue({ upsert, update, delete: del })

  const schema = vi.fn((schemaName: string) => {
    if (schemaName === 'projects') return { from: fromProjects }
    return { from: fromWrite }
  })

  return { schema, upsert, update, del }
}

// ─── saveGcrSettingsAction ───────────────────────────────────────────────────

describe('saveGcrSettingsAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  const validSettings = {
    standard_kw_per_sqm: 0.03,
    fast_food_kw_per_sqm: 0.045,
    restaurant_kw_per_sqm: 0.045,
    national_kw_per_sqm: 0.03,
    capital_recovery_period_years: 10,
    capital_recovery_rate_percent: 12,
    rate_per_tenant_db: 0,
    num_main_boards: 2,
    rate_per_main_board: 5000,
    additional_cabling_cost: 10000,
    control_wiring_cost: 3000,
    diesel_cost_per_litre: 23,
    running_hours_per_month: 100,
    maintenance_cost_annual: 18800,
    power_factor: 0.95,
    running_load_percentage: 75,
    maintenance_contingency_percent: 10,
  }

  it('returns { error } when project is not found (resolveOrgId returns null)', async () => {
    const schema = makeProjectSchemaChain(null)
    createClientMock.mockResolvedValueOnce({ schema })

    const { saveGcrSettingsAction } = await import('./gcr.actions')
    const result = await saveGcrSettingsAction(PROJECT_ID, validSettings)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/Project not found/i)
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('returns { error } when caller role is not in ORG_WRITE_ROLES', async () => {
    const schema = makeProjectSchemaChain(ORG_ID)
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })

    const { saveGcrSettingsAction } = await import('./gcr.actions')
    const result = await saveGcrSettingsAction(PROJECT_ID, validSettings)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/contractor/i)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('happy path: upserts gcr.settings and revalidates the path', async () => {
    const { schema, upsert } = makeWriteSchemaChain(ORG_ID)
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })

    const { saveGcrSettingsAction } = await import('./gcr.actions')
    const result = await saveGcrSettingsAction(PROJECT_ID, validSettings)

    expect(result).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        organisation_id: ORG_ID,
        standard_kw_per_sqm: 0.03,
      }),
      { onConflict: 'project_id' },
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/generator-cost-recovery`,
    )
  })

  it('returns { error } when the upsert itself fails', async () => {
    const { schema } = makeWriteSchemaChain(ORG_ID, { message: 'DB constraint violation' })
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })

    const { saveGcrSettingsAction } = await import('./gcr.actions')
    const result = await saveGcrSettingsAction(PROJECT_ID, validSettings)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/DB constraint/i)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

// ─── bulkSaveTenantAssignmentsAction ─────────────────────────────────────────

function makeRpcSchemaChain(orgId: string, rpcResult: { data: unknown; error: null | { message: string } }) {
  const maybeSingle  = vi.fn().mockResolvedValue({ data: { organisation_id: orgId }, error: null })
  const eqId         = vi.fn().mockReturnValue({ maybeSingle })
  const select       = vi.fn().mockReturnValue({ eq: eqId })
  const fromProjects = vi.fn().mockReturnValue({ select })
  const rpc          = vi.fn().mockResolvedValue(rpcResult)
  const schema = vi.fn((name: string) =>
    name === 'projects' ? { from: fromProjects } : { rpc },
  )
  return { schema, rpc }
}

describe('bulkSaveTenantAssignmentsAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty patch', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: 1, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], {})
    expect(res).toEqual({ error: 'Nothing to save' })
  })

  it('maps the patch to set-flag rpc params (null zone = explicit clear)', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema, rpc } = makeRpcSchemaChain(ORG_ID, { data: 2, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID, ZONE_ID], { zone_id: null, participation: 'own' })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', {
      p_project_id: PROJECT_ID,
      p_node_ids: [NODE_ID, ZONE_ID],
      p_set_zone: true,
      p_zone_id: null,
      p_set_participation: true,
      p_participation: 'own',
      p_set_category: false,
      p_shop_category: null,
      p_set_manual_kw: false,
      p_manual_kw: null,
    })
    expect(res).toEqual({ ok: true, updated: 2 })
  })

  it('returns the rpc error message on failure', async () => {
    requireRoleMock.mockResolvedValue({ ok: true })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: null, error: { message: 'One or more shops do not belong to this project' } })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], { participation: 'none' })
    expect(res).toEqual({ error: 'One or more shops do not belong to this project' })
  })

  it('gates on role', async () => {
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })
    const { schema } = makeRpcSchemaChain(ORG_ID, { data: 1, error: null })
    createClientMock.mockResolvedValue({ schema })
    const { bulkSaveTenantAssignmentsAction } = await import('./gcr.actions')
    const res = await bulkSaveTenantAssignmentsAction(PROJECT_ID, [NODE_ID], { participation: 'none' })
    expect(res).toEqual({ error: 'Forbidden' })
  })
})

// ─── deleteGeneratorAction ───────────────────────────────────────────────────

describe('deleteGeneratorAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  /**
   * Build a schema mock that:
   *  - resolves the org from projects.projects
   *  - returns a generator row whose zone_id belongs to the given zoneProjectId
   *  - returns that zone row with the given project_id
   */
  function makeDeleteSchemaChain(opts: {
    generatorZoneId: string
    zoneProjectId:   string
    deleteError:     null | { message: string }
  }) {
    // projects.projects resolve
    const maybeSingleProj = vi.fn().mockResolvedValue({ data: { organisation_id: ORG_ID }, error: null })
    const eqIdProj        = vi.fn().mockReturnValue({ maybeSingle: maybeSingleProj })
    const selectProj      = vi.fn().mockReturnValue({ eq: eqIdProj })
    const fromProjects    = vi.fn().mockReturnValue({ select: selectProj })

    // gcr.zone_generators — fetch zone_id
    const maybeSingleGen = vi.fn().mockResolvedValue({
      data: { zone_id: opts.generatorZoneId },
      error: null,
    })
    const eqGen    = vi.fn().mockReturnValue({ maybeSingle: maybeSingleGen })
    const selectGen = vi.fn().mockReturnValue({ eq: eqGen })

    // gcr.zones — fetch project_id for that zone
    const maybeSingleZone = vi.fn().mockResolvedValue({
      data: { project_id: opts.zoneProjectId },
      error: null,
    })
    const eqZone    = vi.fn().mockReturnValue({ maybeSingle: maybeSingleZone })
    const selectZone = vi.fn().mockReturnValue({ eq: eqZone })

    // gcr.zone_generators delete chain
    const deleteEq2 = vi.fn().mockResolvedValue({ error: opts.deleteError })
    const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 })
    const del       = vi.fn().mockReturnValue({ eq: deleteEq1 })

    // Track which from() call we're on to route correctly
    let gcrFromCallCount = 0
    const fromGcr = vi.fn(() => {
      gcrFromCallCount++
      if (gcrFromCallCount === 1) return { select: selectGen }  // zone_generators select
      if (gcrFromCallCount === 2) return { select: selectZone } // zones select
      return { delete: del }                                     // zone_generators delete
    })

    const schema = vi.fn((schemaName: string) => {
      if (schemaName === 'projects') return { from: fromProjects }
      return { from: fromGcr }
    })

    return { schema, del }
  }

  it('refuses to delete a generator whose zone belongs to a different project', async () => {
    const { schema } = makeDeleteSchemaChain({
      generatorZoneId: ZONE_ID,
      zoneProjectId:   OTHER_PROJECT_ID, // zone belongs to a SIBLING project
      deleteError:     null,
    })
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })

    const { deleteGeneratorAction } = await import('./gcr.actions')
    const result = await deleteGeneratorAction(PROJECT_ID, GENERATOR_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('happy path: deletes a generator that belongs to this project', async () => {
    const { schema, del } = makeDeleteSchemaChain({
      generatorZoneId: ZONE_ID,
      zoneProjectId:   PROJECT_ID, // same project — allowed
      deleteError:     null,
    })
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })

    const { deleteGeneratorAction } = await import('./gcr.actions')
    const result = await deleteGeneratorAction(PROJECT_ID, GENERATOR_ID)

    expect(result).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/generator-cost-recovery`,
    )
  })
})

// ─── loadGcrConfigAction — tenant query filters ──────────────────────────────

describe('loadGcrConfigAction — tenant query filters', () => {
  it('excludes soft-deleted and decommissioned shops', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true })
    const calls: Record<string, unknown[][]> = { eq: [], is: [], neq: [] }
    // chainable query stub that records filter calls and resolves to empty data
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn((...a: unknown[]) => { calls.eq.push(a); return chain }),
      is: vi.fn((...a: unknown[]) => { calls.is.push(a); return chain }),
      neq: vi.fn((...a: unknown[]) => { calls.neq.push(a); return chain }),
      order: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    createClientMock.mockResolvedValue({ schema: vi.fn(() => ({ from: vi.fn(() => chain) })) })

    const { loadGcrConfigAction } = await import('./gcr.actions')
    await loadGcrConfigAction(PROJECT_ID)

    expect(calls.is).toContainEqual(['deleted_at', null])
    expect(calls.neq).toContainEqual(['status', 'decommissioned'])
  })
})

// ─── bulkSetUncategorizedTenantsAction ───────────────────────────────────────

describe('bulkSetUncategorizedTenantsAction', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  /** projects resolve + structure.nodes .update().eq().eq().is().select() chain */
  function makeBulkChain(updatedIds: unknown[], updateError: null | { message: string } = null) {
    const maybeSingle  = vi.fn().mockResolvedValue({ data: { organisation_id: ORG_ID }, error: null })
    const eqIdProject  = vi.fn().mockReturnValue({ maybeSingle })
    const selectProj   = vi.fn().mockReturnValue({ eq: eqIdProject })
    const fromProjects = vi.fn().mockReturnValue({ select: selectProj })

    const select = vi.fn().mockResolvedValue({ data: updateError ? null : updatedIds, error: updateError })
    const is     = vi.fn().mockReturnValue({ select })
    const eq2    = vi.fn().mockReturnValue({ is })
    const eq1    = vi.fn().mockReturnValue({ eq: eq2 })
    const update = vi.fn().mockReturnValue({ eq: eq1 })
    const fromNodes = vi.fn().mockReturnValue({ update })

    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: fromProjects } : { from: fromNodes },
    )
    return { schema, update, eq1, eq2, is }
  }

  it('returns { error } when caller lacks ORG_WRITE_ROLES', async () => {
    const { schema } = makeBulkChain([])
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: false, error: 'Your role (viewer) is not allowed' })

    const { bulkSetUncategorizedTenantsAction } = await import('./gcr.actions')
    const result = await bulkSetUncategorizedTenantsAction(PROJECT_ID)

    expect('error' in result).toBe(true)
  })

  it('fills NULL categories only, scoped to project + tenant_db, and reports the count', async () => {
    const { schema, update, eq1, eq2, is } = makeBulkChain([{ id: 'n1' }, { id: 'n2' }])
    createClientMock.mockResolvedValueOnce({ schema })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })

    const { bulkSetUncategorizedTenantsAction } = await import('./gcr.actions')
    const result = await bulkSetUncategorizedTenantsAction(PROJECT_ID)

    expect(result).toEqual({ ok: true, updated: 2 })
    expect(update).toHaveBeenCalledWith({ shop_category: 'standard' })
    expect(eq1).toHaveBeenCalledWith('project_id', PROJECT_ID)
    expect(eq2).toHaveBeenCalledWith('kind', 'tenant_db')
    expect(is).toHaveBeenCalledWith('shop_category', null)
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/generator-cost-recovery`,
    )
  })
})
