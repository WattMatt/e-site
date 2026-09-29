// apps/web/src/lib/whatsapp/otp.ts
import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Six digits, uniformly random, zero-padded. */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Bound to the link so a hash cannot be replayed onto another row. The code itself is never stored. */
export function hashOtp(linkId: string, code: string): string {
  return createHash('sha256').update(`${linkId}:${code}`).digest('hex')
}

export function otpMatches(linkId: string, code: string, storedHash: string | null): boolean {
  if (!storedHash || !/^\d{6}$/.test(code)) return false
  const a = Buffer.from(hashOtp(linkId, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
