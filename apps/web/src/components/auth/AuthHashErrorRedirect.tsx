'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * GoTrue reports verify-endpoint failures in the URL *fragment*
 * (#error=access_denied&error_code=otp_expired&error_description=...), which
 * never reaches the server and which no page reads — so an expired invite /
 * recovery link used to strand the user on a blank marketing page. Mounted
 * once in the root layout: forwards error fragments to the reset-password
 * code-entry flow (the 6-digit code from the same email still works there)
 * and leaves success fragments (access_token=...) alone for the Supabase
 * client to consume. Renders nothing; no-op on every normal page load.
 *
 * Scoped twice, because the fragment is attacker-controllable via a plain
 * link: only paths GoTrue error bounces can actually land on (the Site URL
 * root and the auth surfaces) — a crafted #error fragment on an app page must
 * not eject a signed-in user — and only the link-failure codes the
 * reset-password flow can genuinely help with, so other GoTrue errors (e.g. a
 * failed email-change confirmation) aren't rebranded as an expired link.
 */
const BOUNCE_PATHS = new Set(['/', '/login', '/reset-password'])
const LINK_FAILURE_CODES = new Set(['otp_expired', 'otp_disabled', 'access_denied'])

export function AuthHashErrorRedirect() {
  const router = useRouter()

  useEffect(() => {
    const { hash, pathname } = window.location
    if (!hash || hash === '#') return
    if (!BOUNCE_PATHS.has(pathname) && !pathname.startsWith('/auth/')) return
    const params = new URLSearchParams(hash.slice(1))
    if (params.has('access_token')) return
    const errorCode = params.get('error_code') ?? params.get('error')
    if (!errorCode || !LINK_FAILURE_CODES.has(errorCode)) return
    router.replace(
      `/reset-password?step=code&error=${encodeURIComponent(errorCode)}&reason=link-expired`,
    )
  }, [router])

  return null
}
