import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {}),
  filter: vi.fn(async (_c: unknown, emails: string[]) => ({
    allowed: emails.filter((e) => e !== 'bounced@x.test'),
    suppressed: emails.filter((e) => e === 'bounced@x.test'),
  })),
  fetch: vi.fn(async () => new Response('{}', { status: 200 })),
}))

vi.mock('@/lib/notifications', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: vi.fn(() => ({})) }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await orig<typeof import('@esite/shared')>()),
  filterSuppressed: h.filter,
}))

import { notifySolarUsers } from './notify'

const notice = {
  type: 'solar_access_requested' as const,
  projectId: 'p1',
  projectName: 'Mall',
  title: 'Bob asked for Solar access',
  body: 'Bob asked for Edit access to Solar on Mall.',
  route: '/projects/p1/solar/access',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', h.fetch)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.e-site.live')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('notifySolarUsers', () => {
  it('always sends the bell with the Solar type and route', async () => {
    await notifySolarUsers(['a1'], [], { ...notice, email: false })
    expect(h.dispatch).toHaveBeenCalledWith({
      userIds: ['a1'], title: notice.title, body: notice.body, route: notice.route,
      type: 'solar_access_requested', entityType: 'solar_project', entityId: 'p1',
    })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('emails only unsuppressed addresses through send-email', async () => {
    await notifySolarUsers(['a1', 'a2'], ['ann@x.test', 'bounced@x.test'], { ...notice, email: true })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sb.test/functions/v1/send-email')
    const body = JSON.parse(String(init.body))
    expect(body.type).toBe('rfi-created')
    expect(body.payload.to).toEqual(['ann@x.test'])
    expect(body.payload.subject).toBe(notice.title)
    expect(body.payload.html).toContain('https://www.e-site.live/projects/p1/solar/access')
  })

  it('does nothing for an empty audience', async () => {
    await notifySolarUsers([], [], { ...notice, email: true })
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
