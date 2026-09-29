// apps/edge-functions/supabase/functions/_shared/whatsapp/signature.ts
// Meta signs every webhook POST with HMAC-SHA256 of the RAW body under the app
// secret: header `X-Hub-Signature-256: sha256=<hex>`. This is the ONLY thing
// that authenticates whatsapp-webhook (deployed --no-verify-jwt). Fail closed.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim())
  if (!m) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody as BufferSource))
  return constantTimeEqual(sig, hexToBytes(m[1].toLowerCase()))
}
