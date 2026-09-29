import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

const SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The raw token leaves the server exactly once (the link shown after Issue / New link). */
export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashShareToken(token) }
}

/** = solar.proposal_hash_token(): encode(sha256(convert_to(token, 'UTF8')), 'hex'). */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export const isShareToken = (s: unknown): s is string => typeof s === 'string' && SHAPE.test(s)
