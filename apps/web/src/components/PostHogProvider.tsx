'use client'

/**
 * T-061: PostHog client-side provider
 *
 * Wraps the application in a PostHog context and fires a pageview event
 * on every route change.  Place this inside the root layout.tsx as a
 * Client Component wrapper.
 *
 * Usage in layout.tsx:
 *   import PostHogProvider from '@/components/PostHogProvider'
 *   <PostHogProvider>{children}</PostHogProvider>
 */

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { posthogConfig } from '@/lib/analytics'

// ─── Route-change pageview tracker ───────────────────────────────────────────

function PageviewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (!ph) return
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    ph.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, ph])

  return null
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!posthogConfig.key) return
    posthog.init(posthogConfig.key, {
      api_host: posthogConfig.host,
      ...posthogConfig.options,
    })
  }, [])

  if (!posthogConfig.key) return <>{children}</>

  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      {children}
    </PHProvider>
  )
}
