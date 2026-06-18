import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const requireRoleMock = vi.fn()
const dispatchNotificationMock = vi.fn()
const loadGcrConfigActionMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))
vi.mock('./gcr.actions', () => ({ loadGcrConfigAction: loadGcrConfigActionMock }))

// ─── IDs ──────────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const CLIENT_ID = '00000000-0000-0000-0000-000000000077'
const REQ_ID = '00000000-0000-0000-0000-0000000000aa'
const NODE_ID = '00000000-0000-0000-0000-0000000000bb'
const SNAP_ID = '00000000-0000-0000-0000-0000000000cc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** projects.projects resolveOrgId chain. */
function projectsSchemaChain(orgId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: orgId ? { organisation_id: orgId } : null,
    error: null,
  })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return vi.fn().mockReturnValue({ select })
}

const noFunctions = { functions: { invoke: vi.fn().mockResolvedValue({ error: null }) } }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

// ─── publishGcrForClientReviewAction ─────────────────────────────────────────

describe('publishGcrForClientReviewAction', () => {
  const config = {
    settings: { id: 's1' },
    zones: [{ id: ZONE('A'), zone_name: 'Bank A', zone_number: 1, display_order: 0 }],
    generators: [{ id: 'g1', zone_id: ZONE('A'), generator_number: 1, generator_size: '500 kVA', generator_cost: 1 }],
    tenants: [{ id: NODE_ID, shop_number: 'S1', shop_name: 'Shop One', shop_area_m2: 100, shop_category: 'standard', generator_participation: 'shared' }],
    assignments: [{ node_id: NODE_ID, zone_id: ZONE('A'), manual_kw_override: null }],
  }

  it('non-admin is rejected (ORG_WRITE_ROLES gate)', async () => {
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({ schema })
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })

    const { publishGcrForClientReviewAction } = await import('./gcr-client-review.actions')
    const res = await publishGcrForClientReviewAction(PROJECT_ID)
    expect('error' in res).toBe(true)
    expect(loadGcrConfigActionMock).not.toHaveBeenCalled()
  })

  it('inserts an outputs-only snapshot row pinned to the project org', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const fromGcr = vi.fn((table: string) =>
      table === 'review_snapshots' ? { insert } : ({} as any))
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : { from: fromGcr })
    createClientMock.mockResolvedValue({
      schema,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    loadGcrConfigActionMock.mockResolvedValue(config)

    const { publishGcrForClientReviewAction } = await import('./gcr-client-review.actions')
    const res = await publishGcrForClientReviewAction(PROJECT_ID)
    expect(res).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0]
    expect(row).toMatchObject({
      project_id: PROJECT_ID,
      organisation_id: ORG_ID,
      created_by: 'admin1',
    })
    // The payload is the outputs-only projection.
    expect(row.payload.tenants[0]).toMatchObject({ shopNumber: 'S1', monthly: expect.any(Number) })
    expect(row.payload.banks[0]).toMatchObject({ zoneName: 'Bank A', installedKva: 500 })
    expect(row.published_for_client_at).toEqual(expect.any(String))
    // SECURITY: snapshot must never carry contractor cost inputs.
    const json = JSON.stringify(row.payload)
    for (const bad of ['totalCapitalCost', 'generator_cost', 'dieselPerKwh', 'maintenancePerKwh']) {
      expect(json).not.toContain(`"${bad}"`)
    }
  })

  it('surfaces a load error from the engine config', async () => {
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({
      schema,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    loadGcrConfigActionMock.mockResolvedValue({ error: 'forbidden' })

    const { publishGcrForClientReviewAction } = await import('./gcr-client-review.actions')
    const res = await publishGcrForClientReviewAction(PROJECT_ID)
    expect(res).toEqual({ error: 'forbidden' })
  })
})

// Helper to keep zone ids stable + readable.
function ZONE(label: string) {
  return `00000000-0000-0000-0000-0000000000${label === 'A' ? 'd1' : 'd2'}`
}

// ─── manageClientSiteAccessAction ────────────────────────────────────────────

describe('manageClientSiteAccessAction', () => {
  it('gates on ORG_WRITE_ROLES', async () => {
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({ schema })
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })

    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'grant')
    expect('error' in res).toBe(true)
  })

  it('grant: rejects when the client has no account yet', async () => {
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({ schema })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    // service-role profile lookup → no profile
    const svcMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const svcEq = vi.fn().mockReturnValue({ maybeSingle: svcMaybeSingle })
    const svcSelect = vi.fn().mockReturnValue({ eq: svcEq })
    createServiceClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select: svcSelect }) })

    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'grant')
    expect(res).toEqual({ error: 'No client account for that user — invite them first' })
  })

  it('grant: inserts a client_site_grants row pinned to the project org', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn((table: string) =>
      table === 'client_site_grants' ? { insert } : ({} as any))
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({
      schema,
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const svcMaybeSingle = vi.fn().mockResolvedValue({ data: { id: CLIENT_ID }, error: null })
    const svcEq = vi.fn().mockReturnValue({ maybeSingle: svcMaybeSingle })
    const svcSelect = vi.fn().mockReturnValue({ eq: svcEq })
    createServiceClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select: svcSelect }) })

    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'grant')
    expect(res).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: CLIENT_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, granted_by: 'admin1',
    }))
  })

  it('revoke: deletes the grant row by user + project', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const del = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn((table: string) =>
      table === 'client_site_grants' ? { delete: del } : ({} as any))
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : ({} as any))
    createClientMock.mockResolvedValue({
      schema,
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'revoke')
    expect(res).toEqual({ ok: true })
    expect(del).toHaveBeenCalled()
    expect(eq1).toHaveBeenCalledWith('user_id', CLIENT_ID)
    expect(eq2).toHaveBeenCalledWith('project_id', PROJECT_ID)
  })
})

// ─── actionGcrChangeRequestAction ────────────────────────────────────────────

describe('actionGcrChangeRequestAction', () => {
  /**
   * Build a supabase mock whose gcr schema serves change_requests (select+update)
   * + a bulk RPC, and whose projects schema resolves the org. Also stubs a
   * profiles email lookup (public schema) for the client-email notification.
   */
  function makeChain(reqRow: any, updateError: null | { message: string } = null) {
    const reqMaybeSingle = vi.fn().mockResolvedValue({ data: reqRow, error: null })
    const reqEq = vi.fn().mockReturnValue({ maybeSingle: reqMaybeSingle })
    const reqSelect = vi.fn().mockReturnValue({ eq: reqEq })

    const updEq = vi.fn().mockResolvedValue({ error: updateError })
    const update = vi.fn().mockReturnValue({ eq: updEq })

    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })

    // structure.nodes direct update chain (for field 'area')
    const nodesEq2 = vi.fn().mockResolvedValue({ error: null })
    const nodesEq1 = vi.fn().mockReturnValue({ eq: nodesEq2 })
    const nodesUpdate = vi.fn().mockReturnValue({ eq: nodesEq1 })

    const fromGcr = vi.fn((table: string) =>
      table === 'change_requests' ? { select: reqSelect, update } : ({} as any))
    const fromStructure = vi.fn((table: string) =>
      table === 'nodes' ? { update: nodesUpdate } : ({} as any))

    // profiles email lookup (public schema)
    const profMaybeSingle = vi.fn().mockResolvedValue({ data: { email: 'client@x.com' }, error: null })
    const profEq = vi.fn().mockReturnValue({ maybeSingle: profMaybeSingle })
    const profSelect = vi.fn().mockReturnValue({ eq: profEq })
    const fromPublic = vi.fn((table: string) =>
      table === 'profiles' ? { select: profSelect } : ({} as any))

    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } :
      name === 'structure' ? { from: fromStructure } :
      { from: fromGcr, rpc })

    return { schema, rpc, update, nodesUpdate, fromPublic }
  }

  it('accept (participation): applies the proposed value to the live schedule via the bulk RPC', async () => {
    const { schema, rpc, update, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(res).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', expect.objectContaining({
      p_project_id: PROJECT_ID, p_node_ids: [NODE_ID], p_set_participation: true, p_participation: 'own',
    }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', actioned_by: 'admin1' }))
    expect(dispatchNotificationMock).toHaveBeenCalled()
  })

  it('accept (zone): writes zone_id via the bulk RPC', async () => {
    const { schema, rpc, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'zone', new_value: 'zone-x', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', expect.objectContaining({
      p_set_zone: true, p_zone_id: 'zone-x', p_set_participation: false,
    }))
  })

  it('accept (category): writes shop_category via the bulk RPC', async () => {
    const { schema, rpc, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'category', new_value: 'restaurant', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', expect.objectContaining({
      p_set_category: true, p_shop_category: 'restaurant',
    }))
  })

  it('accept (manual_kw_override): writes a numeric manual kW via the bulk RPC', async () => {
    const { schema, rpc, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'manual_kw_override', new_value: '12.5', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', expect.objectContaining({
      p_set_manual_kw: true, p_manual_kw: 12.5,
    }))
  })

  it('accept (area): updates structure.nodes.shop_area_m2 directly, NOT the bulk RPC', async () => {
    const chain = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'area', new_value: '250', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema: chain.schema, from: chain.fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(chain.rpc).not.toHaveBeenCalled()
    expect(chain.nodesUpdate).toHaveBeenCalledWith({ shop_area_m2: 250 })
  })

  it('decline: records reason, does NOT call the bulk RPC', async () => {
    const { schema, rpc, update, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'decline', reply: 'Not feasible' })
    expect(res).toEqual({ ok: true })
    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined', admin_reply: 'Not feasible' }))
    expect(dispatchNotificationMock).toHaveBeenCalled()
  })

  it('reply: sets admin_reply without changing status, no RPC', async () => {
    const { schema, rpc, update, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'reply', reply: 'We are reviewing.' })
    expect(res).toEqual({ ok: true })
    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', admin_reply: 'We are reviewing.' }))
  })

  it('rejects a request that belongs to another project', async () => {
    const { schema, fromPublic } = makeChain({
      id: REQ_ID, project_id: 'other-project', organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, from: fromPublic, ...noFunctions,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect('error' in res).toBe(true)
  })

  it('non-admin is rejected', async () => {
    const { schema, fromPublic } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({ schema, from: fromPublic, ...noFunctions })
    requireRoleMock.mockResolvedValue({ ok: false, error: 'forbidden' })

    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect('error' in res).toBe(true)
  })
})

// ─── listGcrChangeRequestsAction ─────────────────────────────────────────────

describe('listGcrChangeRequestsAction', () => {
  it('returns the change-request queue for the admin', async () => {
    const rows = [{ id: REQ_ID, field: 'participation' }]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const fromGcr = vi.fn((table: string) =>
      table === 'change_requests' ? { select } : ({} as any))
    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: projectsSchemaChain(ORG_ID) } : { from: fromGcr })
    createClientMock.mockResolvedValue({ schema })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { listGcrChangeRequestsAction } = await import('./gcr-client-review.actions')
    const res = await listGcrChangeRequestsAction(PROJECT_ID)
    expect(res).toEqual(rows)
  })
})
