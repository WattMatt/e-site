// apps/web/src/lib/whatsapp/otp.ts
import 'server-only'
import { createHash, randomInt } from 'node:crypto'

/** Six digits, uniformly random, zero-padded. */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Bound to the link so a hash cannot be replayed onto another row. The code itself is never stored.
 * The whatsapp-webhook recomputes this exact function (_shared/whatsapp/link-code.ts) when the
 * user sends "LINK <code>" from their phone.
 */
export function hashOtp(linkId: string, code: string): string {
  return createHash('sha256').update(`${linkId}:${code}`).digest('hex')
}
