import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * notifyEntityEvent is the choke point for diary, QC, snag and site-form
 * notification — the "always fires" half of the platform's outbound mail. These
 * tests pin the bounce/complaint consult that was added there, and in
 * particular the ONE thing that must NOT happen: suppressing a person's in-app
 * bell because their mail server bounced.
 */
const { resolveProjectRecipientsMock, dispatchNotificationMock, createServiceClientMock } =
  vi.hoisted(() => ({
    resolveProjectRecipientsMock: vi.fn(),
    dispatchNotificationMock: vi.fn(),
    createServiceClientMock: vi.fn(),
  }))

vi.mock('./recipients', () => ({ resolveProjectRecipients: resolveProjectRecipientsMock }))
vi.mock('./notifications', () => ({ dispatchNotification: dispatchNotificationMock }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))

import { notifyEntityEvent } from './notify'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const ACTOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const ROSTER = [
  { userId: ACTOR_ID, email: 'arno@wmeng.co.za', fullName: 'Arno' },
  { userId: 'u-ghost', email: 'ghost@aeec.co.za', fullName: 'Ghost' },
  { userId: 'u-live', email: 'sipho@siyaya.co.za', fullName: 'Sipho' },
  { userId: 'u-nomail', email: null, fullName: 'No Mailbox' },
]

const BELL = { title: 'T', body: 'B', route: '/x', type: 'diary_created' }

/** Service client whose only job here is the email_suppressions `.in()` read. */
function mockService(opts: { suppressed?: string[]; error?: unknown } = {}) {
  const { suppressed = [], error = null } = opts
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, values: string[]) =>
          Promise.resolve({
            data: error ? null : suppressed.filter((s) => values.includes(s)).map((s) => ({ email_address: s })),
            error,
          }),
      }),
    }),
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  resolveProjectRecipientsMock.mockResolvedValue({
    userIds: ROSTER.map((r) => r.userId),
    emails: ROSTER.map((r) => r.email).filter(Boolean),
    recipients: ROSTER,
  })
  createServiceClientMock.mockReturnValue(mockService({ suppressed: ['ghost@aeec.co.za'] }))
  dispatchNotificationMock.mockResolvedValue(undefined)
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The `to` array actually handed to send-email. */
function sentTo(): string[] {
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
  return body.payload.to
}

describe('notifyEntityEvent — the suppression consult sits on the EMAIL leg only', () => {
  it('drops a hard-bounced address from the mail', async () => {
    const res = await notifyEntityEvent({
      projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL,
      email: { enabled: true, subject: 'S', html: '<p>h</p>' },
    })

    expect(sentTo()).toEqual(['arno@wmeng.co.za', 'sipho@siyaya.co.za'])
    expect(res.emailed).toBe(2)
    expect(res.suppressed).toBe(1)
  })

  it('STILL RINGS THE BELL for the suppressed person', async () => {
    // The whole reason the consult is on the email leg and not inside
    // resolveProjectRecipients: that resolver feeds bellUserIds too. Filtering
    // there would silently kill a colleague's in-app notifications because
    // their mail server bounced once, or because they clicked "spam".
    await notifyEntityEvent({
      projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL,
      email: { enabled: true, subject: 'S', html: '<p>h</p>' },
    })

    expect(dispatchNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['u-ghost', 'u-live', 'u-nomail'] }),
    )
  })

  it('sends nothing when every address on the roster is suppressed, but still rings every bell', async () => {
    createServiceClientMock.mockReturnValue(
      mockService({ suppressed: ['arno@wmeng.co.za', 'ghost@aeec.co.za', 'sipho@siyaya.co.za'] }),
    )

    const res = await notifyEntityEvent({
      projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL,
      email: { enabled: true, subject: 'S', html: '<p>h</p>' },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res).toEqual({ bell: 3, emailed: 0, suppressed: 3 })
    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1)
  })

  it('FAILS OPEN — a suppression read error mails the whole roster', async () => {
    createServiceClientMock.mockReturnValue(mockService({ error: { message: 'permission denied' } }))

    const res = await notifyEntityEvent({
      projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL,
      email: { enabled: true, subject: 'S', html: '<p>h</p>' },
    })

    expect(sentTo()).toEqual(['arno@wmeng.co.za', 'ghost@aeec.co.za', 'sipho@siyaya.co.za'])
    expect(res.suppressed).toBe(0)
  })

  it('does not consult the list at all when the module toggle is off', async () => {
    const res = await notifyEntityEvent({
      projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL,
      email: { enabled: false, subject: 'S', html: '<p>h</p>' },
    })

    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res).toEqual({ bell: 3, emailed: 0, suppressed: 0 })
  })

  it('never throws when the resolver explodes', async () => {
    resolveProjectRecipientsMock.mockRejectedValue(new Error('rpc down'))
    await expect(
      notifyEntityEvent({ projectId: PROJECT_ID, actorId: ACTOR_ID, bell: BELL }),
    ).resolves.toEqual({ bell: 0, emailed: 0, suppressed: 0 })
  })
})
