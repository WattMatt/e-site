'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

let initialized = false

// useSearchParams() opts the caller into client-side-only rendering. Isolating
// it inside its own Suspense boundary keeps the rest of the tree (including
// the auth pages) server-renderable.
function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!PH_KEY || !initialized) return
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return null
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!PH_KEY || initialized) return
    posthog.init(PH_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      persistence: 'localStorage+cookie',
      session_recording: { maskAllInputs: true },
    })
    initialized = true
  }, [])

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
  if (!PH_KEY || typeof window === 'undefined') return
  posthog.capture(event, props)
}

/** Identify authenticated user in PostHog */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (!PH_KEY || typeof window === 'undefined') return
  posthog.identify(userId, traits)
}
