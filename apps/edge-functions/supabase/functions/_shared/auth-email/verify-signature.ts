// standardwebhooks verification used by the Supabase Send Email auth hook.
// Secret format: "v1,whsec_<base64>". Signed content: `${id}.${timestamp}.${body}`.
// Header `webhook-signature` is a space-separated list of `v1,<base64sig>` entries.
// Runs on Web Crypto (Deno + Node >= 20), so it is unit-testable under vitest.

const FIVE_MIN = 60 * 5

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

/** Constant-time string compare to avoid signature timing leaks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyHookSignature(
  body: string,
  headers: Record<string, string | null | undefined>,
  secret: string,
  toleranceSeconds = FIVE_MIN,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers['webhook-id']
  const ts = headers['webhook-timestamp']
  const sigHeader = headers['webhook-signature']
  if (!id || !ts || !sigHeader) return false

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > toleranceSeconds) return false

  // Strip the "v1,whsec_" wrapper; the remainder is the base64 raw secret.
  const rawSecretB64 = secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, '')
  let keyBytes: Uint8Array
  try {
    keyBytes = base64ToBytes(rawSecretB64)
  } catch {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signed = new TextEncoder().encode(`${id}.${ts}.${body}`)
  const expected = `v1,${bytesToBase64(await crypto.subtle.sign('HMAC', key, signed))}`

  // The header may list several signatures (key rotation). Accept any match.
  for (const candidate of sigHeader.split(' ')) {
    if (candidate && timingSafeEqual(candidate, expected)) return true
  }
  return false
}
