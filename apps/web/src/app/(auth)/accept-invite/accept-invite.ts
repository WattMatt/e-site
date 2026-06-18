import type { EmailOtpType } from '@supabase/supabase-js'

export type AcceptInviteAction =
  | { kind: 'exchange_code'; code: string }
  | { kind: 'verify_otp'; tokenHash: string; type: EmailOtpType }
  | { kind: 'error'; code: string }

export function resolveAcceptInvite(params: URLSearchParams): AcceptInviteAction {
  const errorCode = params.get('error_code')
  if (errorCode) return { kind: 'error', code: errorCode }

  const code = params.get('code')
  if (code) return { kind: 'exchange_code', code }

  const tokenHash = params.get('token_hash') ?? params.get('token')
  const type = (params.get('type') ?? 'invite') as EmailOtpType
  if (tokenHash) return { kind: 'verify_otp', tokenHash, type }

  return { kind: 'error', code: 'invalid_link' }
}
