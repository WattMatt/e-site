import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  notify: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
  profileEmail: vi.fn(async (id: string) => `${id}@x.test`),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/solar/grantors', () => ({ profileEmail: h.profileEmail }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  setSolarMemberLevelAction, decideSolarRequestAction, copySolarAccessFromProjectAction,
  markSubscribeRequestDoneAction,
} from './solar-access.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = 'p1'
const P2 = 'p2'
const PX = 'p-foreign'
const ADMIN = 'admin-1'
const STALE = 'Someone else changed this — reload to see their version.'

function setup(extra: Partial<FakeOptions> = {}, grantorOn: string[] = [P, P2]) {
  const fake = fakeSupabase({
    userId: ADMIN,
    rpc: { solar_is_grantor: (args) => ({ data: grantorOn.includes(args.p_project_id as string), error: null }) },
    ...extra,
    tables: {
      'projects.projects': [
        { id: P, name: 'Kings Mall', organisation_id: 'org-1' },
        { id: P2, name: 'Other Mall', organisation_id: 'org-1' },
        { id: PX, name: 'Foreign', organisation_id: 'org-2' },
      ],
      ...(extra.tables ?? {}),
    },
  })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => { vi.clearAllMocks() })

describe('setSolarMemberLevelAction', () => {
  it('refuses a non-grantor before any write', async () => {
    const { calls } = setup({}, [])
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'view', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can manage Solar access.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('grants (insert) when the member has no grant yet, notifies them and audits', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'edit', expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.project_access', 'insert')[0].payload).toEqual({ project_id: P, user_id: 'u2', level: 'edit' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: ADMIN, verb: 'access_granted', objectRef: { user_id: 'u2', level: 'edit' } })
    // Owner default 4: an access decision reaches the person by bell AND email.
    expect(h.notify).toHaveBeenCalledWith(['u2'], ['u2@x.test'], expect.objectContaining({
      type: 'solar_access_changed', body: 'You now have Edit access to Solar on Kings Mall.', email: true,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_access_changed', projectId: P }))
  })

  it('a concurrent grant (unique violation) is reported as stale', async () => {
    setup({ writes: { 'solar.project_access:insert': { error: { code: '23505', message: 'duplicate' } } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'view', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: STALE })
  })

  it('changes a level only if nobody changed it since the page loaded', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:update': { data: [] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'edit', expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.project_access', 'update')[0].filters).toEqual(expect.arrayContaining([['eq', 'updated_at', 'T0']]))
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('removes access with the same stale guard', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:delete': { data: [{ user_id: 'u2' }] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: null, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ ok: true, updatedAt: null })
    expect(callsTo(calls, 'solar.project_access', 'delete')[0].filters).toEqual(expect.arrayContaining([['eq', 'updated_at', 'T0']]))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'access_removed' }))
  })

  it('maps the bind trigger’s "exceeds maximum" to a sentence', async () => {
    setup({ writes: { 'solar.project_access:insert': { error: { code: '23514', message: "solar.project_access: level edit exceeds this user's maximum (view)" } } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'ext', level: 'edit', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'That level is higher than this person can hold. Members from outside the organisation can have View only.' })
  })
})

describe('decideSolarRequestAction', () => {
  const pending = { id: 'r1', project_id: P, requester_id: 'u3', kind: 'access', status: 'pending' }

  it('approves with the chosen level, conditioned on the request still being pending', async () => {
    const { calls } = setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve', level: 'view' })).resolves.toEqual({ ok: true })
    const upd = callsTo(calls, 'solar.access_requests', 'update')[0]
    expect(upd.payload).toEqual({ status: 'approved', approved_level: 'view' })
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'pending']]))
    expect(h.notify).toHaveBeenCalledWith(['u3'], ['u3@x.test'], expect.objectContaining({
      type: 'solar_access_changed', title: 'Your Solar access request was approved', email: true,
    }))
  })

  it('declines with an optional reason carried to the requester and the audit trail', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'decline', reason: ' Not on this job ' })).resolves.toEqual({ ok: true })
    expect(h.notify).toHaveBeenCalledWith(['u3'], ['u3@x.test'], expect.objectContaining({
      type: 'solar_access_declined', email: true,
      body: 'Your request for Solar access on Kings Mall was declined. Reason: Not on this job',
    }))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'access_request_declined', objectRef: expect.objectContaining({ reason: 'Not on this job' }),
    }))
  })

  it('says "already answered" when someone else decided first', async () => {
    setup({ tables: { 'solar.access_requests': [pending] }, writes: { 'solar.access_requests:update': { data: [] } } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve', level: 'view' }))
      .resolves.toEqual({ error: 'This request has already been answered — reload to see it.' })
  })

  it('needs a level to approve an access request', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve' }))
      .resolves.toEqual({ error: 'Choose the level to approve.' })
  })

  it('refuses a non-grantor', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } }, [])
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'decline' }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can manage Solar access.' })
  })
})

describe('copySolarAccessFromProjectAction', () => {
  it('refuses a source project in another organisation', async () => {
    setup({}, [P, PX])
    await expect(copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: PX }))
      .resolves.toEqual({ error: 'Copy only works between projects of the same organisation.' })
  })

  it('inserts missing grants, updates different ones, skips equal ones, counts refusals', async () => {
    const { calls } = setup({
      tables: {
        'solar.project_access': [
          { project_id: P2, user_id: 'a', level: 'view' },   // not on target → insert (refused below)
          { project_id: P2, user_id: 'b', level: 'edit' },   // target has view → update
          { project_id: P2, user_id: 'c', level: 'view' },   // target has view → unchanged
          { project_id: P, user_id: 'b', level: 'view' },
          { project_id: P, user_id: 'c', level: 'view' },
        ],
      },
      writes: { 'solar.project_access:insert': { error: { code: '23514', message: 'not an eligible member' } } },
    })
    await expect(copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: P2 }))
      .resolves.toEqual({ ok: true, copied: 1, skipped: 1 })
    expect(callsTo(calls, 'solar.project_access', 'update')[0]).toMatchObject({
      payload: { level: 'edit' }, filters: expect.arrayContaining([['eq', 'project_id', P], ['eq', 'user_id', 'b']]),
    })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'access_copied', objectRef: { source_project_id: P2, copied: 1, skipped: 1 } }))
  })

  // Review I2 / security 3: a copied level is an access decision about that
  // member — bell + email, like the level select. One notice per changed user.
  it('notifies each member whose level the copy changed (bell + email)', async () => {
    setup({
      tables: {
        'solar.project_access': [
          { project_id: P2, user_id: 'b', level: 'edit' },
          { project_id: P, user_id: 'b', level: 'view' },
        ],
      },
    })
    await copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: P2 })
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(['b'], ['b@x.test'], expect.objectContaining({
      type: 'solar_access_changed', body: 'You now have Edit access to Solar on Kings Mall.', email: true,
    }))
  })

  it('an update that touched no row is skipped, not counted as copied', async () => {
    setup({
      tables: {
        'solar.project_access': [
          { project_id: P2, user_id: 'b', level: 'edit' },
          { project_id: P, user_id: 'b', level: 'view' },
        ],
      },
      writes: { 'solar.project_access:update': { data: [] } },
    })
    await expect(copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: P2 }))
      .resolves.toEqual({ ok: true, copied: 0, skipped: 1 })
    expect(h.notify).not.toHaveBeenCalled()
  })
})

// Owner default 3 (2026-09-28): subscribe requests are listed on the Access
// panel; a grantor presses "Mark done", which sets status 'approved' through
// 00207's guard (approved_level stays NULL for a subscribe request).
describe('markSubscribeRequestDoneAction', () => {
  const sub = { id: 's1', project_id: P2, requester_id: 'u4', kind: 'subscribe', status: 'pending' }

  it('refuses a non-grantor before any write', async () => {
    const { calls } = setup({ tables: { 'solar.access_requests': [sub] } }, [])
    await expect(markSubscribeRequestDoneAction('s1'))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can manage Solar access.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('refuses an access request (that is Approve / Decline)', async () => {
    setup({ tables: { 'solar.access_requests': [{ ...sub, kind: 'access' }] } })
    await expect(markSubscribeRequestDoneAction('s1'))
      .resolves.toEqual({ error: 'That is not a subscription request.' })
  })

  it('sets status approved (no level) only while still pending, audits and tells the requester', async () => {
    const { calls } = setup({ tables: { 'solar.access_requests': [sub] } })
    await expect(markSubscribeRequestDoneAction('s1')).resolves.toEqual({ ok: true })
    const upd = callsTo(calls, 'solar.access_requests', 'update')[0]
    expect(upd.payload).toEqual({ status: 'approved' })
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 's1'], ['eq', 'status', 'pending'], ['eq', 'kind', 'subscribe']]))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P2, actorId: ADMIN, verb: 'subscribe_request_done', objectRef: { request_id: 's1', user_id: 'u4' } })
    expect(h.notify).toHaveBeenCalledWith(['u4'], ['u4@x.test'], expect.objectContaining({
      type: 'solar_access_changed',
      title: 'Your request for Solar was answered',
      body: 'An admin marked your request for Solar on Other Mall as done.',
      email: true,
    }))
  })

  it('says "already answered" when someone else got there first', async () => {
    setup({ tables: { 'solar.access_requests': [sub] }, writes: { 'solar.access_requests:update': { data: [] } } })
    await expect(markSubscribeRequestDoneAction('s1'))
      .resolves.toEqual({ error: 'This request has already been answered — reload to see it.' })
    expect(h.notify).not.toHaveBeenCalled()
  })
})

describe('decideSolarRequestAction on a subscribe request', () => {
  it('refuses — subscription requests are marked done, not approved at a level', async () => {
    const { calls } = setup({ tables: { 'solar.access_requests': [{ id: 's1', project_id: P, requester_id: 'u4', kind: 'subscribe', status: 'pending' }] } })
    await expect(decideSolarRequestAction({ requestId: 's1', decision: 'approve' }))
      .resolves.toEqual({ error: 'That is not an access request.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
})
