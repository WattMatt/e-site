'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

let initialized = false

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!PH_KEY || initialized) return
    posthog.init(PH_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,                    // POPIA — no auto DOM capture
      persistence: 'localStorage+cookie',
      session_recording: { maskAllInputs: true },
    })
    initialized = true
  }, [])

  useEffect(() => {
    if (!PH_KEY || !initialized) return
    // Capture pageview on route change
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams])

  return <>{children}</>
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
