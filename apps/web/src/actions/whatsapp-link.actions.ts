// apps/web/src/actions/whatsapp-link.actions.ts
'use server'
/**
 * A signed-in user links their own WhatsApp number. Proof of ownership AND
 * POPIA consent are one step: we send a 6-digit code over WhatsApp, the user
 * types it back here. Only a hash of the code is stored (bound to the link id).
 * Writes use the service client after the caller is identified, because
 * `authenticated` has no write grant on whatsapp.* (migration 00222).
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CONSENT_TEXT_VERSION, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR, OTP_TTL_MS, maskPhone, normalisePhone } from '@esite/shared'
import { hashOtp, newOtp, otpMatches } from '@/lib/whatsapp/otp'
import { kickWhatsAppWorker } from '@/lib/whatsapp/kick-worker'

type Result = { ok: true; masked?: string } | { error: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wa = (sb: any) => sb.schema('whatsapp')

async function me(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function requestWhatsAppCodeAction(input: { phone: string }): Promise<Result> {
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
  await wa(svc).from('phone_links').update({
    phone_e164: phone,
    otp_hash: hashOtp(linkId, code),
    otp_expires_at: new Date(now + OTP_TTL_MS).toISOString(),
    otp_attempts: 0,
    otp_window_start: windowFresh ? mine.otp_window_start : new Date(now).toISOString(),
    otp_window_count: (windowFresh ? mine.otp_window_count : 0) + 1,
  }).eq('id', linkId)
  await wa(svc).from('outbox').insert({
    user_id: userId, link_id: linkId, trigger: 'otp', idempotency_key: `${linkId}:otp:${now}`, payload: { code },
  })
  await kickWhatsAppWorker('otp')
  return { ok: true, masked: maskPhone(phone) }
}

export async function confirmWhatsAppCodeAction(input: { code: string }): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const code = String(input?.code ?? '').trim()

  const svc = createServiceClient()
  const { data: link } = await wa(svc).from('phone_links')
    .select('id, user_id, status, otp_hash, otp_expires_at, otp_attempts')
    .eq('user_id', userId).eq('status', 'pending_otp').maybeSingle()
  if (!link) return { error: 'Request a code first.' }
  if ((link.otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) return { error: 'Too many attempts — request a new code.' }
  if (!link.otp_expires_at || Date.parse(link.otp_expires_at) < Date.now()) return { error: 'That code has expired — request a new one.' }
  if (!otpMatches(link.id, code, link.otp_hash)) {
    await wa(svc).from('phone_links').update({ otp_attempts: (link.otp_attempts ?? 0) + 1 }).eq('id', link.id)
    return { error: "That code isn't right." }
  }
  const at = new Date().toISOString()
  const { error } = await wa(svc).from('phone_links').update({
    status: 'active', verified_at: at, consent_at: at, consent_text_version: CONSENT_TEXT_VERSION,
    otp_hash: null, otp_expires_at: null, otp_attempts: 0,
  }).eq('id', link.id)
  if (error) return { error: 'That number was linked to another account a moment ago.' }
  revalidatePath('/settings/account')
  return { ok: true }
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
