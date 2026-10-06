'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { posthogClientOptions } from '@/lib/analytics/posthog-client-options'

const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

let initialized = false

/**
 * Initialise on first use. Init used to live in AnalyticsProvider's own
 * useEffect, but React runs a child's effects before its parent's, so
 * PageViewTracker's first run always saw `initialized === false` and the
 * landing page view was never sent.
 */
function ensurePostHog(): boolean {
  if (!PH_KEY || typeof window === 'undefined') return false
  if (!initialized) {
    posthog.init(PH_KEY, posthogClientOptions)
    initialized = true
  }
  return true
}

// useSearchParams() opts the caller into client-side-only rendering. Isolating
// it inside its own Suspense boundary keeps the rest of the tree (including
// the auth pages) server-renderable.
function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!ensurePostHog()) return
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return null
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  )
}

/** Track events from any client component */
export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!ensurePostHog()) return
  posthog.capture(event, props)
}
