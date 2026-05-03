'use client'

import { useRef } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

/**
 * Cloudflare Turnstile widget. No-ops when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is not set so the auth pages still work in environments without the
 * key configured (local dev, preview before keys are provisioned).
 *
 * When enabled in Supabase Auth (security_captcha_provider='turnstile'
 * + security_captcha_secret), pass the token returned via onToken into
 * supabase.auth.signUp / signInWithPassword / resetPasswordForEmail
 * via { options: { captchaToken: token } }.
 */
export function CaptchaTurnstile({
  onToken,
  onExpire,
}: {
  onToken: (token: string) => void
  onExpire?: () => void
}) {
  const ref = useRef<TurnstileInstance | null>(null)

  if (!SITE_KEY) return null

  return (
    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
      <Turnstile
        ref={ref}
        siteKey={SITE_KEY}
        options={{ theme: 'dark', size: 'normal' }}
        onSuccess={onToken}
        onExpire={() => {
          onExpire?.()
          ref.current?.reset()
        }}
      />
    </div>
  )
}

export const CAPTCHA_ENABLED = Boolean(SITE_KEY)
