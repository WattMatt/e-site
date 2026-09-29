// apps/web/src/lib/whatsapp/webhook-handler.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const FN = '../../../../edge-functions/supabase/functions/whatsapp-webhook/index.ts'
const STORE = '../../../../edge-functions/supabase/functions/_shared/whatsapp/store.ts'
const PROC = '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
const env: Record<string, string> = { WHATSAPP_APP_SECRET: 'sec', WHATSAPP_VERIFY_TOKEN: 'vt', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' }

let storeInbound: ReturnType<typeof vi.fn>
let applyStatuses: ReturnType<typeof vi.fn>
let processPending: ReturnType<typeof vi.fn>

async function load() {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: () => {} }
  storeInbound = vi.fn(async () => {})
  applyStatuses = vi.fn(async () => {})
  processPending = vi.fn(async () => 0)
  vi.doMock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))
  vi.doMock(STORE, () => ({ storeInbound, applyStatuses, createProcessorStore: () => ({}) }))
  vi.doMock(PROC, async (orig) => ({ ...(await orig<object>()), processPending }))
  return (await import(FN)).handler as (r: Request) => Promise<Response>
}

const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '27821234567', timestamp: '1', type: 'text', text: { body: 'hi' } }] } }] }] })
const sig = (b: string, s = 'sec') => 'sha256=' + createHmac('sha256', s).update(b).digest('hex')

describe('whatsapp-webhook handler', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('answers the verify handshake only with the right token', async () => {
    const h = await load()
    const ok = await h(new Request('https://f/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42'))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('42')
    const bad = await h(new Request('https://f/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'))
    expect(bad.status).toBe(403)
  })

  it('rejects an unsigned POST before touching the database', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body }))
    expect(r.status).toBe(401)
    expect(storeInbound).not.toHaveBeenCalled()
  })

  it('rejects a POST signed with the wrong secret', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body, 'other') } }))
    expect(r.status).toBe(401)
    expect(storeInbound).not.toHaveBeenCalled()
  })

  it('stores, then processes, then 200s for a signed POST', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body) } }))
    expect(r.status).toBe(200)
    expect(storeInbound).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ id: 'wamid.1', text: 'hi' })])
    expect(processPending).toHaveBeenCalled()
  })

  it('fails closed when the app secret is not configured', async () => {
    env.WHATSAPP_APP_SECRET = ''
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body, '') } }))
    expect(r.status).toBe(401)
    env.WHATSAPP_APP_SECRET = 'sec'
  })
})
