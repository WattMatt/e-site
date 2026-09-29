// apps/edge-functions/supabase/functions/_shared/whatsapp/link-code.ts
//
// Linking a number by an INBOUND code. The web shows "LINK 482917"; the user
// sends it from the phone being linked. A message arriving FROM that number is
// the proof of ownership, and sending it after reading the consent text on the
// web page is the consent. This replaces sending an OTP template, which Meta
// only allows for verified businesses (spec 2026-09-28 §9 amendment 13).
//
// Only a hash of the code is stored: sha256(`${linkId}:${code}`), the same
// function the web action uses (apps/web/src/lib/whatsapp/otp.ts).
import { CONSENT_TEXT_VERSION, OTP_MAX_ATTEMPTS } from './core.ts'
import type { ProcessorDeps, ProcessResult } from './processor.ts'

export const LINK_REPLIES = {
  linked: "✅ This number is now linked to E-Site. Site items will arrive here — type *menu* any time.",
  wrong: "That code isn't right. Check the code on the E-Site page and send it again.",
  expired: 'That code has expired. Get a new one on the E-Site page (Settings → Account → WhatsApp).',
  locked: 'Too many wrong codes. Get a new one on the E-Site page (Settings → Account → WhatsApp).',
  noPending: "There's no link request for this number. Start on the E-Site page (Settings → Account → WhatsApp), and send the code from the number you entered there.",
  taken: 'This number is already linked to another E-Site account.',
  sendCode: "You're part-way through linking this number. Send the 6-digit code shown on the E-Site page (Settings → Account → WhatsApp).",
} as const

export interface PendingOtpLink {
  id: string
  user_id: string
  otp_hash: string | null
  otp_expires_at: string | null
  otp_attempts: number
}

async function sha256hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const res = (outcome: ProcessResult['outcome'], reason: string, userId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId: null })

export async function linkByInboundCode(deps: ProcessorDeps, from: string, code: string): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const rows = await store.pendingOtpLinks(from)
  if (rows.length === 0) {
    await meta.sendText(from, LINK_REPLIES.noPending)
    return res('refused', 'no_pending_link', null)
  }
  const live = rows.filter((r) => r.otp_expires_at && Date.parse(r.otp_expires_at) > now().getTime())
  if (live.length === 0) {
    await meta.sendText(from, LINK_REPLIES.expired)
    return res('refused', 'link_code_expired', rows[0].user_id)
  }
  const open = live.filter((r) => (r.otp_attempts ?? 0) < OTP_MAX_ATTEMPTS)
  if (open.length === 0) {
    await meta.sendText(from, LINK_REPLIES.locked)
    return res('refused', 'link_code_locked', live[0].user_id)
  }
  for (const r of open) {
    if (r.otp_hash && constantTimeEqualHex(await sha256hex(`${r.id}:${code}`), r.otp_hash)) {
      const at = now().toISOString()
      try {
        await store.updateLink(r.id, { status: 'active', verified_at: at, consent_at: at, consent_text_version: CONSENT_TEXT_VERSION,
          otp_hash: null, otp_expires_at: null, otp_attempts: 0 })
      } catch {
        await meta.sendText(from, LINK_REPLIES.taken)
        return res('refused', 'link_conflict', r.user_id)
      }
      await meta.sendText(from, LINK_REPLIES.linked)
      return res('applied', 'linked', r.user_id)
    }
  }
  for (const r of open) await store.updateLink(r.id, { otp_attempts: (r.otp_attempts ?? 0) + 1 })
  await meta.sendText(from, LINK_REPLIES.wrong)
  return res('refused', 'link_code_wrong', open[0].user_id)
}
