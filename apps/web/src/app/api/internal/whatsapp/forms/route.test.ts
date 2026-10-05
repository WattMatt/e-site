// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signInternal } from '@esite/shared'

const { handleFormsOp } = vi.hoisted(() => ({ handleFormsOp: vi.fn(async (..._a: unknown[]) => ({ code: 'ok', messages: [] as unknown[] })) }))
vi.mock('@/lib/whatsapp-forms/service', async (orig) => ({ ...(await orig<object>()), handleFormsOp }))
vi.mock('@/lib/whatsapp-forms/store', () => ({ createFormsStore: () => ({}) }))
vi.mock('@/lib/whatsapp-forms/after-submit', () => ({ afterWhatsAppSubmit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

import { POST } from './route'

const req = (body: string, sig: string | null) =>
  new Request('https://www.e-site.live/api/internal/whatsapp/forms', {
    method: 'POST', body, headers: sig ? { 'x-esite-wa-signature': sig } : {},
  }) as never

beforeEach(() => {
  handleFormsOp.mockClear()
  process.env.WHATSAPP_INTERNAL_SECRET = 'S'
})
const now = () => Math.floor(Date.now() / 1000)

describe('POST /api/internal/whatsapp/forms', () => {
  it('runs a correctly signed op', async () => {
    const body = JSON.stringify({ op: 'submit', user_id: 'u', session_id: 's' })
    const res = await POST(req(body, await signInternal('S', now(), body)))
    expect(res.status).toBe(200)
    expect(handleFormsOp).toHaveBeenCalledWith('submit', expect.objectContaining({ user_id: 'u' }), expect.anything())
  })
  it('refuses an unsigned, mis-signed or stale request before doing anything', async () => {
    const body = JSON.stringify({ op: 'submit' })
    for (const sig of [null, await signInternal('other', now(), body), await signInternal('S', now() - 3600, body)]) {
      expect((await POST(req(body, sig))).status).toBe(401)
    }
    expect(handleFormsOp).not.toHaveBeenCalled()
  })
  it('refuses everything when the secret is not configured', async () => {
    process.env.WHATSAPP_INTERNAL_SECRET = ''
    const body = JSON.stringify({ op: 'submit' })
    expect((await POST(req(body, await signInternal('S', now(), body)))).status).toBe(401)
  })
  it('refuses an op it does not know', async () => {
    const body = JSON.stringify({ op: 'drop_table' })
    expect((await POST(req(body, await signInternal('S', now(), body)))).status).toBe(400)
    expect(handleFormsOp).not.toHaveBeenCalled()
  })
  it('a failure is a 500 so the edge retries the message', async () => {
    handleFormsOp.mockRejectedValueOnce(new Error('db down'))
    const body = JSON.stringify({ op: 'open' })
    expect((await POST(req(body, await signInternal('S', now(), body)))).status).toBe(500)
  })
})
