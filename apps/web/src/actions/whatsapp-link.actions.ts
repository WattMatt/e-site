// apps/web/src/actions/whatsapp-link.actions.ts
'use server'
/**
 * A signed-in user links their own WhatsApp number by SENDING a code from it.
 * The page shows "LINK 482917"; the user sends it from that phone to E-Site's
 * number, and the whatsapp-webhook activates the link when it arrives FROM the
 * number entered (_shared/whatsapp/link-code.ts). That message is the proof of
 * ownership; sending it after reading the consent text is the consent. No
 * outbound code is sent: Meta only permits authentication templates for
 * verified businesses. Only a hash of the code is stored (bound to the link id).
 * Writes use the service client after the caller is identified, because
 * `authenticated` has no write grant on whatsapp.* (migration 00222).
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { OTP_MAX_SENDS_PER_HOUR, OTP_TTL_MS, linkCodeMessage, maskPhone, normalisePhone } from '@esite/shared'
import { hashOtp, newOtp } from '@/lib/whatsapp/otp'

type Result = { ok: true; masked?: string } | { error: string }
export type LinkCodeResult =
  | { ok: true; masked: string; message: string; waNumber: string | null; expiresAt: string }
  | { error: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wa = (sb: any) => sb.schema('whatsapp')

async function me(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

/** E-Site's WhatsApp number in international digits (wa.me format), or null if not configured. */
function businessNumber(): string | null {
  const d = (process.env.WHATSAPP_BUSINESS_NUMBER ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d : null
}

export async function requestWhatsAppCodeAction(input: { phone: string }): Promise<LinkCodeResult> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const phone = normalisePhone(String(input?.phone ?? ''))
  if (!phone) return { error: 'Enter a valid mobile number, e.g. 082 123 4567.' }

  const svc = createServiceClient()
  const { data: taken } = await wa(svc).from('phone_links').select('id, user_id, status')
    .eq('phone_e164', phone).in('status', ['active', 'pending_optin'])
  if ((taken ?? []).some((r: { user_id: string }) => r.user_id !== userId)) {
    return { error: 'That number is already linked to another E-Site account.' }
  }

  const { data: mine } = await wa(svc).from('phone_links')
    .select('id, status, phone_e164, otp_window_start, otp_window_count')
    .eq('user_id', userId).in('status', ['pending_otp', 'pending_optin', 'active']).maybeSingle()

  const now = Date.now()
  const windowFresh = mine?.otp_window_start && now - Date.parse(mine.otp_window_start) < 3_600_000
  if (windowFresh && (mine.otp_window_count ?? 0) >= OTP_MAX_SENDS_PER_HOUR) {
    return { error: 'Too many codes — try again in an hour.' }
  }

  let linkId: string
  if (mine && mine.status === 'pending_otp') {
    linkId = mine.id
  } else {
    if (mine) {
      // Switching numbers: the old live link stops; the new one must prove itself.
      await wa(svc).from('phone_links').update({ status: 'opted_out', undeliverable_reason: 'replaced' }).eq('id', mine.id)
    }
    const { data: created, error } = await wa(svc).from('phone_links')
      .insert({ user_id: userId, phone_e164: phone, status: 'pending_otp', otp_hash: '0'.repeat(64) })
      .select('id').single()
    if (error || !created) return { error: 'Could not start linking — try again.' }
    linkId = created.id
  }

  const code = newOtp()
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString()
  await wa(svc).from('phone_links').update({
    phone_e164: phone,
    otp_hash: hashOtp(linkId, code),
    otp_expires_at: expiresAt,
    otp_attempts: 0,
    otp_window_start: windowFresh ? mine.otp_window_start : new Date(now).toISOString(),
    otp_window_count: (windowFresh ? mine.otp_window_count : 0) + 1,
  }).eq('id', linkId)
  return { ok: true, masked: maskPhone(phone), message: linkCodeMessage(code), waNumber: businessNumber(), expiresAt }
}

/** Polled by the panel while the user sends the code from their phone. */
export async function getWhatsAppLinkStatusAction(): Promise<{ status: 'active' | 'pending' | 'none'; masked?: string } | { error: string }> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const svc = createServiceClient()
  const { data } = await wa(svc).from('phone_links').select('status, phone_e164')
    .eq('user_id', userId).in('status', ['active', 'pending_otp']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return { status: 'none' }
  if (data.status === 'active') revalidatePath('/settings/account')
  return { status: data.status === 'active' ? 'active' : 'pending', masked: maskPhone(data.phone_e164) }
}

export async function removeWhatsAppLinkAction(): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const svc = createServiceClient()
  await wa(svc).from('phone_links').update({ status: 'opted_out', undeliverable_reason: 'removed_by_user' })
    .eq('user_id', userId).in('status', ['pending_otp', 'pending_optin', 'active'])
  revalidatePath('/settings/account')
  return { ok: true }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export async function setWhatsAppQuietHoursAction(input: { start: string; end: string }): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const parsed = z.object({ start: hhmm, end: hhmm }).safeParse(input)
  if (!parsed.success) return { error: 'Use 24-hour times like 18:00.' }
  const svc = createServiceClient()
  await wa(svc).from('phone_links').update({ quiet_start: parsed.data.start, quiet_end: parsed.data.end })
    .eq('user_id', userId).eq('status', 'active')
  revalidatePath('/settings/account')
  return { ok: true }
}
