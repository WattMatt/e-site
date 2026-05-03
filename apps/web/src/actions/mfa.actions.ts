'use server'

/**
 * TOTP MFA enrollment + verification + unenrollment.
 *
 * Wraps Supabase's mfa.* methods so the client never holds the
 * service-role key. The cookie-bound anon client is sufficient — MFA
 * operations are user-scoped and gated by the existing session.
 *
 * Logs auth_events 'mfa_enrolled' / 'mfa_unenrolled' on confirmed
 * lifecycle changes (not on the initial enroll() call which leaves
 * the factor unverified).
 */

import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@esite/shared'
import { z } from 'zod'

const verifySchema = z.object({
  factorId: z.string().uuid(),
  code:     z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
})

export async function enrollTotpAction(): Promise<{
  factorId?: string
  qrCode?:   string
  secret?:   string
  uri?:      string
  error?:    string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType:   'totp',
    friendlyName: `E-Site (${new Date().toISOString().slice(0, 10)})`,
  })
  if (error || !data) return { error: error?.message ?? 'Could not start enrollment.' }
  return {
    factorId: data.id,
    qrCode:   data.totp.qr_code,
    secret:   data.totp.secret,
    uri:      data.totp.uri,
  }
}

export async function verifyEnrollAction(formData: FormData): Promise<{
  ok:    boolean
  error?: string
}> {
  const parsed = verifySchema.safeParse({
    factorId: formData.get('factorId'),
    code:     formData.get('code'),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: parsed.data.factorId })
  if (chalErr || !chal) return { ok: false, error: chalErr?.message ?? 'Could not start challenge.' }

  const { error: verErr } = await supabase.auth.mfa.verify({
    factorId:    parsed.data.factorId,
    challengeId: chal.id,
    code:        parsed.data.code,
  })
  if (verErr) return { ok: false, error: verErr.message }

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = headersList.get('user-agent') ?? null
  await logAuthEvent(createServiceClient(), {
    userId:    user.id,
    eventType: 'mfa_enrolled',
    ipAddress: ip,
    userAgent: ua,
    metadata:  { factor_type: 'totp', factor_id: parsed.data.factorId },
  })

  return { ok: true }
}

export async function unenrollAction(factorId: string): Promise<{
  ok:    boolean
  error?: string
}> {
  if (!/^[0-9a-f-]{36}$/i.test(factorId)) return { ok: false, error: 'Invalid factor id.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: error.message }

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = headersList.get('user-agent') ?? null
  await logAuthEvent(createServiceClient(), {
    userId:    user.id,
    eventType: 'mfa_unenrolled',
    ipAddress: ip,
    userAgent: ua,
    metadata:  { factor_id: factorId },
  })

  return { ok: true }
}

/**
 * Used by /verify-mfa page. Caller passes the challenge code; server
 * runs challenge + verify against the user's first verified TOTP
 * factor.
 */
export async function challengeMfaAction(code: string): Promise<{
  ok:    boolean
  error?: string
}> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code.' }

  const supabase = await createClient()
  const { data: factorsData, error: factorsErr } = await supabase.auth.mfa.listFactors()
  if (factorsErr || !factorsData) return { ok: false, error: factorsErr?.message ?? 'Could not load factors.' }

  const totp = factorsData.totp.find((f) => f.status === 'verified')
  if (!totp) return { ok: false, error: 'No verified TOTP factor on this account.' }

  const { data: chal, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: totp.id })
  if (chalErr || !chal) return { ok: false, error: chalErr?.message ?? 'Could not start challenge.' }

  const { error: verErr } = await supabase.auth.mfa.verify({
    factorId:    totp.id,
    challengeId: chal.id,
    code,
  })
  if (verErr) return { ok: false, error: verErr.message }

  return { ok: true }
}
