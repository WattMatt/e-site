// COPIED FROM the canonical implementation. DO NOT EDIT in place
// without also updating the source. Keep these byte-equivalent except
// for the canonical-path banner and Deno-style import extensions.
//
// canonical: packages/db/src/encryption.ts

/**
 * AES-256-GCM token encryption for cloud-storage OAuth tokens.
 *
 * Used by Edge functions (Deno) and server actions (Node) to encrypt
 * provider access/refresh tokens before storing in
 * `public.org_storage_connections`, and decrypt them when calling provider
 * APIs (Dropbox, Google Drive, Microsoft Graph).
 *
 * On-the-wire BYTEA layout:
 *   [12-byte IV][ciphertext + 16-byte GCM auth tag]
 *
 * Web Crypto's AES-GCM places the auth tag at the end of the ciphertext
 * automatically; we don't split it out. Decrypt expects the same layout.
 *
 * Key:
 *   - env var STORAGE_TOKEN_ENC_KEY = base64-encoded 32 bytes (256 bits).
 *   - In production: set on Supabase Edge functions via `supabase secrets set`
 *     and on Vercel as a project env var (production + preview, NOT
 *     development unless tests run against staging).
 *   - Generate a fresh key with {@link generateKey}.
 *   - Rotation: re-encrypt all `org_storage_connections` rows under the
 *     new key, then deploy the new key. See
 *     docs/cloud-storage-integration-design.md §9.
 *
 * This module uses Web Crypto, available natively in Deno (1.x+) and
 * Node 18+. No npm dependencies.
 */

const IV_LEN = 12       // GCM-recommended IV length (96 bits)
const TAG_LEN = 16      // GCM auth tag length (128 bits)

interface KeyCacheEntry {
  source: string
  key: CryptoKey
}
let cache: KeyCacheEntry | null = null

async function getKey(keyMaterial: string): Promise<CryptoKey> {
  if (cache && cache.source === keyMaterial) return cache.key
  const raw = base64Decode(keyMaterial)
  if (raw.byteLength !== 32) {
    throw new Error(
      `STORAGE_TOKEN_ENC_KEY must be base64-encoded 32 bytes; got ${raw.byteLength} bytes`,
    )
  }
  const key = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  cache = { source: keyMaterial, key }
  return key
}

// Deno global — present at runtime when this module is imported from a
// Supabase Edge function; absent under Node. Declared here so the TS
// compiler doesn't choke when packages/db is type-checked under Node.
declare const Deno:
  | { env: { get: (n: string) => string | undefined } }
  | undefined

// Node `process` — present under Node (Vercel server actions) and absent
// under Deno. Declared loosely to avoid pulling in @types/node.
declare const process:
  | { env: Record<string, string | undefined> }
  | undefined

function getKeyMaterial(): string {
  // Dual-runtime: Node (Vercel server actions) and Deno (Supabase Edge).
  let k: string | undefined
  if (typeof process !== 'undefined' && process?.env) {
    k = process.env.STORAGE_TOKEN_ENC_KEY
  }
  if (!k && typeof Deno !== 'undefined' && Deno?.env) {
    k = Deno.env.get('STORAGE_TOKEN_ENC_KEY')
  }
  if (!k) {
    throw new Error(
      'STORAGE_TOKEN_ENC_KEY env var not set. ' +
        'Generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'and set it on Supabase Edge + Vercel.',
    )
  }
  return k
}

/**
 * Encrypt a UTF-8 string token. Returns a single Uint8Array suitable for
 * insert into a BYTEA column. Each call produces a fresh random IV — calling
 * encrypt twice on the same plaintext yields different ciphertexts, which
 * is the correct behaviour for confidentiality at rest.
 */
export async function encryptToken(
  plaintext: string,
  keyMaterial: string = getKeyMaterial(),
): Promise<Uint8Array> {
  const key = await getKey(keyMaterial)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  )
  const ct = new Uint8Array(ctBuf)
  const out = new Uint8Array(IV_LEN + ct.byteLength)
  out.set(iv, 0)
  out.set(ct, IV_LEN)
  return out
}

/**
 * Decrypt a BYTEA blob produced by {@link encryptToken}. Throws on:
 *   - blob too short to contain IV + ciphertext + tag
 *   - wrong key (auth tag verification fails)
 *   - tampered ciphertext (auth tag verification fails)
 */
export async function decryptToken(
  blob: Uint8Array,
  keyMaterial: string = getKeyMaterial(),
): Promise<string> {
  if (blob.byteLength < IV_LEN + TAG_LEN + 1) {
    throw new Error(
      `encrypted token blob too short: ${blob.byteLength} bytes (need at least ${IV_LEN + TAG_LEN + 1})`,
    )
  }
  const key = await getKey(keyMaterial)
  const iv = blob.subarray(0, IV_LEN)
  const ct = blob.subarray(IV_LEN)
  const ptBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  )
  return new TextDecoder().decode(ptBuf)
}

/**
 * Generate a fresh 32-byte (256-bit) encryption key, base64-encoded.
 * Use the output as the value of STORAGE_TOKEN_ENC_KEY.
 */
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64Encode(bytes)
}

// ---------------------------------------------------------------------------
// Base64 helpers — work in Node 16+ and Deno 1.x without polyfill.
// ---------------------------------------------------------------------------

function base64Encode(bytes: Uint8Array): string {
  // btoa exists natively in Node 18+ and Deno 1.x.
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function base64Decode(s: string): Uint8Array {
  // Reject obviously malformed input early so the error from importKey is
  // less mysterious.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    throw new Error('STORAGE_TOKEN_ENC_KEY is not valid base64')
  }
  // atob exists natively in Node 18+ and Deno 1.x.
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}