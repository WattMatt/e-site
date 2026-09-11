import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The RFI toggle has always promised email "when an RFI is raised, responded to,
 * or closed". Only the create path ever sent one. These tests pin all three
 * events onto the shared notifyEntityEvent channel, and pin the one piece of
 * judgement in the fix: production shows the close landing 6s, 10s, 20s and 43s
 * after the response on every RFI that had both, so a naive wiring double-mails
 * nearly every exchange.
 */
const { createServiceClientMock, notifyEntityEventMock, getNotificationConfigMock } = vi.hoisted(
  () => ({
    createServiceClientMock: vi.fn(),
    notifyEntityEventMock: vi.fn(),
    getNotificationConfigMock: vi.fn(),
  }),
)

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))
vi.mock('./notify', () => ({ notifyEntityEvent: notifyEntityEventMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectSettingsService: {
      ...actual.projectSettingsService,
      getNotificationConfig: getNotificationConfigMock,
    },
  }
})

import {
  notifyRfiEvent,
  shouldEmailOnClose,
  RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS,
} from './rfi-email'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const RFI_ID = '22222222-2222-2222-2222-222222222222'
const ACTOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RAISER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

/**
 * Service client: profiles, projects.projects and — for the close path — the
 * latest projects.rfi_responses timestamp.
 */
function mockService(opts: { latestResponseAt?: string | null } = {}) {
  const { latestResponseAt = null } = opts
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: RAISER_ID, full_name: 'Sipho Ndlovu' }], error: null }),
      }),
    }),
    schema: () => ({
      from: (table: string) => ({
        select: () => {
          if (table === 'rfi_responses') {
            return {
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: latestResponseAt ? { created_at: latestResponseAt } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            eq: () => ({ maybeSingle: async () => ({ data: { name: 'KINGSWALK' }, error: null }) }),
          }
        },
      }),
    }),
  }
}

const BASE = {
  projectId: PROJECT_ID,
  rfiId: RFI_ID,
  rfiSubject: 'Confirm the busbar rating at MAIN BOARD 3.1',
  actorId: ACTOR_ID,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'
  createServiceClientMock.mockReturnValue(mockService())
  getNotificationConfigMock.mockResolvedValue({ rfiEmail: true })
  notifyEntityEventMock.mockResolvedValue({ bell: 3, emailed: 3, suppressed: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/** The single notifyEntityEvent call this dispatch produced. */
function call() {
  expect(notifyEntityEventMock).toHaveBeenCalledTimes(1)
  return notifyEntityEventMock.mock.calls[0][0]
}

describe('notifyRfiEvent — every event the toggle promises actually sends', () => {
  it('created: bell + email, on the shared roster channel', async () => {
    await notifyRfiEvent({ ...BASE, event: 'created', priority: 'high', dueDate: '2026-09-20', assigneeId: null, raiserId: RAISER_ID })
    const a = call()
    expect(a.bell.type).toBe('rfi_created')
    expect(a.bell.route).toBe(`/rfis/${RFI_ID}`)
    expect(a.email.enabled).toBe(true)
    expect(a.email.subject).toContain('Confirm the busbar rating')
  })

  it('responded: SENDS AN EMAIL — the half the client actually waits for', async () => {
    // This is the defect. The external party got an email when they asked the
    // question and complete silence when it was answered.
    await notifyRfiEvent({ ...BASE, event: 'responded', bellEntityId: 'resp-1' })
    const a = call()
    expect(a.bell.type).toBe('rfi_response')
    expect(a.bell.entityId).toBe('resp-1')
    expect(a.email.enabled).toBe(true)
    expect(a.email.subject).toMatch(/respon/i)
    expect(a.email.html).toContain(`https://www.e-site.live/rfis/${RFI_ID}`)
  })

  it('closed with no response on record: sends the closing email', async () => {
    await notifyRfiEvent({ ...BASE, event: 'closed' })
    const a = call()
    expect(a.bell.type).toBe('rfi_closed')
    expect(a.email.enabled).toBe(true)
  })

  it('closed moments after a response: BELL ONLY — no second email for one exchange', async () => {
    createServiceClientMock.mockReturnValue(
      mockService({ latestResponseAt: new Date(Date.now() - 20_000).toISOString() }),
    )
    await notifyRfiEvent({ ...BASE, event: 'closed' })
    const a = call()
    expect(a.bell.type).toBe('rfi_closed')
    expect(a.email.enabled).toBe(false)
  })

  it('closed long after a response: the close is its own event again', async () => {
    createServiceClientMock.mockReturnValue(
      mockService({
        latestResponseAt: new Date(
          Date.now() - RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS - 60_000,
        ).toISOString(),
      }),
    )
    await notifyRfiEvent({ ...BASE, event: 'closed' })
    expect(call().email.enabled).toBe(true)
  })

  it('the project toggle still switches email off — for every event', async () => {
    getNotificationConfigMock.mockResolvedValue({ rfiEmail: false })
    for (const event of ['created', 'responded', 'closed'] as const) {
      notifyEntityEventMock.mockClear()
      await notifyRfiEvent({ ...BASE, event, priority: 'low', raiserId: RAISER_ID })
      const a = notifyEntityEventMock.mock.calls[0][0]
      // The bell is NOT the email toggle's business: it must still fire.
      expect(a.bell.type).toBeTruthy()
      expect(a.email.enabled).toBe(false)
    }
  })

  it('never throws — a notification failure must not surface from an RFI write', async () => {
    notifyEntityEventMock.mockRejectedValue(new Error('send-email down'))
    await expect(notifyRfiEvent({ ...BASE, event: 'responded' })).resolves.toBeUndefined()
  })
})

describe('shouldEmailOnClose — the double-mail guard, in isolation', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  it('true when nothing was ever answered', () => {
    expect(shouldEmailOnClose(null, now)).toBe(true)
  })

  it.each([1_000, 6_000, 43_000, RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS - 1])(
    'false %dms after a response',
    (ms) => {
      expect(shouldEmailOnClose(new Date(now.getTime() - ms).toISOString(), now)).toBe(false)
    },
  )

  it('true once the window has elapsed', () => {
    const at = new Date(now.getTime() - RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS - 1).toISOString()
    expect(shouldEmailOnClose(at, now)).toBe(true)
  })

  it('true for an unparseable timestamp — fail towards telling people', () => {
    expect(shouldEmailOnClose('not a date', now)).toBe(true)
  })
})
