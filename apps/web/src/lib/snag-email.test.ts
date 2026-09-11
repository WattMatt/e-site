import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * dispatchSnagStatusEmail is the one snag path that does NOT route through
 * notifyEntityEvent — it resolves the roster and posts to send-email itself, so
 * it needs its own bounce/complaint consult. Without one, a snag sign-off keeps
 * being mailed to a hard-bounced address on every status change, forever.
 */
const { createServiceClientMock, resolveProjectRecipientsMock, getNotificationConfigMock } =
  vi.hoisted(() => ({
    createServiceClientMock: vi.fn(),
    resolveProjectRecipientsMock: vi.fn(),
    getNotificationConfigMock: vi.fn(),
  }))

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))
vi.mock('./recipients', () => ({ resolveProjectRecipients: resolveProjectRecipientsMock }))
vi.mock('./notify', () => ({ notifyEntityEvent: vi.fn() }))
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

import { dispatchSnagStatusEmail } from './snag-email'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const SNAG_ID = '22222222-2222-2222-2222-222222222222'

const ARGS = {
  snagId: SNAG_ID,
  projectId: PROJECT_ID,
  title: 'Exposed live conductor at DB-04',
  statusLabel: 'Signed Off',
  changedById: null,
}

function mockService(opts: { suppressed?: string[]; suppressionError?: unknown } = {}) {
  const { suppressed = [], suppressionError = null } = opts
  return {
    // public.email_suppressions — reached WITHOUT .schema()
    from: (table: string) => {
      if (table === 'email_suppressions') {
        return {
          select: () => ({
            in: (_c: string, values: string[]) =>
              Promise.resolve({
                data: suppressionError
                  ? null
                  : suppressed.filter((a) => values.includes(a)).map((a) => ({ email_address: a })),
                error: suppressionError,
              }),
          }),
        }
      }
      // profiles
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { name: 'KINGSWALK' } }) }),
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
  createServiceClientMock.mockReturnValue(mockService({ suppressed: ['ghost@aeec.co.za'] }))
  getNotificationConfigMock.mockResolvedValue({ snagEmail: true })
  resolveProjectRecipientsMock.mockResolvedValue({
    userIds: ['a', 'b'],
    emails: ['live@wmeng.co.za', 'Ghost@AEEC.co.za'],
    recipients: [],
  })
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function sentTo(): string[] {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string).payload.to
}

describe('dispatchSnagStatusEmail — bounce/complaint consult', () => {
  it('withholds a suppressed address (mixed case included) and mails the rest', async () => {
    await dispatchSnagStatusEmail(ARGS)
    expect(sentTo()).toEqual(['live@wmeng.co.za'])
  })

  it('does not post to send-email at all when the whole roster is suppressed', async () => {
    createServiceClientMock.mockReturnValue(
      mockService({ suppressed: ['live@wmeng.co.za', 'ghost@aeec.co.za'] }),
    )
    await dispatchSnagStatusEmail(ARGS)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('FAILS OPEN — a suppression read error mails the whole roster', async () => {
    createServiceClientMock.mockReturnValue(
      mockService({ suppressionError: { message: 'permission denied' } }),
    )
    await dispatchSnagStatusEmail(ARGS)
    expect(sentTo()).toEqual(['live@wmeng.co.za', 'Ghost@AEEC.co.za'])
  })

  it('still sends nothing when the project toggle is off', async () => {
    getNotificationConfigMock.mockResolvedValue({ snagEmail: false })
    await dispatchSnagStatusEmail(ARGS)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
