import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const dispatchNotificationMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))

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

  /** Service client resolving PM recipients (project_members + profiles). */
  function makeServiceClient(members: any[], profiles: any[]) {
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

  it('emails the admins via send-email with resolved recipients', async () => {
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
    expect(cookie.functions.invoke).toHaveBeenCalledWith('send-email', {
      body: expect.objectContaining({
        type: 'gcr-client-request',
        payload: expect.objectContaining({ to: ['pm@x.com'], projectId: PROJECT_ID, requestCount: 1 }),
      }),
    })
  })

  it('errors when no snapshot has been published', async () => {
    const cookie = makeCookieClient(null)
    createClientMock.mockResolvedValue(cookie)

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: null },
    ])
    expect('error' in res).toBe(true)
  })

  it('errors on empty batch', async () => {
    createClientMock.mockResolvedValue({ auth: userAuth(CLIENT_ID) })
    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [])
    expect('error' in res).toBe(true)
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
