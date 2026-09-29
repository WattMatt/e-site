// apps/web/src/lib/whatsapp/signature.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/signature.ts'

const SECRET = 'app-secret-123'
const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}')
const sign = (b: Uint8Array, s = SECRET) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex')

describe('verifyMetaSignature', () => {
  it('accepts a correct signature', async () => expect(await verifyMetaSignature(body, sign(body), SECRET)).toBe(true))
  it('accepts upper-case hex', async () => expect(await verifyMetaSignature(body, sign(body).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true))
  it('rejects a tampered body', async () => {
    const tampered = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[1]}')
    expect(await verifyMetaSignature(tampered, sign(body), SECRET)).toBe(false)
  })
  it('rejects the wrong secret', async () => expect(await verifyMetaSignature(body, sign(body, 'other'), SECRET)).toBe(false))
  it('rejects a missing header', async () => expect(await verifyMetaSignature(body, null, SECRET)).toBe(false))
  it('rejects a malformed header', async () => expect(await verifyMetaSignature(body, 'sha1=abc', SECRET)).toBe(false))
  it('rejects when the secret is unset (fail closed)', async () => expect(await verifyMetaSignature(body, sign(body, ''), '')).toBe(false))
})
