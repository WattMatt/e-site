import { createHash, randomBytes } from 'node:crypto'

/** 32 random bytes, base64url: the secret in an invitation link. Never stored. */
export function newInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

/** What the database stores and looks up by. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** A token is 43 base64url characters; anything else is not worth a lookup. */
export function looksLikeInvitationToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

export type InvitationRefusal = 'not_found' | 'revoked' | 'declined' | 'used' | 'expired' | 'not_open' | 'closed' | 'wrong_account' | 'needs_email_link'

export const INVITATION_REFUSAL_TEXT: Record<InvitationRefusal, string> = {
  not_found: 'This invitation link is not valid. Ask the engineer for a new one.',
  revoked: 'This invitation was withdrawn.',
  declined: 'This invitation was declined.',
  used: 'This invitation has already been accepted. Sign in with the email address it was sent to.',
  wrong_account: 'You are signed in with a different email address. Sign out, then open the invitation again.',
  needs_email_link: 'For your security, sign in with the link we email to the invited address (a password sign-in is not enough for a tender).',
  expired: 'This invitation link has expired. Ask the engineer for a new one.',
  not_open: 'This tender is not open yet.',
  closed: 'This tender has closed.',
}

export function checkInvitation(
  inv: { status: string; token_expires_at: string | null } | null,
  tender: { status: string; closing_at: string | null } | null,
  now: Date,
): { ok: true } | { ok: false; reason: InvitationRefusal } {
  if (!inv || !tender) return { ok: false, reason: 'not_found' }
  if (inv.status === 'revoked') return { ok: false, reason: 'revoked' }
  if (inv.status === 'declined') return { ok: false, reason: 'declined' }
  if (inv.status === 'accepted') return { ok: false, reason: 'used' }
  if (inv.token_expires_at && new Date(inv.token_expires_at) <= now) return { ok: false, reason: 'expired' }
  if (tender.status === 'draft' || tender.status === 'cancelled') return { ok: false, reason: 'not_open' }
  if (tender.status !== 'issued' || !tender.closing_at || new Date(tender.closing_at) <= now) return { ok: false, reason: 'closed' }
  return { ok: true }
}

/** Does the signed-in user's address match the invitation's? (Both lower-cased.) */
export function emailMatches(sessionEmail: string | null | undefined, invitationEmail: string): boolean {
  return !!sessionEmail && sessionEmail.trim().toLowerCase() === invitationEmail.trim().toLowerCase()
}

/**
 * Link expiry. Once a tender has a closing time the closing time governs (and
 * it can be extended), so the link itself carries no expiry; a draft's links
 * expire after 30 days.
 */
export function invitationExpiry(closingAt: string | null, now: Date): string | null {
  if (closingAt) return null
  return new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString()
}
