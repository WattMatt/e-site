import { describe, it, expect } from 'vitest'
import { verifyHookSignature } from './verify-signature.ts'

// Build a valid signature the same way standardwebhooks does, so the test is
// self-contained (no Supabase round-trip needed).
async function sign(secretB64: string, id: string, ts: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const data = new TextEncoder().encode(`${id}.${ts}.${body}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return `v1,${b64}`
}

const SECRET_B64 = btoa('super-secret-hook-key-32bytes!!') // raw secret bytes, base64
const FULL_SECRET = `v1,whsec_${SECRET_B64}`
const BODY = JSON.stringify({ hello: 'world' })
const ID = 'msg_123'
const TS = String(Math.floor(Date.now() / 1000))

describe('verifyHookSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature('{"hello":"evil"}', {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(false)
  })

  it('rejects a wrong secret', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, `v1,whsec_${btoa('a-different-secret-key-32-bytes!!')}`)
    expect(ok).toBe(false)
  })

  it('rejects a stale timestamp (> 5 min skew)', async () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 60 * 10)
    const sigHeader = await sign(SECRET_B64, ID, staleTs, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': staleTs, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(false)
  })

  it('accepts when the header carries multiple space-separated signatures', async () => {
    const good = await sign(SECRET_B64, ID, TS, BODY)
    const header = `v1,AAAA ${good}`
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': header,
    }, FULL_SECRET)
    expect(ok).toBe(true)
  })

  it('fails closed when the webhook-signature header is missing/undefined', async () => {
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': undefined,
    }, FULL_SECRET)
    expect(ok).toBe(false)
  })
})
