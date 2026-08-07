import type { EmailOtpType } from '@supabase/supabase-js'

/**
 * Email OTP types accepted by the /auth/callback token_hash flow. Shared by
 * the route handler (GET hand-off + POST verify) and the /auth/confirm
 * interstitial — route files can't export extra symbols, so this lives here.
 */
export const VALID_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

export function isValidOtpType(value: string): value is EmailOtpType {
  return VALID_OTP_TYPES.has(value as EmailOtpType)
}
