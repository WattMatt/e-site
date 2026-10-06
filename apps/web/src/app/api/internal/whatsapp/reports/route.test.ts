// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signInternal } from '@esite/shared'

const { buildMock } = vi.hoisted(() => ({ buildMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/whatsapp-reports/cable-schedule', () => ({ buildCableSchedulePdfForUser: (...a: unknown[]) => buildMock(...a) }))

import { POST } from './route'

const SECRET = 'test-secret'
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P = '11111111-1111-4111-8111-111111111111'

async function req(body: unknown, sign = true) {
  const raw = JSON.stringify(body)
  const sig = sign ? await signInternal(SECRET, Math.floor(Date.now() / 1000), raw) : 't=1,v1=00'
  return { text: async () => raw, headers: { get: (k: string) => (k === 'x-esite-wa-signature' ? sig : null) } } as never
}

beforeEach(() => {
  process.env.WHATSAPP_INTERNAL_SECRET = SECRET
  buildMock.mockReset()
})

describe('POST /api/internal/whatsapp/reports', () => {
  it('401 on a bad signature, nothing built', async () => {
    const res = await POST(await req({ op: 'cable_schedule', userId: U, projectId: P }, false))
    expect(res.status).toBe(401)
    expect(buildMock).not.toHaveBeenCalled()
  })

  it('400 on an unknown op or non-uuid ids', async () => {
    expect((await POST(await req({ op: 'nope', userId: U, projectId: P }))).status).toBe(400)
    expect((await POST(await req({ op: 'cable_schedule', userId: 'x', projectId: P }))).status).toBe(400)
    expect(buildMock).not.toHaveBeenCalled()
  })

  it('returns the PDF as base64 for the named person', async () => {
    buildMock.mockResolvedValue({ code: 'ok', filename: 'K.pdf', bytes: new Uint8Array([37, 80, 68, 70]) })
    const res = await POST(await req({ op: 'cable_schedule', userId: U, projectId: P }))
    expect(buildMock).toHaveBeenCalledWith(expect.anything(), U, P)
    expect(await res.json()).toEqual({ code: 'ok', filename: 'K.pdf', base64: Buffer.from([37, 80, 68, 70]).toString('base64') })
  })

  it('passes a refusal through without bytes', async () => {
    buildMock.mockResolvedValue({ code: 'no_access', message: 'No access to this project' })
    const res = await POST(await req({ op: 'cable_schedule', userId: U, projectId: P }))
    expect(await res.json()).toEqual({ code: 'no_access', message: 'No access to this project' })
  })

  it('500 on a failure, so the edge retries', async () => {
    buildMock.mockRejectedValue(new Error('boom'))
    const res = await POST(await req({ op: 'cable_schedule', userId: U, projectId: P }))
    expect(res.status).toBe(500)
  })
})
