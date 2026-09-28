import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadSolarEntry: vi.fn(),
  listSolarGrantors: vi.fn(),
  profileName: vi.fn(),
  notify: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/entry-loader', () => ({ loadSolarEntry: h.loadSolarEntry }))
vi.mock('@/lib/solar/grantors', () => ({ listSolarGrantors: h.listSolarGrantors, profileName: h.profileName }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  requestSolarAccessAction, askAdminToSubscribeAction, withdrawSolarRequestAction,
  getSolarNavStateAction, getSolarSubscriptionStateAction,
} from './solar-requests.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = 'p1'
const ORG = 'org-1'
const U = 'user-1'
const ctx = (state: unknown) => ({ projectId: P, projectName: 'Mall', organisationId: ORG, userId: U, state })

beforeEach(() => {
  vi.clearAllMocks()
  h.listSolarGrantors.mockResolvedValue([
    { userId: 'admin-1', fullName: 'Ann', email: 'ann@x.test' },
    { userId: U, fullName: 'Me', email: 'me@x.test' },
  ])
  h.profileName.mockResolvedValue('Bob')
})

describe('getSolarNavStateAction', () => {
  it('maps the resolved state to a badge, hidden when there is no context', async () => {
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'pending', requestedAt: 'x' }))
    await expect(getSolarNavStateAction(P)).resolves.toBe('pending')
    h.loadSolarEntry.mockResolvedValueOnce(null)
    await expect(getSolarNavStateAction(P)).resolves.toBe('hidden')
  })
})

describe('getSolarSubscriptionStateAction', () => {
  it('is active only once the caller resolves to granted', async () => {
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'subscribe' }))
    await expect(getSolarSubscriptionStateAction(P)).resolves.toEqual({ active: false })
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'granted', level: 'edit_financials', maxLevel: 'edit_financials' }))
    await expect(getSolarSubscriptionStateAction(P)).resolves.toEqual({ active: true })
  })
})

describe('requestSolarAccessAction', () => {
  it('refuses an unknown level before touching the database', async () => {
    await expect(requestSolarAccessAction({ projectId: P, level: 'owner' })).resolves.toEqual({ error: 'Choose the level you need.' })
    expect(h.createClient).not.toHaveBeenCalled()
  })

  it('refuses when a request is already pending (the page gate is not trusted)', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'pending', requestedAt: 'x' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'view' }))
      .resolves.toEqual({ error: 'You already have a request waiting for an answer.' })
    expect(callsTo(calls, 'solar.access_requests', 'insert')).toHaveLength(0)
  })

  it('inserts the request, notifies the grantors except the requester, and records the event', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'request_access', maxLevel: 'edit_financials' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'edit', note: '  need it  ' })).resolves.toEqual({ ok: true })
    expect(h.loadSolarEntry).toHaveBeenCalledWith(P, client)
    expect(callsTo(calls, 'solar.access_requests', 'insert')[0].payload).toMatchObject({
      project_id: P, requester_id: U, kind: 'access', requested_level: 'edit', note: 'need it',
    })
    expect(h.notify).toHaveBeenCalledWith(['admin-1'], ['ann@x.test'], expect.objectContaining({
      type: 'solar_access_requested',
      title: 'Bob asked for Solar access',
      body: 'Bob asked for Edit access to Solar on Mall. Note: "need it"',
      route: `/projects/${P}/solar/access`,
      email: true,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_access_requested', projectId: P, actorId: U }))
    expect(h.revalidate).toHaveBeenCalledWith(`/projects/${P}/solar/locked`)
  })

  it('lets a View user ask for Edit (the View-only banner)', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'view', maxLevel: 'edit_financials' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'edit' })).resolves.toEqual({ ok: true })
  })

  // Security review Important 1: an external at View asked for Edit, the guard
  // clamped the row to View, and every admin was emailed "asked for Edit".
  it('refuses a level above what the caller can hold, before any write or notice', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'view', maxLevel: 'view' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'edit' })).resolves.toEqual({
      error: 'That level is higher than you can hold on this project. Members from outside the organisation can have View only.',
    })
    expect(callsTo(calls, 'solar.access_requests', 'insert')).toHaveLength(0)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('refuses asking for a level the caller already has', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'edit', maxLevel: 'edit_financials' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'view' })).resolves.toEqual({ error: 'You already have that level or higher.' })
    expect(callsTo(calls, 'solar.access_requests', 'insert')).toHaveLength(0)
  })

  it('the notice names the level the database STORED, not the one asked for', async () => {
    const { client } = fakeSupabase({ userId: U, writes: { 'solar.access_requests:insert': { data: [{ requested_level: 'view' }] } } })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'request_access', maxLevel: 'edit_financials' }))
    await requestSolarAccessAction({ projectId: P, level: 'edit' })
    expect(h.notify).toHaveBeenCalledWith(['admin-1'], ['ann@x.test'], expect.objectContaining({
      body: 'Bob asked for View access to Solar on Mall.',
    }))
  })

  it('maps a duplicate pending request to a sentence', async () => {
    const { client } = fakeSupabase({
      userId: U,
      writes: { 'solar.access_requests:insert': { error: { code: '23505', message: 'duplicate key' } } },
    })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'request_access', maxLevel: 'view' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'view' }))
      .resolves.toEqual({ error: 'You already have a request waiting for an answer.' })
    expect(h.notify).not.toHaveBeenCalled()
  })
})

describe('askAdminToSubscribeAction', () => {
  it('refuses once already asked', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ error: 'You have already asked — the admins have been told.' })
  })

  it('refuses an owner/admin (they subscribe themselves)', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'subscribe' }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ error: 'There is nothing to request here.' })
  })

  it('records a subscribe request and tells the admins "<name> would like Solar for <project>"', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'ask_admin', requestedAt: null }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ ok: true })
    expect(callsTo(calls, 'solar.access_requests', 'insert')[0].payload).toMatchObject({ kind: 'subscribe', requested_level: null })
    expect(h.notify).toHaveBeenCalledWith(['admin-1'], ['ann@x.test'], expect.objectContaining({
      type: 'solar_subscribe_requested', title: 'Bob would like Solar for Mall', email: true,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_subscribe_requested' }))
  })
})

describe('withdrawSolarRequestAction', () => {
  it('withdraws my pending access request', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    await expect(withdrawSolarRequestAction(P)).resolves.toEqual({ ok: true })
    const upd = callsTo(calls, 'solar.access_requests', 'update')[0]
    expect(upd.payload).toEqual({ status: 'withdrawn' })
    expect(upd.filters).toEqual(expect.arrayContaining([
      ['eq', 'project_id', P], ['eq', 'requester_id', U], ['eq', 'kind', 'access'], ['eq', 'status', 'pending'],
    ]))
  })

  it('says so when nothing was waiting', async () => {
    const { client } = fakeSupabase({ userId: U, writes: { 'solar.access_requests:update': { data: [] } } })
    h.createClient.mockResolvedValue(client)
    await expect(withdrawSolarRequestAction(P)).resolves.toEqual({ error: 'There was no request waiting — reload the page.' })
  })
})
