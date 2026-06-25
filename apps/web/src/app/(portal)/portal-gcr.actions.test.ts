import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const dispatchNotificationMock = vi.fn()
const dispatchEmailMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/notifications', () => ({
  dispatchNotification: dispatchNotificationMock,
  dispatchEmail: dispatchEmailMock,
}))

// ─── IDs ──────────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const CLIENT_ID = '00000000-0000-0000-0000-000000000077'
const SNAP_ID = '00000000-0000-0000-0000-0000000000cc'
const NODE_ID = '00000000-0000-0000-0000-0000000000bb'

const userAuth = (id: string | null) => ({
  getUser: vi.fn().mockResolvedValue({ data: { user: id ? { id } : null } }),
})

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  // dispatchEmail reads these to build the service-role fetch.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

// ─── getClientSitesAction ────────────────────────────────────────────────────

describe('getClientSitesAction', () => {
  it('returns the granted sites for the authenticated client', async () => {
    const rows = [{
      project_id: PROJECT_ID,
      projects: { name: 'Mall A', organisations: { name: 'Org A' } },
    }]
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    createClientMock.mockResolvedValue({ from, auth: userAuth(CLIENT_ID) })

    const { getClientSitesAction } = await import('./portal-gcr.actions')
    const res = await getClientSitesAction()
    expect(res).toEqual([
      { project_id: PROJECT_ID, project_name: 'Mall A', organisation_name: 'Org A' },
    ])
  })

  it('errors when not authenticated', async () => {
    createClientMock.mockResolvedValue({ from: vi.fn(), auth: userAuth(null) })
    const { getClientSitesAction } = await import('./portal-gcr.actions')
    const res = await getClientSitesAction()
    expect('error' in res).toBe(true)
  })
})

// ─── getClientGcrReviewAction ────────────────────────────────────────────────

describe('getClientGcrReviewAction', () => {
  it('calls the grant-gated RPC and returns its payload', async () => {
    const payload = { tenants: [], banks: [], scheme: { monthlyCapitalRepayment: 1, finalTariff: 2 } }
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientGcrReviewAction } = await import('./portal-gcr.actions')
    const res = await getClientGcrReviewAction(PROJECT_ID)
    expect(rpc).toHaveBeenCalledWith('get_client_review', { p_project_id: PROJECT_ID })
    expect(res).toEqual({ payload })
  })

  it('returns an error when the RPC raises (no grant)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not authorised to review this site' } })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientGcrReviewAction } = await import('./portal-gcr.actions')
    const res = await getClientGcrReviewAction(PROJECT_ID)
    expect('error' in res).toBe(true)
  })

  it('returns null payload when no snapshot published yet', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientGcrReviewAction } = await import('./portal-gcr.actions')
    const res = await getClientGcrReviewAction(PROJECT_ID)
    expect(res).toEqual({ payload: null })
  })
})

// ─── getClientReviewNodesAction ──────────────────────────────────────────────

describe('getClientReviewNodesAction', () => {
  it('maps shop_number -> node_id from the grant-gated RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { shop_number: 'S1', node_id: NODE_ID },
        { shop_number: 'S2', node_id: '00000000-0000-0000-0000-0000000000dd' },
      ],
      error: null,
    })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientReviewNodesAction } = await import('./portal-gcr.actions')
    const res = await getClientReviewNodesAction(PROJECT_ID)
    expect(rpc).toHaveBeenCalledWith('get_client_review_nodes', { p_project_id: PROJECT_ID })
    expect(res).toEqual({
      nodeIdByShop: { S1: NODE_ID, S2: '00000000-0000-0000-0000-0000000000dd' },
    })
  })

  it('returns an error when the RPC raises (no grant)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not authorised to review this site' } })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientReviewNodesAction } = await import('./portal-gcr.actions')
    const res = await getClientReviewNodesAction(PROJECT_ID)
    expect('error' in res).toBe(true)
  })

  it('returns an empty map when no nodes exist', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: userAuth(CLIENT_ID),
    })

    const { getClientReviewNodesAction } = await import('./portal-gcr.actions')
    const res = await getClientReviewNodesAction(PROJECT_ID)
    expect(res).toEqual({ nodeIdByShop: {} })
  })
})

// ─── submitGcrChangeRequestsAction ───────────────────────────────────────────

describe('submitGcrChangeRequestsAction', () => {
  /**
   * Build a cookie-client mock: gcr.review_snapshots latest-snapshot lookup +
   * change_requests insert. The service client (recipient resolution) is mocked
   * separately.
   */
  function makeCookieClient(snap: any, insert = vi.fn().mockResolvedValue({ error: null })) {
    const snapMaybeSingle = vi.fn().mockResolvedValue({ data: snap, error: null })
    const snapLimit = vi.fn().mockReturnValue({ maybeSingle: snapMaybeSingle })
    // chain: .select().eq().order().order().order().limit().maybeSingle()
    const snapOrder: any = vi.fn()
    snapOrder.mockReturnValue({ order: snapOrder, limit: snapLimit })
    const snapEq = vi.fn().mockReturnValue({ order: snapOrder })
    const snapSelect = vi.fn().mockReturnValue({ eq: snapEq })

    const fromGcr = vi.fn((table: string) =>
      table === 'review_snapshots' ? { select: snapSelect } :
      table === 'change_requests' ? { insert } : ({} as any))

    return {
      schema: vi.fn(() => ({ from: fromGcr })),
      auth: userAuth(CLIENT_ID),
      functions: { invoke: vi.fn().mockResolvedValue({ error: null }) },
      _insert: insert,
    }
  }

  /**
   * Service client serving (1) the structure.nodes project-scope lookup, (2) PM
   * recipients (projects.project_members), (3) profile emails (public.profiles).
   * `liveNodes` defaults to the canonical NODE_ID so the scope check passes.
   */
  function makeServiceClient(
    members: any[], profiles: any[], liveNodes: { id: string }[] = [{ id: NODE_ID }],
  ) {
    // structure.nodes: .select('id').eq().eq().is().in() -> { data: liveNodes }
    const nodesIn = vi.fn().mockResolvedValue({ data: liveNodes, error: null })
    const nodesIs = vi.fn().mockReturnValue({ in: nodesIn })
    const nodesEq2 = vi.fn().mockReturnValue({ is: nodesIs })
    const nodesEq1 = vi.fn().mockReturnValue({ eq: nodesEq2 })
    const nodesSelect = vi.fn().mockReturnValue({ eq: nodesEq1 })
    const fromStructure = vi.fn((table: string) =>
      table === 'nodes' ? { select: nodesSelect } : ({} as any))

    // chain: .select('user_id, role').eq('project_id', x).in('role', roles)
    const pmIn = vi.fn().mockResolvedValue({ data: members, error: null })
    const pmEq1 = vi.fn().mockReturnValue({ in: pmIn })
    const pmSelect = vi.fn().mockReturnValue({ eq: pmEq1 })
    const fromProjects = vi.fn().mockReturnValue({ select: pmSelect })

    const profIn = vi.fn().mockResolvedValue({ data: profiles, error: null })
    const profSelect = vi.fn().mockReturnValue({ in: profIn })
    const fromPublic = vi.fn((table: string) =>
      table === 'profiles' ? { select: profSelect } : ({} as any))

    return {
      schema: vi.fn((name: string) =>
        name === 'structure' ? { from: fromStructure } :
        name === 'projects' ? { from: fromProjects } : ({} as any)),
      from: fromPublic,
    }
  }

  it('inserts a batch pinned to the latest snapshot + notifies the admin', async () => {
    const cookie = makeCookieClient({ id: SNAP_ID, organisation_id: 'org1' })
    createClientMock.mockResolvedValue(cookie)
    createServiceClientMock.mockReturnValue(makeServiceClient(
      [{ user_id: 'pm1', role: 'project_manager' }],
      [{ id: 'pm1', email: 'pm@x.com' }],
    ))

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: 'we generate our own' },
    ])
    expect(res).toEqual({ ok: true, submitted: 1 })
    expect(cookie._insert).toHaveBeenCalledWith([
      expect.objectContaining({
        project_id: PROJECT_ID, snapshot_id: SNAP_ID, node_id: NODE_ID,
        client_id: CLIENT_ID, field: 'participation', old_value: 'shared', new_value: 'own',
        comment: 'we generate our own',
      }),
    ])
    expect(dispatchNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['pm1'], type: 'gcr_change_request_submitted' }),
    )
  })

  it('emails the admins via the service-role dispatchEmail (not the cookie client)', async () => {
    const cookie = makeCookieClient({ id: SNAP_ID, organisation_id: 'org1' })
    createClientMock.mockResolvedValue(cookie)
    createServiceClientMock.mockReturnValue(makeServiceClient(
      [{ user_id: 'pm1', role: 'project_manager' }],
      [{ id: 'pm1', email: 'pm@x.com' }],
    ))

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: null },
    ])
    // CRITICAL: the branded email must go out via the service-role helper, NOT
    // the cookie client (send-email 403s non-public types for non-service_role).
    expect(dispatchEmailMock).toHaveBeenCalledWith(
      'gcr-client-request',
      expect.objectContaining({ to: ['pm@x.com'], projectId: PROJECT_ID, requestCount: 1 }),
    )
    expect(cookie.functions.invoke).not.toHaveBeenCalled()
  })

  it('errors when no snapshot has been published', async () => {
    const cookie = makeCookieClient(null)
    createClientMock.mockResolvedValue(cookie)
    // Node-scope check (service client) runs first; the node is valid so we
    // reach the snapshot lookup, which returns null.
    createServiceClientMock.mockReturnValue(makeServiceClient([], []))

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: null },
    ])
    expect('error' in res).toBe(true)
  })

  it('errors on empty batch (Zod min(1))', async () => {
    createClientMock.mockResolvedValue({ auth: userAuth(CLIENT_ID) })
    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [])
    expect('error' in res).toBe(true)
  })

  it('rejects an invalid field (Zod enum)', async () => {
    createClientMock.mockResolvedValue({ auth: userAuth(CLIENT_ID) })
    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'monthly' as any, oldValue: null, newValue: '1', comment: null },
    ])
    expect('error' in res).toBe(true)
    // Validation must short-circuit before the snapshot/insert path.
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('rejects a node that belongs to another project', async () => {
    const cookie = makeCookieClient({ id: SNAP_ID, organisation_id: 'org1' })
    const insertSpy = cookie._insert
    createClientMock.mockResolvedValue(cookie)
    // The structure.nodes lookup returns NO matching live nodes for this project.
    createServiceClientMock.mockReturnValue(makeServiceClient([], [], []))

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: null },
    ])
    expect(res).toEqual({ error: 'One or more tenants are not part of this site' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('errors when not authenticated', async () => {
    createClientMock.mockResolvedValue({ auth: userAuth(null) })
    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: null },
    ])
    expect('error' in res).toBe(true)
  })
})

// ─── dispatchEmail (real helper) ─────────────────────────────────────────────
// Proves the email mechanism hits send-email with the SERVICE-ROLE bearer token
// — the whole point of Fix 1. Imports the actual module (bypassing the mock).

describe('dispatchEmail (service-role mechanism)', () => {
  it('POSTs to send-email with the service-role bearer header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    const actual = await vi.importActual<typeof import('@/lib/notifications')>('@/lib/notifications')
    await actual.dispatchEmail('gcr-client-request', { to: ['pm@x.com'], projectId: PROJECT_ID, requestCount: 1 })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://proj.supabase.co/functions/v1/send-email')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer service-role-key')
    expect(JSON.parse(init.body)).toEqual({
      type: 'gcr-client-request',
      payload: { to: ['pm@x.com'], projectId: PROJECT_ID, requestCount: 1 },
    })

    vi.unstubAllGlobals()
  })
})
