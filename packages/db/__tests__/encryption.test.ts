import { describe, it, expect, beforeAll } from 'vitest'
import { encryptToken, decryptToken, generateKey } from '../src/encryption'

describe('AES-256-GCM token encryption', () => {
  let key: string

  beforeAll(() => {
    key = generateKey()
  })

  it('round-trips a simple ASCII string', async () => {
    const blob = await encryptToken('hello world', key)
    const out = await decryptToken(blob, key)
    expect(out).toBe('hello world')
  })

  it('round-trips a long Dropbox-shaped access token', async () => {
    const fakeToken = 'sl.B' + 'x'.repeat(120)
    const blob = await encryptToken(fakeToken, key)
    const out = await decryptToken(blob, key)
    expect(out).toBe(fakeToken)
  })

  it('round-trips a Google Drive refresh token (longer)', async () => {
    const fakeRefresh = '1//0g' + 'A'.repeat(200)
    const blob = await encryptToken(fakeRefresh, key)
    const out = await decryptToken(blob, key)
    expect(out).toBe(fakeRefresh)
  })

  it('round-trips a Microsoft Graph token with non-ASCII chars', async () => {
    const fakeToken = 'eyJ' + '微软-Graph-€'.repeat(20)
    const blob = await encryptToken(fakeToken, key)
    const out = await decryptToken(blob, key)
    expect(out).toBe(fakeToken)
  })

  it('produces non-deterministic ciphertext (different IV each call)', async () => {
    const blob1 = await encryptToken('hello', key)
    const blob2 = await encryptToken('hello', key)
    expect(blob1).not.toEqual(blob2)
    // Both decrypt to the same plaintext though.
    expect(await decryptToken(blob1, key)).toBe('hello')
    expect(await decryptToken(blob2, key)).toBe('hello')
  })

  it('rejects a wrong key (auth tag verification fails)', async () => {
    const k1 = generateKey()
    const k2 = generateKey()
    expect(k1).not.toBe(k2)
    const blob = await encryptToken('secret', k1)
    await expect(decryptToken(blob, k2)).rejects.toThrow()
  })

  it('rejects a truncated ciphertext', async () => {
    const blob = await encryptToken('secret-with-meat', key)
    const truncated = blob.subarray(0, blob.byteLength - 4)
    await expect(decryptToken(truncated, key)).rejects.toThrow()
  })

  it('rejects a tampered ciphertext (auth tag fails)', async () => {
    const blob = await encryptToken('secret-with-meat', key)
    blob[blob.byteLength - 1] ^= 0x01
    await expect(decryptToken(blob, key)).rejects.toThrow()
  })

  it('rejects a tampered IV', async () => {
    const blob = await encryptToken('secret-with-meat', key)
    blob[0] ^= 0x01
    await expect(decryptToken(blob, key)).rejects.toThrow()
  })

  it('rejects a malformed key (not base64)', async () => {
    await expect(encryptToken('x', 'not-base64!!!')).rejects.toThrow()
  })

  it('rejects a key of the wrong length', async () => {
    // 16 bytes base64 = "AAAAAAAAAAAAAAAAAAAAAA==" (16 As padded)
    const tooShort = btoa('a'.repeat(16))
    await expect(encryptToken('x', tooShort)).rejects.toThrow(/32 bytes/)
  })

  it('generateKey produces a fresh 32-byte key each call', () => {
    const k1 = generateKey()
    const k2 = generateKey()
    expect(k1).not.toBe(k2)
    // base64 of 32 bytes = 44 chars (with 1 padding =)
    expect(k1.length).toBe(44)
    expect(k1.endsWith('=')).toBe(true)
  })

  it('rejects an empty blob', async () => {
    await expect(decryptToken(new Uint8Array(0), key)).rejects.toThrow()
  })

  it('rejects a blob shorter than IV + tag', async () => {
    await expect(decryptToken(new Uint8Array(20), key)).rejects.toThrow()
  })
})
